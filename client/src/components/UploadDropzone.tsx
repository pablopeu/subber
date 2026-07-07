import { useRef, useState } from 'react';
import type React from 'react';
import { useEditorStore } from '../lib/SubtitleStore';
import {
  decodeSubtitleBytes,
  parseSubtitleFile,
  SUBTITLE_EXTENSIONS,
} from '../lib/SubtitleParser';
import { ServerInbox } from './ServerInbox';

const VIDEO_EXT = /\.(mp4|mov|mkv|webm)$/i;
const SUB_EXT = new RegExp(`(${SUBTITLE_EXTENSIONS.join('|').replace(/\./g, '\\.')})$`, 'i');

/**
 * Initial empty state: drag & drop (or pick) a video and, optionally, a
 * subtitle file in the same drop. Subtitle files are recognized by content,
 * not just extension. Files in the server's temp/ folder are offered too.
 */
export function UploadDropzone() {
  const setVideo = useEditorStore((s) => s.setVideo);
  const setSubtitles = useEditorStore((s) => s.setSubtitles);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = async (files: FileList | File[]) => {
    setError(null);
    for (const file of Array.from(files)) {
      if (VIDEO_EXT.test(file.name) || file.type.startsWith('video/')) {
        setVideo(file);
        continue;
      }
      // Anything else: try to parse it as subtitles regardless of extension.
      try {
        setSubtitles(parseSubtitleFile(decodeSubtitleBytes(await file.arrayBuffer())));
      } catch {
        setError(
          SUB_EXT.test(file.name)
            ? `Could not parse ${file.name} — supported: SRT, VTT, ASS/SSA, SubViewer, MicroDVD.`
            : `Unsupported file: ${file.name}`,
        );
      }
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    void handleFiles(e.dataTransfer.files);
  };

  return (
    <div
      className={`dropzone${dragOver ? ' is-dragover' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
      onClick={() => inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept={`video/*,.mp4,.mov,.mkv,.webm,${SUBTITLE_EXTENSIONS.join(',')}`}
        multiple
        hidden
        onChange={(e) => e.target.files && void handleFiles(e.target.files)}
      />
      <div className="dropzone__icon">🎬</div>
      <h2>Drop a video to get started</h2>
      <p>MP4, MOV, MKV or WebM — add a subtitle file too (SRT, VTT, ASS/SSA, SUB), or create subtitles manually.</p>
      <button className="btn btn--primary">Choose files</button>
      {error && <p className="dropzone__error">{error}</p>}
      <ServerInbox />
    </div>
  );
}
