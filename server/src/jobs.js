import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * In-memory FFmpeg export job manager. Each job gets its own directory
 * containing the uploaded video, the generated subtitles.ass and the
 * rendered output. Progress is parsed from FFmpeg's stderr clock.
 */

const JOB_TTL_MS = 30 * 60 * 1000;

/** @type {Map<string, Job>} */
const jobs = new Map();

/**
 * @typedef {Object} Job
 * @property {string} id
 * @property {'queued'|'processing'|'done'|'error'} status
 * @property {number} progress 0..1
 * @property {string=} error
 * @property {string} dir
 * @property {string} outputPath
 * @property {number} createdAt
 */

export function getJob(id) {
  return jobs.get(id) ?? null;
}

/**
 * @param {{ videoPath: string, ass: string, duration: number, fontsDir: string, tmpDir: string, ffmpegPath?: string }} opts
 * @returns {Promise<Job>}
 */
export async function startExportJob({ videoPath, ass, duration, fontsDir, tmpDir, ffmpegPath = 'ffmpeg' }) {
  const id = randomUUID();
  const dir = path.join(tmpDir, id);
  await fs.mkdir(dir, { recursive: true });

  const assPath = path.join(dir, 'subtitles.ass');
  const inputPath = path.join(dir, 'input' + path.extname(videoPath));
  const outputPath = path.join(dir, 'output.mp4');
  await fs.writeFile(assPath, ass, 'utf8');
  await fs.rename(videoPath, inputPath);

  // Copy fonts beside the job so the ass filter can use a RELATIVE fontsdir.
  // Windows drive letters / backslashes (C:\Users\…) break FFmpeg's filtergraph
  // escaping; a relative "fonts" has no special characters. Non-fatal: if it
  // fails, libass falls back to system fonts.
  await fs.cp(fontsDir, path.join(dir, 'fonts'), { recursive: true }).catch(() => {});

  /** @type {Job} */
  const job = { id, status: 'queued', progress: 0, dir, outputPath, createdAt: Date.now() };
  jobs.set(id, job);

  runFfmpeg(job, { inputPath, outputPath, duration, ffmpegPath });
  scheduleCleanup(job);
  return job;
}

function runFfmpeg(job, { inputPath, outputPath, duration, ffmpegPath }) {
  // filename + fontsdir are both relative to the job dir (the cwd), so there
  // are no drive letters / backslashes / colons to escape in the filter graph.
  const vf = `ass=filename=subtitles.ass:fontsdir=fonts`;
  const args = [
    '-y',
    '-i', path.basename(inputPath),
    '-vf', vf,
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '18',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-movflags', '+faststart',
    path.basename(outputPath),
  ];

  job.status = 'processing';
  const proc = spawn(ffmpegPath, args, { cwd: job.dir });

  let stderrTail = '';
  proc.stderr.on('data', (chunk) => {
    const text = chunk.toString();
    stderrTail = (stderrTail + text).slice(-4000);
    // Progress from "time=HH:MM:SS.cc" against the known duration.
    const m = /time=(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(text);
    if (m && duration > 0) {
      const t = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
      job.progress = Math.min(0.99, t / duration);
    }
  });

  proc.on('error', (err) => {
    job.status = 'error';
    job.error =
      err.code === 'ENOENT'
        ? 'FFmpeg not found. Install it (Windows: run Setup-FFmpeg.bat next to Subber.exe) and try again.'
        : `Failed to run ffmpeg: ${err.message}`;
  });

  proc.on('close', (code) => {
    if (code === 0) {
      job.status = 'done';
      job.progress = 1;
    } else {
      job.status = 'error';
      job.error = `FFmpeg exited with code ${code}:\n${lastLines(stderrTail, 8)}`;
    }
  });
}

function lastLines(text, n) {
  return text.trim().split('\n').slice(-n).join('\n');
}

function scheduleCleanup(job) {
  setTimeout(async () => {
    jobs.delete(job.id);
    await fs.rm(job.dir, { recursive: true, force: true }).catch(() => {});
  }, JOB_TTL_MS).unref();
}
