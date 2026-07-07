import { useEffect, useState } from 'react';
import { fetchInboxFile, listInbox, type InboxFile } from '../lib/inbox';
import { parseSubtitleFileFromFile } from '../lib/SubtitleParser';
import { useEditorStore } from '../lib/SubtitleStore';

/**
 * Lists media/subtitle files found in the server's temp/ folder and imports
 * them on click — subtitles are parsed into the editor, videos are loaded
 * into the player.
 */
export function ServerInbox({ kinds = ['video', 'subtitle'] }: { kinds?: InboxFile['kind'][] }) {
  const setVideo = useEditorStore((s) => s.setVideo);
  const setSubtitles = useEditorStore((s) => s.setSubtitles);

  const [files, setFiles] = useState<InboxFile[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void listInbox().then((all) => setFiles(all.filter((f) => kinds.includes(f.kind))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!files || files.length === 0) return null;

  const importFile = async (f: InboxFile) => {
    setBusy(f.name);
    setError(null);
    try {
      const file = await fetchInboxFile(f);
      if (f.kind === 'video') setVideo(file);
      else setSubtitles(await parseSubtitleFileFromFile(file));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="inbox" onClick={(e) => e.stopPropagation()}>
      <p className="inbox__title">Found on the server (temp/):</p>
      {files.map((f) => (
        <button
          key={f.name}
          className="inbox__file"
          disabled={busy !== null}
          onClick={() => void importFile(f)}
        >
          <span className="inbox__icon">{f.kind === 'video' ? '🎞' : '💬'}</span>
          <span className="inbox__name">{f.name}</span>
          <span className="inbox__size">
            {busy === f.name ? 'importing…' : formatSize(f.size)}
          </span>
        </button>
      ))}
      {error && <p className="inbox__error">{error}</p>}
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes >= 1e9) return (bytes / 1e9).toFixed(1) + ' GB';
  if (bytes >= 1e6) return (bytes / 1e6).toFixed(1) + ' MB';
  return Math.max(1, Math.round(bytes / 1e3)) + ' KB';
}
