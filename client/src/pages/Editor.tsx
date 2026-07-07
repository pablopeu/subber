import { useEffect, useRef, useState } from 'react';
import { togglePlayback, useEditorStore } from '../lib/SubtitleStore';
import { parseSubtitleFileFromFile, SUBTITLE_EXTENSIONS } from '../lib/SubtitleParser';
import { loadFonts } from '../lib/fonts';
import { VideoPlayer } from '../components/VideoPlayer';
import { SubtitleTimeline } from '../components/SubtitleTimeline';
import { SubtitleEditor } from '../components/SubtitleEditor';
import { StylePanel } from '../components/StylePanel';
import { PresetSelector } from '../components/PresetSelector';
import { ExportDialog } from '../components/ExportDialog';
import { UploadDropzone } from '../components/UploadDropzone';

type Tab = 'subtitles' | 'style' | 'presets';

/** Main editor page: header · preview + side panel · timeline. */
export function Editor() {
  const hasVideo = useEditorStore((s) => s.videoUrl !== null);
  const [tab, setTab] = useState<Tab>('subtitles');
  const [showExport, setShowExport] = useState(false);

  // Start webfont loading immediately so the preview measures correctly.
  useEffect(() => {
    void loadFonts();
  }, []);

  // Space toggles playback when not typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return;
      if (e.code === 'Space') {
        e.preventDefault();
        togglePlayback();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="editor">
      <Header onExport={() => setShowExport(true)} />
      {hasVideo ? (
        <>
          <div className="editor__main">
            <VideoPlayer />
            <aside className="side-panel">
              <nav className="side-panel__tabs">
                <TabButton tab="subtitles" current={tab} onSelect={setTab} label="Subtitles" />
                <TabButton tab="style" current={tab} onSelect={setTab} label="Style" />
                <TabButton tab="presets" current={tab} onSelect={setTab} label="Presets" />
              </nav>
              <div className="side-panel__content">
                {tab === 'subtitles' && <SubtitleEditor />}
                {tab === 'style' && <StylePanel />}
                {tab === 'presets' && <PresetSelector />}
              </div>
            </aside>
          </div>
          <SubtitleTimeline />
        </>
      ) : (
        <div className="editor__empty">
          <UploadDropzone />
        </div>
      )}
      {showExport && <ExportDialog onClose={() => setShowExport(false)} />}
    </div>
  );
}

function TabButton({
  tab,
  current,
  onSelect,
  label,
}: {
  tab: Tab;
  current: Tab;
  onSelect: (t: Tab) => void;
  label: string;
}) {
  return (
    <button
      className={`side-panel__tab${tab === current ? ' is-active' : ''}`}
      onClick={() => onSelect(tab)}
    >
      {label}
    </button>
  );
}

function Header({ onExport }: { onExport: () => void }) {
  const hasVideo = useEditorStore((s) => s.videoUrl !== null);
  const subtitleCount = useEditorStore((s) => s.subtitles.length);
  const setVideo = useEditorStore((s) => s.setVideo);
  const setSubtitles = useEditorStore((s) => s.setSubtitles);

  const videoInput = useRef<HTMLInputElement>(null);
  const srtInput = useRef<HTMLInputElement>(null);
  const [srtError, setSrtError] = useState(false);

  return (
    <header className="header">
      <span className="header__logo">
        Subber<span className="header__logo-dot">.</span>
      </span>
      <span className="header__tagline">subtitle burn-in studio</span>
      <span className="header__spacer" />

      <input
        ref={videoInput}
        type="file"
        accept="video/*,.mp4,.mov,.mkv,.webm"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) setVideo(f);
          e.target.value = '';
        }}
      />
      <input
        ref={srtInput}
        type="file"
        accept={SUBTITLE_EXTENSIONS.join(',')}
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          try {
            setSubtitles(await parseSubtitleFileFromFile(f));
            setSrtError(false);
          } catch {
            setSrtError(true);
          }
        }}
      />
      {srtError && <span className="header__error">Could not parse subtitle file</span>}
      <button className="btn btn--ghost" onClick={() => videoInput.current?.click()}>
        {hasVideo ? 'Replace video' : 'Upload video'}
      </button>
      <button className="btn btn--ghost" onClick={() => srtInput.current?.click()}>
        Upload subtitles
      </button>
      <button className="btn btn--primary" onClick={onExport} disabled={!hasVideo || subtitleCount === 0}>
        Export
      </button>
      <button
        className="btn btn--ghost header__quit"
        title="Quit Subber (stops the local server)"
        aria-label="Quit Subber"
        onClick={() => {
          fetch('/api/shutdown', { method: 'POST' }).catch(() => {});
          setTimeout(() => window.close(), 300);
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M12 4v8" />
          <path d="M7.5 7a7 7 0 1 0 9 0" />
        </svg>
      </button>
    </header>
  );
}
