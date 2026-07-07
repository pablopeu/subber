import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { getJob, startExportJob } from './jobs.js';
import { FONTS_DIR, INBOX_DIR, IS_PACKAGED, TMP_DIR, WEB_DIR, resolveFfmpeg } from './paths.js';

/**
 * Subber export backend.
 *
 * Endpoints:
 *   GET  /api/fonts                → font manifest (family + TTF base path)
 *   GET  /fonts/<file>.ttf         → font files (shared by browser & FFmpeg)
 *   POST /api/export               → start a burn-in job (video + ASS)
 *   GET  /api/export/:id           → job status/progress
 *   GET  /api/export/:id/download  → rendered MP4
 *   GET  /api/inbox                → media/subtitle files dropped in <repo>/temp
 *   GET  /api/inbox/:name          → download one inbox file
 */

const PORT = Number(process.env.PORT ?? 3001);
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024 * 1024;

fs.mkdirSync(TMP_DIR, { recursive: true });

const app = express();
const upload = multer({
  dest: path.join(TMP_DIR, 'uploads'),
  limits: { fileSize: MAX_UPLOAD_BYTES },
});

app.use('/fonts', express.static(FONTS_DIR, { immutable: true, maxAge: '30d' }));

app.get('/api/fonts', (_req, res) => {
  const manifestPath = path.join(FONTS_DIR, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    res.json([]);
    return;
  }
  res.sendFile(manifestPath);
});

const SUBTITLE_EXT = /\.(srt|vtt|ass|ssa|sub|txt)$/i;
const VIDEO_EXT = /\.(mp4|mov|mkv|webm)$/i;

app.get('/api/inbox', (_req, res) => {
  if (!fs.existsSync(INBOX_DIR)) {
    res.json([]);
    return;
  }
  const files = fs
    .readdirSync(INBOX_DIR, { withFileTypes: true })
    .filter((e) => e.isFile() && (SUBTITLE_EXT.test(e.name) || VIDEO_EXT.test(e.name)))
    .map((e) => {
      const stat = fs.statSync(path.join(INBOX_DIR, e.name));
      return {
        name: e.name,
        size: stat.size,
        mtime: stat.mtimeMs,
        kind: VIDEO_EXT.test(e.name) ? 'video' : 'subtitle',
      };
    })
    .sort((a, b) => b.mtime - a.mtime);
  res.json(files);
});

app.get('/api/inbox/:name', (req, res) => {
  // basename() blocks path traversal; only files listed by /api/inbox are valid.
  const name = path.basename(req.params.name);
  const file = path.join(INBOX_DIR, name);
  if (!(SUBTITLE_EXT.test(name) || VIDEO_EXT.test(name)) || !fs.existsSync(file)) {
    return res.status(404).send('Not found');
  }
  res.sendFile(file);
});

app.post('/api/export', upload.single('video'), async (req, res) => {
  try {
    const { ass, duration } = req.body ?? {};
    if (!req.file) return res.status(400).send('Missing video file');
    if (typeof ass !== 'string' || !ass.includes('[Events]')) {
      return res.status(400).send('Missing or invalid ASS subtitle data');
    }
    const job = await startExportJob({
      videoPath: req.file.path,
      ass,
      duration: Number(duration) || 0,
      fontsDir: FONTS_DIR,
      tmpDir: TMP_DIR,
      ffmpegPath: resolveFfmpeg(),
    });
    res.json({ id: job.id });
  } catch (err) {
    console.error('export failed to start:', err);
    res.status(500).send(err instanceof Error ? err.message : 'Internal error');
  }
});

app.get('/api/export/:id', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).send('Unknown job');
  res.json({ status: job.status, progress: job.progress, error: job.error });
});

app.get('/api/export/:id/download', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).send('Unknown job');
  if (job.status !== 'done') return res.status(409).send('Job not finished');
  res.download(job.outputPath, 'video_subtitled.mp4');
});

// Desktop app "Quit": the browser UI (or the system tray) calls this to stop
// the server cleanly. Responds first, then exits after a beat.
app.post('/api/shutdown', (_req, res) => {
  res.json({ ok: true });
  setImmediate(() => process.exit(0));
});

// Packaged mode: serve the built client so the whole app runs from this
// process — open http://localhost:PORT and everything stays on this machine.
if (fs.existsSync(path.join(WEB_DIR, 'index.html'))) {
  app.use(express.static(WEB_DIR));
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api/') || req.path.startsWith('/fonts/')) {
      return next();
    }
    res.sendFile(path.join(WEB_DIR, 'index.html'));
  });
}

function openBrowser(url) {
  if (process.env.SUBBER_NO_OPEN === '1') return;
  if (process.platform === 'win32') {
    spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  } else if (process.platform === 'darwin') {
    spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
  } else {
    spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
  }
}

const server = app.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`Subber listening on ${url}`);
  console.log(`ffmpeg: ${resolveFfmpeg()} · inbox: ${INBOX_DIR}`);
  if (!fs.existsSync(path.join(FONTS_DIR, 'manifest.json'))) {
    console.warn('No fonts found — run `npm run fonts -w server` to fetch Google Fonts.');
  }
  // Pop the browser + (on Windows) the system-tray helper.
  if (IS_PACKAGED) openBrowser(url);
  if (IS_PACKAGED && process.platform === 'win32') {
    const tray = path.join(BASE, 'tray.ps1');
    if (fs.existsSync(tray)) {
      try {
        spawn(
          'powershell.exe',
          ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', tray, '-Port', String(PORT)],
          { detached: true, stdio: 'ignore', windowsHide: true },
        ).unref();
      } catch (e) {
        console.warn('Could not start tray helper:', e.message);
      }
    }
  }
});

// Single instance: if the port is taken, another Subber is already running —
// focus its window and exit this one instead of starting a second session.
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log(`Subber is already running on port ${PORT}. Opening the existing window.`);
    openBrowser(`http://localhost:${PORT}`);
    process.exit(0);
  }
  console.error('Failed to listen:', err);
  process.exit(1);
});
