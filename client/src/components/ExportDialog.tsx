import { useState } from 'react';
import { useEditorStore } from '../lib/SubtitleStore';
import { exporter, downloadBlob, type ExportProgress } from '../lib/FFmpegExporter';
import { generateAss } from '../lib/ASSGenerator';
import { toSrt } from '../lib/SubtitleParser';

/**
 * Export modal: generates the ASS file from the current model, ships it to
 * the backend together with the original video, and tracks FFmpeg progress
 * until the burned-in MP4 is ready to download.
 */
export function ExportDialog({ onClose }: { onClose: () => void }) {
  const videoFile = useEditorStore((s) => s.videoFile);
  const videoMeta = useEditorStore((s) => s.videoMeta);
  const subtitles = useEditorStore((s) => s.subtitles);
  const style = useEditorStore((s) => s.style);

  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canExport = !!videoFile && !!videoMeta && subtitles.length > 0;
  const busy = progress !== null && progress.status !== 'done' && progress.status !== 'error';
  const outName = videoFile ? videoFile.name.replace(/\.[^.]+$/, '') + '_subtitled.mp4' : 'video.mp4';

  const startExport = async () => {
    if (!videoFile || !videoMeta) return;
    setError(null);
    try {
      const blob = await exporter.export(
        { videoFile, subtitles, style, video: videoMeta },
        setProgress,
      );
      downloadBlob(blob, outName);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setProgress({ status: 'error', progress: 0 });
    }
  };

  const downloadAss = () => {
    if (!videoMeta) return;
    downloadBlob(generateAss(subtitles, style, videoMeta), 'subtitles.ass');
  };

  return (
    <div className="modal-backdrop" onClick={() => !busy && onClose()}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal__header">
          <h2>Export video</h2>
          <button className="btn btn--icon" onClick={onClose} disabled={busy} title="Close">
            ×
          </button>
        </header>

        <div className="modal__body">
          {videoMeta && (
            <p className="modal__meta">
              {videoMeta.width}×{videoMeta.height} · {subtitles.length} subtitle
              {subtitles.length === 1 ? '' : 's'} · H.264 MP4 with subtitles burned in
            </p>
          )}
          {!canExport && (
            <p className="modal__warning">Load a video and add at least one subtitle to export.</p>
          )}

          {progress && progress.status !== 'error' && (
            <div className="progress">
              <div className="progress__bar">
                <div
                  className="progress__fill"
                  style={{ width: `${Math.round(progress.progress * 100)}%` }}
                />
              </div>
              <span className="progress__label">
                {progress.status === 'uploading' && 'Uploading video…'}
                {progress.status === 'queued' && 'Queued…'}
                {progress.status === 'processing' &&
                  `Rendering with FFmpeg… ${Math.round(progress.progress * 100)}%`}
                {progress.status === 'done' && 'Done — download started ✓'}
              </span>
            </div>
          )}
          {error && <p className="modal__error">{error}</p>}
        </div>

        <footer className="modal__footer">
          <button className="btn btn--ghost btn--small" onClick={downloadAss} disabled={!canExport}>
            Download .ass
          </button>
          <button
            className="btn btn--ghost btn--small"
            onClick={() => downloadBlob(toSrt(subtitles), 'subtitles.srt')}
            disabled={subtitles.length === 0}
          >
            Download .srt
          </button>
          <span className="modal__spacer" />
          <button className="btn btn--primary" onClick={startExport} disabled={!canExport || busy}>
            {busy ? 'Exporting…' : 'Export MP4'}
          </button>
        </footer>
      </div>
    </div>
  );
}
