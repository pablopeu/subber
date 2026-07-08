import type { Subtitle } from '../types/Subtitle';
import type { SubtitleStyle } from '../types/Style';
import { generateAss, type VideoDimensions } from './ASSGenerator';

/**
 * Export pipeline: internal model → ASS file → FFmpeg burn-in.
 *
 * The default implementation talks to the backend, which runs the real
 * FFmpeg (`-vf ass=subtitles.ass`). The `Exporter` interface exists so an
 * ffmpeg.wasm implementation can be slotted in as a serverless fallback
 * without touching the UI.
 */

export interface ExportProgress {
  status: 'uploading' | 'queued' | 'processing' | 'done' | 'error';
  /** 0..1 */
  progress: number;
  error?: string;
}

export interface ExportRequest {
  /** Either an actual File to upload, or videoPath (a path-restored video the server already has). */
  videoFile?: File;
  videoPath?: string;
  subtitles: Subtitle[];
  style: SubtitleStyle;
  video: VideoDimensions & { duration: number };
}

export interface Exporter {
  export(req: ExportRequest, onProgress: (p: ExportProgress) => void): Promise<Blob>;
}

const POLL_INTERVAL_MS = 500;

export class ServerFFmpegExporter implements Exporter {
  async export(req: ExportRequest, onProgress: (p: ExportProgress) => void): Promise<Blob> {
    const ass = generateAss(req.subtitles, req.style, req.video);

    onProgress({ status: 'uploading', progress: 0 });
    const form = new FormData();
    form.append('ass', ass);
    form.append('duration', String(req.video.duration));
    // A path-restored video is exported straight from where it already
    // lives — the server can read it directly, no upload needed.
    if (req.videoPath) {
      form.append('videoPath', req.videoPath);
    } else if (req.videoFile) {
      form.append('video', req.videoFile, req.videoFile.name);
    } else {
      throw new Error('Nothing to export: no video file or path');
    }

    const startRes = await fetch('/api/export', { method: 'POST', body: form });
    if (!startRes.ok) {
      throw new Error(`Export failed to start (HTTP ${startRes.status}): ${await startRes.text()}`);
    }
    const { id } = (await startRes.json()) as { id: string };

    // Poll job status until FFmpeg finishes.
    for (;;) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      const res = await fetch(`/api/export/${id}`);
      if (!res.ok) throw new Error(`Lost export job (HTTP ${res.status})`);
      const job = (await res.json()) as ExportProgress;
      onProgress(job);
      if (job.status === 'done') break;
      if (job.status === 'error') throw new Error(job.error ?? 'FFmpeg failed');
    }

    const dl = await fetch(`/api/export/${id}/download`);
    if (!dl.ok) throw new Error(`Download failed (HTTP ${dl.status})`);
    return dl.blob();
  }
}

export const exporter: Exporter = new ServerFFmpegExporter();

/** Triggers a browser download of a generated blob/text file. */
export function downloadBlob(data: Blob | string, filename: string): void {
  const blob = typeof data === 'string' ? new Blob([data], { type: 'text/plain' }) : data;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
