import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

const app = express();
app.disable('x-powered-by');

const PORT = Number(process.env.PORT) || 4848;
const HOST = process.env.HOST || '127.0.0.1';
const API_KEY = (process.env.API_KEY || '').trim();
const YT_DLP_BIN = (process.env.YT_DLP_PATH || 'yt-dlp').trim();
const FFMPEG_LOCATION = (process.env.FFMPEG_PATH || '').trim();
const MAX_CONCURRENT_JOBS = Number(process.env.MAX_CONCURRENT_JOBS) || 2;
const MAX_FILESIZE = process.env.MAX_FILESIZE || '1G';
const EXTRACT_TIMEOUT_MS = Number(process.env.EXTRACT_TIMEOUT_MS) || 600_000; // 10 minutes
const JOB_TTL_MS = 15 * 60_000; // 15 minutes for finished/abandoned jobs

const DEFAULT_ORIGINS = ['https://studymedia.aceddivision.com', 'http://localhost:5173'];
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);
const EFFECTIVE_ORIGINS = ALLOWED_ORIGINS.length > 0 ? ALLOWED_ORIGINS : DEFAULT_ORIGINS;

// Defense-in-depth: refuse any TCP connection not originating from local loopback
// (tailscale serve proxies locally via 127.0.0.1)
app.use((req, res, next) => {
  const remote = req.socket?.remoteAddress || '';
  const isLoopback =
    remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
  if (!isLoopback) {
    return res.status(403).json({ error: 'Loopback access only' });
  }
  next();
});

// Security headers on every response + strict Chrome Private Network Access (PNA) for Tailnet
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000');

  const origin = req.headers.origin;
  if (
    origin &&
    EFFECTIVE_ORIGINS.includes(origin) &&
    req.headers['access-control-request-private-network'] === 'true'
  ) {
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
  }
  next();
});

app.use(express.json({ limit: '16kb' }));
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin || EFFECTIVE_ORIGINS.includes(origin)) return cb(null, true);
      return cb(new Error('CORS_BLOCKED'));
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'x-api-key'],
    exposedHeaders: ['Content-Length', 'Content-Disposition'],
  })
);

// Clean JSON error handler (prevents leaking internal stack traces)
app.use((err, req, res, next) => {
  if (err?.message === 'CORS_BLOCKED') {
    return res.status(403).json({ error: 'Origin not allowed' });
  }
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }
  return next(err);
});

// --- In-memory rate limiting, brute-force lockout & async job store ---
const authFailMap = new Map(); // ip -> { count, resetAt }
const extractRateMap = new Map(); // ip -> { count, resetAt }
const jobs = new Map(); // jobId -> job object
let activeJobs = 0;

function getClientIp(req) {
  const cfIp = req.headers['cf-connecting-ip'];
  if (typeof cfIp === 'string' && cfIp.trim()) return cfIp.trim();
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.trim()) return xff.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

function recordAuthFailure(ip) {
  const now = Date.now();
  const entry = authFailMap.get(ip);
  if (!entry || now > entry.resetAt) {
    authFailMap.set(ip, { count: 1, resetAt: now + 15 * 60_000 });
  } else {
    entry.count += 1;
  }
}

function isAuthLocked(ip) {
  const now = Date.now();
  const entry = authFailMap.get(ip);
  if (!entry) return false;
  if (now > entry.resetAt) {
    authFailMap.delete(ip);
    return false;
  }
  return entry.count >= 10;
}

function checkExtractRateLimit(ip) {
  const now = Date.now();
  const entry = extractRateMap.get(ip);
  if (!entry || now > entry.resetAt) {
    extractRateMap.set(ip, { count: 1, resetAt: now + 10 * 60_000 });
    return true;
  }
  // Allow up to 30 jobs per 10 minutes so playlist batch downloads work smoothly
  if (entry.count >= 30) return false;
  entry.count += 1;
  return true;
}

// Constant-time secret key comparison (prevents timing side-channel attacks)
function safeKeyEquals(provided, expected) {
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// Enforce API key authentication with brute-force lockout
function requireApiKey(req, res, next) {
  const ip = getClientIp(req);
  if (isAuthLocked(ip)) {
    return res.status(429).json({ error: 'Too many failed auth attempts. Try again later.' });
  }

  const provided = (req.headers['x-api-key'] || '').toString().trim();
  if (!API_KEY || !provided || !safeKeyEquals(provided, API_KEY)) {
    recordAuthFailure(ip);
    return res.status(401).json({ error: 'Unauthorized' });
  }

  authFailMap.delete(ip);
  next();
}

// Strict YouTube URL validation (scheme + exact host allowlist + no whitespace/control chars)
function isValidYouTubeUrl(input) {
  if (!input || typeof input !== 'string' || input.length > 300) return false;
  if (/[\r\n\t\0]/.test(input)) return false;
  try {
    const parsed = new URL(input);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
    const validHosts = ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'];
    return validHosts.includes(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function cleanupJobFiles(jobId) {
  const tmpDir = os.tmpdir();
  const prefix = `studymedia-${jobId}`;
  fs.readdir(tmpDir, (err, files) => {
    if (err || !Array.isArray(files)) return;
    for (const file of files) {
      if (file.startsWith(prefix)) {
        fs.unlink(path.join(tmpDir, file), () => {});
      }
    }
  });
}

function findJobOutputFile(jobId, preferredExt) {
  const tmpDir = os.tmpdir();
  const expected = path.join(tmpDir, `studymedia-${jobId}.${preferredExt}`);
  if (fs.existsSync(expected)) return expected;

  // Fallback: locate any completed file matching studymedia-<jobId>.* (excluding .part/.ytdl)
  try {
    const prefix = `studymedia-${jobId}.`;
    const candidates = fs
      .readdirSync(tmpDir)
      .filter((f) => f.startsWith(prefix) && !f.endsWith('.part') && !f.endsWith('.ytdl'));
    if (candidates.length > 0) {
      return path.join(tmpDir, candidates[0]);
    }
  } catch {
    // ignore
  }
  return null;
}

function buildYtDlpArgs(url, format, outTemplate) {
  const isAudio = format === 'mp3';
  const baseArgs = [
    '--newline',
    '--progress',
    '--no-playlist',
    '--no-exec',
    '--restrict-filenames',
    '--max-filesize',
    MAX_FILESIZE,
    ...(FFMPEG_LOCATION ? ['--ffmpeg-location', FFMPEG_LOCATION] : []),
  ];

  // Explicit '--' end-of-options separator before URL
  return isAudio
    ? [
        ...baseArgs,
        '-x',
        '--audio-format',
        'mp3',
        '--audio-quality',
        '0',
        '-o',
        outTemplate,
        '--',
        url,
      ]
    : [
        ...baseArgs,
        '-f',
        'bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720][ext=mp4]/best',
        '--merge-output-format',
        'mp4',
        '-o',
        outTemplate,
        '--',
        url,
      ];
}

function terminateProc(proc) {
  if (!proc || proc.killed) return;
  try {
    proc.kill('SIGTERM');
    setTimeout(() => {
      try {
        if (!proc.killed) proc.kill('SIGKILL');
      } catch {
        // ignore
      }
    }, 3000).unref();
  } catch {
    // ignore
  }
}

function parseYtDlpLine(job, rawLine, isStderr = false) {
  const line = String(rawLine || '').trim();
  if (!line) return;

  job.updatedAt = Date.now();

  if (isStderr) {
    job.stderrLines.push(line);
    if (job.stderrLines.length > 25) job.stderrLines.shift();
  }

  // Detect filesize abort printed by yt-dlp (often on stdout!)
  if (/file is larger than max-filesize/i.test(line)) {
    job.hintError = `Video exceeds sidecar filesize limit (${MAX_FILESIZE}). Try MP3 or increase MAX_FILESIZE.`;
    return;
  }

  if (/^ERROR:/i.test(line)) {
    job.hintError = line.replace(/^ERROR:\s*/i, '').trim();
    return;
  }

  // Track video vs audio stream download stages
  if (/^\[youtube\]|^\[info\]/i.test(line)) {
    if (job.state === 'queued') {
      job.state = 'downloading';
      job.phase = 'Fetching lecture metadata...';
    }
    return;
  }

  if (/^\[download\]\s+Destination:/i.test(line)) {
    job.streamCount += 1;
    job.state = 'downloading';
    if (job.isAudio) {
      job.phase = 'Downloading audio...';
    } else if (job.streamCount === 1) {
      job.phase = 'Downloading video...';
    } else {
      job.phase = 'Downloading audio...';
    }
    return;
  }

  // Parse live download percentage, speed, and ETA:
  // e.g. [download]  42.5% of   89.12MiB at    4.23MiB/s ETA 00:18
  const progMatch = line.match(
    /^\[download\]\s+(\d+(?:\.\d+)?)%(?:.*?\bat\s+([^\s]+))?(?:.*?\bETA\s+([^\s]+))?/i
  );
  if (progMatch) {
    const rawPct = parseFloat(progMatch[1]);
    if (!Number.isNaN(rawPct)) {
      job.state = 'downloading';
      job.percent = Math.min(100, Math.max(0, Math.round(rawPct * 10) / 10));
      if (!job.phase || job.phase === 'Starting yt-dlp...' || job.phase === 'Fetching lecture metadata...') {
        job.phase = job.isAudio ? 'Downloading audio...' : 'Downloading video...';
      }
    }
    if (progMatch[2] && !/unknown/i.test(progMatch[2])) {
      job.speed = progMatch[2];
    }
    if (progMatch[3] && !/unknown/i.test(progMatch[3])) {
      job.eta = progMatch[3];
    }
    return;
  }

  if (/^\[(Merger|ExtractAudio|FixupM4a|VideoConvertor|ffmpeg)\]/i.test(line)) {
    job.state = 'merging';
    job.percent = 99;
    job.speed = null;
    job.eta = null;
    job.phase = job.isAudio ? 'Converting to MP3...' : 'Merging audio & video...';
  }
}

function attachLineReader(stream, onLine) {
  let buf = '';
  stream.on('data', (chunk) => {
    buf += chunk.toString('utf8');
    const parts = buf.split(/\r\n|\n|\r/);
    buf = parts.pop() || '';
    for (const part of parts) {
      onLine(part);
    }
  });
  stream.on('end', () => {
    if (buf.trim()) onLine(buf);
  });
}

function startExtractionJob({ url, format }) {
  const isAudio = format === 'mp3';
  const ext = isAudio ? 'mp3' : 'mp4';
  const jobId = crypto.randomBytes(8).toString('hex');
  const outTemplate = path.join(os.tmpdir(), `studymedia-${jobId}.%(ext)s`);
  const args = buildYtDlpArgs(url, ext, outTemplate);

  const job = {
    id: jobId,
    url,
    format: ext,
    isAudio,
    state: 'queued', // 'queued' | 'downloading' | 'merging' | 'ready' | 'error' | 'cancelled'
    percent: 0,
    phase: 'Starting yt-dlp...',
    speed: null,
    eta: null,
    error: null,
    hintError: null,
    filePath: null,
    fileSize: 0,
    streamCount: 0,
    stderrLines: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    completedAt: null,
    proc: null,
    killTimer: null,
    jobReleased: false,
    downloading: false,
  };

  const releaseJob = () => {
    if (job.jobReleased) return;
    job.jobReleased = true;
    activeJobs = Math.max(0, activeJobs - 1);
  };

  jobs.set(jobId, job);
  activeJobs += 1;

  console.log(`[Job ${jobId}] Starting ${ext.toUpperCase()} extraction: ${url}`);
  const proc = spawn(YT_DLP_BIN, args, { windowsHide: true });
  job.proc = proc;

  job.killTimer = setTimeout(() => {
    if (job.state === 'ready' || job.state === 'error' || job.state === 'cancelled') return;
    console.error(`[Job ${jobId}] Timed out after ${Math.round(EXTRACT_TIMEOUT_MS / 1000)}s`);
    job.state = 'error';
    job.phase = 'Timed out';
    job.error = `Extraction timed out after ${Math.round(EXTRACT_TIMEOUT_MS / 60_000)} minutes`;
    job.completedAt = Date.now();
    job.updatedAt = Date.now();
    terminateProc(proc);
    releaseJob();
    cleanupJobFiles(jobId);
  }, EXTRACT_TIMEOUT_MS);

  attachLineReader(proc.stdout, (line) => parseYtDlpLine(job, line, false));
  attachLineReader(proc.stderr, (line) => parseYtDlpLine(job, line, true));

  proc.on('error', (err) => {
    clearTimeout(job.killTimer);
    releaseJob();
    cleanupJobFiles(jobId);
    console.error(`[Job ${jobId}] Failed to spawn yt-dlp:`, err.message);
    job.state = 'error';
    job.phase = 'Launch failed';
    job.error = `yt-dlp failed to launch: ${err.message}`;
    job.completedAt = Date.now();
    job.updatedAt = Date.now();
  });

  proc.on('close', (code) => {
    clearTimeout(job.killTimer);
    releaseJob();
    job.proc = null;

    if (job.state === 'cancelled' || job.state === 'error') {
      cleanupJobFiles(jobId);
      return;
    }

    const foundFile = code === 0 ? findJobOutputFile(jobId, ext) : null;
    if (code !== 0 || !foundFile) {
      const tailStderr = job.stderrLines
        .filter((l) => !/^WARNING:/i.test(l))
        .slice(-3)
        .join(' | ');
      const fallbackStderr = job.stderrLines.slice(-3).join(' | ');
      const detail =
        job.hintError ||
        tailStderr ||
        fallbackStderr ||
        (code === 0
          ? `yt-dlp finished but output file was not created (likely exceeded MAX_FILESIZE ${MAX_FILESIZE})`
          : `yt-dlp exited with code ${code}`);

      console.error(`[Job ${jobId}] Failed (code ${code}): ${detail}`);
      cleanupJobFiles(jobId);
      job.state = 'error';
      job.phase = 'Failed';
      job.error = detail.slice(0, 400);
      job.completedAt = Date.now();
      job.updatedAt = Date.now();
      return;
    }

    let fileSize = 0;
    try {
      fileSize = fs.statSync(foundFile).size;
    } catch {
      fileSize = 0;
    }

    job.filePath = foundFile;
    job.fileSize = fileSize;
    job.state = 'ready';
    job.percent = 100;
    job.speed = null;
    job.eta = null;
    job.phase = 'Ready';
    job.completedAt = Date.now();
    job.updatedAt = Date.now();
    console.log(
      `[Job ${jobId}] Ready (${(fileSize / (1024 * 1024)).toFixed(1)} MB) -> ${path.basename(foundFile)}`
    );
  });

  return job;
}

// Periodic 15-minute TTL sweeper for finished or abandoned jobs
setInterval(() => {
  const now = Date.now();
  for (const [jobId, job] of jobs.entries()) {
    if (job.downloading) continue;
    const refTime = job.completedAt || job.updatedAt || job.createdAt;
    const isTerminal = job.state === 'ready' || job.state === 'error' || job.state === 'cancelled';
    if (isTerminal && now - refTime > JOB_TTL_MS) {
      cleanupJobFiles(jobId);
      jobs.delete(jobId);
      console.log(`[Job ${jobId}] Expired and cleaned up (TTL)`);
    }
  }
}, 60_000).unref();

// Tier 1 Health Check (fast response for StudyMedia's 1.5s ping)
app.get('/health', requireApiKey, (req, res) => {
  res.json({
    status: 'ok',
    service: 'studymedia-sidecar',
    asyncJobs: true,
    activeJobs,
    maxConcurrentJobs: MAX_CONCURRENT_JOBS,
    maxFilesize: MAX_FILESIZE,
    timeoutSeconds: Math.round(EXTRACT_TIMEOUT_MS / 1000),
  });
});

// Step 1: Start an async yt-dlp extraction job (returns HTTP 202 + { jobId } immediately)
app.post('/extract/start', requireApiKey, (req, res) => {
  const ip = getClientIp(req);
  if (!checkExtractRateLimit(ip)) {
    return res.status(429).json({ error: 'Extraction rate limit exceeded. Wait a few minutes.' });
  }

  if (activeJobs >= MAX_CONCURRENT_JOBS) {
    return res
      .status(503)
      .json({ error: 'Sidecar is busy with another extraction. Retry shortly.' });
  }

  const { url, format = 'mp4' } = req.body || {};
  if (!isValidYouTubeUrl(url)) {
    return res.status(400).json({ error: 'Invalid YouTube URL' });
  }

  const cleanFormat = format === 'mp3' ? 'mp3' : 'mp4';
  const job = startExtractionJob({ url, format: cleanFormat });

  return res.status(202).json({
    jobId: job.id,
    state: job.state,
    percent: job.percent,
    phase: job.phase,
  });
});

// Step 2: Poll real-time yt-dlp extraction progress
app.get('/extract/status/:jobId', requireApiKey, (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'Extraction job not found or expired' });
  }

  return res.json({
    jobId: job.id,
    state: job.state,
    percent: job.percent,
    phase: job.phase,
    speed: job.speed,
    eta: job.eta,
    error: job.error,
    fileSize: job.fileSize,
    format: job.format,
  });
});

// Step 3: Stream finished file with Content-Type + Content-Length, then clean up
app.get('/extract/download/:jobId', requireApiKey, (req, res) => {
  const jobId = req.params.jobId;
  const job = jobs.get(jobId);
  if (!job) {
    return res.status(404).json({ error: 'Extraction job not found or expired' });
  }
  if (job.state !== 'ready' || !job.filePath || !fs.existsSync(job.filePath)) {
    return res.status(409).json({
      error: job.error || `Job is not ready for download (state: ${job.state})`,
    });
  }

  job.downloading = true;
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    job.downloading = false;
    cleanupJobFiles(jobId);
    jobs.delete(jobId);
  };

  res.setHeader('Content-Type', job.isAudio ? 'audio/mpeg' : 'video/mp4');
  if (job.fileSize > 0) {
    res.setHeader('Content-Length', String(job.fileSize));
  }
  res.setHeader('Content-Disposition', `inline; filename="lecture-${jobId}.${job.format}"`);

  const stream = fs.createReadStream(job.filePath);
  stream.on('error', (err) => {
    console.error(`[Job ${jobId}] Stream error:`, err.message);
    cleanup();
    if (!res.headersSent) res.status(500).json({ error: 'Failed to stream extracted file' });
  });
  res.on('finish', cleanup);
  res.on('close', cleanup);
  stream.pipe(res);
});

// Optional: Cancel an in-progress extraction job cleanly
app.post('/extract/cancel/:jobId', requireApiKey, (req, res) => {
  const jobId = req.params.jobId;
  const job = jobs.get(jobId);
  if (!job) {
    return res.json({ ok: true, alreadyGone: true });
  }
  clearTimeout(job.killTimer);
  job.state = 'cancelled';
  job.phase = 'Cancelled';
  if (job.proc) {
    terminateProc(job.proc);
  }
  if (!job.jobReleased) {
    job.jobReleased = true;
    activeJobs = Math.max(0, activeJobs - 1);
  }
  cleanupJobFiles(jobId);
  jobs.delete(jobId);
  console.log(`[Job ${jobId}] Cancelled by client`);
  return res.json({ ok: true });
});

// Legacy blocking fallback POST /extract (fixed res.on('close') guard instead of req.on('close'))
app.post('/extract', requireApiKey, (req, res) => {
  const ip = getClientIp(req);
  if (!checkExtractRateLimit(ip)) {
    return res.status(429).json({ error: 'Extraction rate limit exceeded. Wait a few minutes.' });
  }
  if (activeJobs >= MAX_CONCURRENT_JOBS) {
    return res
      .status(503)
      .json({ error: 'Sidecar is busy with another extraction. Retry shortly.' });
  }
  const { url, format = 'mp4' } = req.body || {};
  if (!isValidYouTubeUrl(url)) {
    return res.status(400).json({ error: 'Invalid YouTube URL' });
  }

  const job = startExtractionJob({ url, format: format === 'mp3' ? 'mp3' : 'mp4' });
  let done = false;

  const pollTimer = setInterval(() => {
    if (done) return;
    if (job.state === 'error' || job.state === 'cancelled') {
      done = true;
      clearInterval(pollTimer);
      const errMsg = job.error || 'Extraction failed';
      cleanupJobFiles(job.id);
      jobs.delete(job.id);
      if (!res.headersSent) res.status(500).json({ error: errMsg });
      return;
    }
    if (job.state === 'ready' && job.filePath && fs.existsSync(job.filePath)) {
      done = true;
      clearInterval(pollTimer);
      job.downloading = true;
      let cleaned = false;
      const cleanup = () => {
        if (cleaned) return;
        cleaned = true;
        job.downloading = false;
        cleanupJobFiles(job.id);
        jobs.delete(job.id);
      };
      res.setHeader('Content-Type', job.isAudio ? 'audio/mpeg' : 'video/mp4');
      if (job.fileSize > 0) res.setHeader('Content-Length', String(job.fileSize));
      res.setHeader('Content-Disposition', `inline; filename="lecture-${job.id}.${job.format}"`);
      const stream = fs.createReadStream(job.filePath);
      stream.on('error', () => {
        cleanup();
        if (!res.headersSent) res.status(500).end();
      });
      res.on('finish', cleanup);
      res.on('close', cleanup);
      stream.pipe(res);
    }
  }, 500);

  // Only abort if the response socket closes before finishing (NOT req.on('close')!)
  res.on('close', () => {
    if (!res.writableEnded && !done) {
      done = true;
      clearInterval(pollTimer);
      clearTimeout(job.killTimer);
      job.state = 'cancelled';
      if (job.proc) terminateProc(job.proc);
      if (!job.jobReleased) {
        job.jobReleased = true;
        activeJobs = Math.max(0, activeJobs - 1);
      }
      cleanupJobFiles(job.id);
      jobs.delete(job.id);
    }
  });
});

// Reject all unknown routes cleanly
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.listen(PORT, HOST, () => {
  console.log(`StudyMedia sidecar listening securely on http://${HOST}:${PORT}`);
  console.log(
    `Allowed CORS origins: ${EFFECTIVE_ORIGINS.join(', ')} | Max filesize: ${MAX_FILESIZE} | Timeout: ${Math.round(
      EXTRACT_TIMEOUT_MS / 1000
    )}s`
  );
  if (!API_KEY) {
    console.warn('WARNING: API_KEY is not set in .env — all requests will return 401 Unauthorized.');
  }
});
