import { useEffect, useRef, useState } from 'react';
import type React from 'react';
import { isDirty, togglePlayback, useEditorStore } from '../lib/SubtitleStore';
import { parseSubtitleFileFromFile, SUBTITLE_EXTENSIONS } from '../lib/SubtitleParser';
import { loadFonts } from '../lib/fonts';
import { downloadBlob } from '../lib/FFmpegExporter';
import { parseProjectFile, PROJECT_EXTENSION, projectFileName, serializeProject } from '../lib/ProjectFile';
import { VideoPlayer } from '../components/VideoPlayer';
import { SubtitleTimeline } from '../components/SubtitleTimeline';
import { SubtitleEditor } from '../components/SubtitleEditor';
import { StylePanel } from '../components/StylePanel';
import { PresetSelector } from '../components/PresetSelector';
import { ExportDialog } from '../components/ExportDialog';
import { UploadDropzone } from '../components/UploadDropzone';

type Tab = 'subtitles' | 'style' | 'presets';

const SIDE_PANEL_WIDTH_KEY = 'subber.sidePanelWidth';
const SIDE_PANEL_MIN = 260;
const SIDE_PANEL_MAX = 640;

function loadSidePanelWidth(): number {
  const raw = Number(localStorage.getItem(SIDE_PANEL_WIDTH_KEY));
  return raw >= SIDE_PANEL_MIN && raw <= SIDE_PANEL_MAX ? raw : 340;
}

/** Main editor page: header · preview + side panel · timeline. */
export function Editor() {
  const hasVideo = useEditorStore((s) => s.videoUrl !== null);
  const [tab, setTab] = useState<Tab>('subtitles');
  const [showExport, setShowExport] = useState(false);
  const [sidePanelWidth, setSidePanelWidthState] = useState(loadSidePanelWidth);
  const setSidePanelWidth = (w: number) => {
    setSidePanelWidthState(w);
    localStorage.setItem(SIDE_PANEL_WIDTH_KEY, String(w));
  };

  // Start webfont loading immediately so the preview measures correctly.
  useEffect(() => {
    void loadFonts();
  }, []);

  // Space toggles playback, Ctrl/Cmd+Z undoes — both skipped while typing in
  // a field, so a text field's own native undo still works as expected.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return;
      if (e.code === 'Space') {
        e.preventDefault();
        togglePlayback();
      } else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        useEditorStore.getState().undo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Native last-resort warning for closing the tab/window directly (the
  // header's own Quit/New/Open actions show a proper save/discard modal).
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!isDirty(useEditorStore.getState())) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  return (
    <div className="editor">
      <Header onExport={() => setShowExport(true)} />
      {hasVideo ? (
        <>
          <div className="editor__main">
            <VideoPlayer />
            <PanelResizer width={sidePanelWidth} onResize={setSidePanelWidth} />
            <aside
              className="side-panel"
              style={{ '--side-panel-width': `${sidePanelWidth}px` } as React.CSSProperties}
            >
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

/**
 * Drag handle between the video preview and the side panel. Dragging it
 * resizes the side panel (the video stage just fills whatever is left via
 * flex: 1); the chosen width is persisted so it survives a reload.
 */
function PanelResizer({
  width,
  onResize,
}: {
  width: number;
  onResize: (w: number) => void;
}) {
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startWidth: width };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const next = drag.startWidth - (e.clientX - drag.startX);
    onResize(Math.min(SIDE_PANEL_MAX, Math.max(SIDE_PANEL_MIN, next)));
  };

  const onPointerUp = (e: React.PointerEvent) => {
    dragRef.current = null;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  };

  return (
    <div
      className="panel-resizer"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      title="Drag to resize"
    />
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

/** What to do once a pending "discard unsaved changes?" prompt is resolved. */
type PendingAction = 'new' | 'quit' | { type: 'open'; file: File };

function quitApp(): void {
  fetch('/api/shutdown', { method: 'POST' }).catch(() => {});
  setTimeout(() => window.close(), 300);
}

function Header({ onExport }: { onExport: () => void }) {
  const hasVideo = useEditorStore((s) => s.videoUrl !== null);
  const subtitles = useEditorStore((s) => s.subtitles);
  const style = useEditorStore((s) => s.style);
  const videoFile = useEditorStore((s) => s.videoFile);
  const videoMeta = useEditorStore((s) => s.videoMeta);
  const dirty = useEditorStore(isDirty);
  const setVideo = useEditorStore((s) => s.setVideo);
  const setSubtitles = useEditorStore((s) => s.setSubtitles);
  const newProject = useEditorStore((s) => s.newProject);
  const loadProject = useEditorStore((s) => s.loadProject);
  const markSaved = useEditorStore((s) => s.markSaved);

  const videoInput = useRef<HTMLInputElement>(null);
  const srtInput = useRef<HTMLInputElement>(null);
  const projectInput = useRef<HTMLInputElement>(null);
  const [srtError, setSrtError] = useState(false);
  const [projectError, setProjectError] = useState(false);
  const [pending, setPending] = useState<PendingAction | null>(null);

  const saveProject = () => {
    const video = videoMeta ? { ...videoMeta } : null;
    const json = serializeProject(subtitles, style, video);
    downloadBlob(json, projectFileName(videoFile?.name));
    markSaved();
  };

  const openProjectFile = async (file: File) => {
    try {
      const { subtitles: subs, style: st } = parseProjectFile(await file.text());
      loadProject({ subtitles: subs, style: st });
      setProjectError(false);
    } catch {
      setProjectError(true);
    }
  };

  const runPending = (action: PendingAction) => {
    if (action === 'new') newProject();
    else if (action === 'quit') quitApp();
    else void openProjectFile(action.file);
  };

  const guarded = (action: PendingAction) => {
    if (dirty) setPending(action);
    else runPending(action);
  };

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
      <input
        ref={projectInput}
        type="file"
        accept={`${PROJECT_EXTENSION},.json`}
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          guarded({ type: 'open', file: f });
        }}
      />
      {srtError && <span className="header__error">Could not parse subtitle file</span>}
      {projectError && <span className="header__error">Could not parse project file</span>}

      <button className="btn btn--ghost" onClick={() => guarded('new')}>
        New project
      </button>
      <button className="btn btn--ghost" onClick={saveProject} disabled={subtitles.length === 0}>
        Save project
      </button>
      <button className="btn btn--ghost" onClick={() => projectInput.current?.click()}>
        Open project
      </button>
      <button className="btn btn--ghost" onClick={() => videoInput.current?.click()}>
        {hasVideo ? 'Replace video' : 'Upload video'}
      </button>
      <button className="btn btn--ghost" onClick={() => srtInput.current?.click()}>
        Upload subtitles
      </button>
      <button className="btn btn--primary" onClick={onExport} disabled={!hasVideo || subtitles.length === 0}>
        Export
      </button>
      <button
        className="btn btn--ghost header__quit"
        title="Quit Subber (stops the local server)"
        aria-label="Quit Subber"
        onClick={() => guarded('quit')}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M12 4v8" />
          <path d="M7.5 7a7 7 0 1 0 9 0" />
        </svg>
      </button>

      {pending && (
        <UnsavedChangesModal
          onSave={() => {
            saveProject();
            runPending(pending);
            setPending(null);
          }}
          onDiscard={() => {
            runPending(pending);
            setPending(null);
          }}
          onCancel={() => setPending(null)}
        />
      )}
    </header>
  );
}

function UnsavedChangesModal({
  onSave,
  onDiscard,
  onCancel,
}: {
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal__header">
          <h2>Unsaved changes</h2>
        </header>
        <div className="modal__body">
          <p className="modal__meta">
            This project has changes that haven't been saved. Save them before continuing?
          </p>
        </div>
        <footer className="modal__footer">
          <button className="btn btn--ghost btn--small" onClick={onDiscard}>
            Discard
          </button>
          <span className="modal__spacer" />
          <button className="btn btn--ghost btn--small" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn btn--primary btn--small" onClick={onSave}>
            Save
          </button>
        </footer>
      </div>
    </div>
  );
}
