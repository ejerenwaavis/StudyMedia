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
const MAX_FILESIZE = process.env.MAX_FILESIZE || '250M';
const EXTRACT_TIMEOUT_MS = Number(process.env.EXTRACT_TIMEOUT_MS) || 180_000;

const DEFAULT_ORIGINS = ['https://studymedia.aceddivision.com', 'http://localhost:5173'];
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);
const EFFECTIVE_ORIGINS = ALLOWED_ORIGINS.length > 0 ? ALLOWED_ORIGINS : DEFAULT_ORIGINS;

// Security headers on every response
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'no-store');
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

// --- In-memory rate limiting & brute-force lockout ---
const authFailMap = new Map(); // ip -> { count, resetAt }
const extractRateMap = new Map(); // ip -> { count, resetAt }
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
  if (entry.count >= 6) return false;
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

  // Reset failure counter on valid key
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

// Tier 1 Health Check (fast response for StudyMedia's 1.5s ping)
app.get('/health', requireApiKey, (req, res) => {
  res.json({ status: 'ok', service: 'studymedia-sidecar' });
});

// Extract & stream MP4/MP3 media back to StudyMedia IndexedDB
app.post('/extract', requireApiKey, (req, res) => {
  const ip = getClientIp(req);
  if (!checkExtractRateLimit(ip)) {
    return res.status(429).json({ error: 'Extraction rate limit exceeded. Wait a few minutes.' });
  }

  if (activeJobs >= MAX_CONCURRENT_JOBS) {
    return res.status(503).json({ error: 'Sidecar is busy with another extraction. Retry shortly.' });
  }

  const { url, format = 'mp4' } = req.body || {};
  if (!isValidYouTubeUrl(url)) {
    return res.status(400).json({ error: 'Invalid YouTube URL' });
  }

  const isAudio = format === 'mp3';
  const ext = isAudio ? 'mp3' : 'mp4';
  const jobId = crypto.randomBytes(8).toString('hex');
  const outTemplate = path.join(os.tmpdir(), `studymedia-${jobId}.%(ext)s`);
  const expectedFile = path.join(os.tmpdir(), `studymedia-${jobId}.${ext}`);

  const baseArgs = [
    '--no-playlist',
    '--no-exec',
    '--restrict-filenames',
    '--max-filesize',
    MAX_FILESIZE,
    ...(FFMPEG_LOCATION ? ['--ffmpeg-location', FFMPEG_LOCATION] : []),
  ];

  // Argument array with explicit '--' end-of-options separator before URL
  const args = isAudio
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

  activeJobs += 1;
  const proc = spawn(YT_DLP_BIN, args, { windowsHide: true });
  let stderr = '';
  let aborted = false;
  let cleanedUp = false;
  let jobReleased = false;

  const releaseJob = () => {
    if (jobReleased) return;
    jobReleased = true;
    activeJobs = Math.max(0, activeJobs - 1);
  };

  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    cleanupJobFiles(jobId);
  };

  // Hard timeout guard so a stalled job cannot hold CPU/disk indefinitely
  const killTimer = setTimeout(() => {
    aborted = true;
    proc.kill('SIGTERM');
    releaseJob();
    cleanup();
    if (!res.headersSent) {
      res.status(504).json({ error: 'Extraction timed out' });
    }
  }, EXTRACT_TIMEOUT_MS);

  proc.stderr.on('data', (chunk) => {
    if (stderr.length < 8192) stderr += chunk.toString();
  });

  proc.on('error', (err) => {
    clearTimeout(killTimer);
    console.error('Failed to spawn yt-dlp:', err.message);
    releaseJob();
    cleanup();
    if (!res.headersSent) {
      res.status(500).json({ error: 'yt-dlp binary not found or failed to launch' });
    }
  });

  // Kill yt-dlp & remove temp files if the phone drops connection mid-extract
  req.on('close', () => {
    if (!res.writableEnded) {
      clearTimeout(killTimer);
      aborted = true;
      proc.kill('SIGTERM');
      releaseJob();
      cleanup();
    }
  });

  proc.on('close', (code) => {
    clearTimeout(killTimer);
    releaseJob();
    if (aborted) return;

    if (code !== 0 || !fs.existsSync(expectedFile)) {
      console.error('yt-dlp failed:', stderr);
      cleanup();
      if (!res.headersSent) {
        return res.status(500).json({ error: 'Extraction failed' });
      }
      return;
    }

    let fileSize = 0;
    try {
      fileSize = fs.statSync(expectedFile).size;
    } catch {
      fileSize = 0;
    }

    res.setHeader('Content-Type', isAudio ? 'audio/mpeg' : 'video/mp4');
    if (fileSize > 0) {
      res.setHeader('Content-Length', String(fileSize));
    }
    res.setHeader('Content-Disposition', `inline; filename="lecture-${jobId}.${ext}"`);

    const stream = fs.createReadStream(expectedFile);
    stream.on('error', () => {
      cleanup();
      if (!res.headersSent) res.status(500).end();
    });
    res.on('finish', cleanup);
    res.on('close', cleanup);
    stream.pipe(res);
  });
});

// Reject all unknown routes cleanly
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.listen(PORT, HOST, () => {
  console.log(`StudyMedia sidecar listening securely on http://${HOST}:${PORT}`);
  console.log(`Allowed CORS origins: ${EFFECTIVE_ORIGINS.join(', ')}`);
  if (!API_KEY) {
    console.warn('WARNING: API_KEY is not set in .env — all requests will return 401 Unauthorized.');
  }
});
