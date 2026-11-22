import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

const app = express();
const PORT = Number(process.env.PORT) || 4848;
const HOST = process.env.HOST || '127.0.0.1';
const API_KEY = (process.env.API_KEY || '').trim();
const DEFAULT_ORIGINS = ['https://studymedia.aceddivision.com', 'http://localhost:5173'];
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);
const EFFECTIVE_ORIGINS = ALLOWED_ORIGINS.length > 0 ? ALLOWED_ORIGINS : DEFAULT_ORIGINS;

app.use(express.json({ limit: '16kb' }));
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin || EFFECTIVE_ORIGINS.includes(origin)) return cb(null, true);
      return cb(new Error('Blocked by CORS'));
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'x-api-key'],
    exposedHeaders: ['Content-Length', 'Content-Disposition'],
  })
);

// Enforce API key authentication on every protected endpoint
function requireApiKey(req, res, next) {
  const provided = (req.headers['x-api-key'] || '').toString().trim();
  if (!API_KEY || !provided || provided !== API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// Strict hostname validation — only standard YouTube URLs accepted
function isValidYouTubeUrl(input) {
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
  const { url, format = 'mp4' } = req.body || {};

  if (!url || typeof url !== 'string' || !isValidYouTubeUrl(url)) {
    return res.status(400).json({ error: 'Invalid YouTube URL' });
  }

  const isAudio = format === 'mp3';
  const ext = isAudio ? 'mp3' : 'mp4';
  const jobId = crypto.randomBytes(8).toString('hex');
  const outTemplate = path.join(os.tmpdir(), `studymedia-${jobId}.%(ext)s`);
  const expectedFile = path.join(os.tmpdir(), `studymedia-${jobId}.${ext}`);

  // Argument arrays passed directly to spawn() — prevents shell/command injection
  const args = isAudio
    ? [
        '-x',
        '--audio-format',
        'mp3',
        '--audio-quality',
        '0',
        '--no-playlist',
        '-o',
        outTemplate,
        url,
      ]
    : [
        '-f',
        'bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720][ext=mp4]/best',
        '--merge-output-format',
        'mp4',
        '--no-playlist',
        '-o',
        outTemplate,
        url,
      ];

  const proc = spawn('yt-dlp', args, { windowsHide: true });
  let stderr = '';
  let aborted = false;
  let cleanedUp = false;

  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    cleanupJobFiles(jobId);
  };

  proc.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  proc.on('error', (err) => {
    console.error('Failed to spawn yt-dlp:', err.message);
    cleanup();
    if (!res.headersSent) {
      res.status(500).json({ error: 'yt-dlp binary not found or failed to launch' });
    }
  });

  // Kill yt-dlp & remove temp files if the phone drops connection mid-extract
  req.on('close', () => {
    if (!res.writableEnded) {
      aborted = true;
      proc.kill('SIGTERM');
      cleanup();
    }
  });

  proc.on('close', (code) => {
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

app.listen(PORT, HOST, () => {
  console.log(`StudyMedia sidecar listening on http://${HOST}:${PORT}`);
  console.log(`Allowed CORS origins: ${EFFECTIVE_ORIGINS.join(', ')}`);
  if (!API_KEY) {
    console.warn('WARNING: API_KEY is not set in .env — all requests will return 401 Unauthorized.');
  }
});
