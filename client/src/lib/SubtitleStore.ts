import { create } from 'zustand';
import type { Subtitle } from '../types/Subtitle';
import { createSubtitle, resolveCueStyles, sortSubtitles, uid } from '../types/Subtitle';
import type { StylePreset, SubtitleStyle } from '../types/Style';
import { DEFAULT_STYLE } from '../types/Style';
import { loadCustomPresets, saveCustomPresets } from './presets';
import { clamp } from './time';

/**
 * Central editor state (zustand). Components subscribe with narrow
 * selectors so a 60 fps `currentTime` tick only re-renders the playhead,
 * the time display and the subtitle canvas — never the <video> element.
 */

/** Minimum length either half of a split cue is allowed to end up with. */
const MIN_SPLIT_DURATION = 0.1;

export interface VideoMeta {
  duration: number;
  width: number;
  height: number;
  name: string;
  /** Absolute local path, only present when picked via the native dialog. */
  path?: string;
}

/** Where the server streams a path-restored video from — see /api/local-file. */
export function localFileUrl(filePath: string): string {
  return `/api/local-file?path=${encodeURIComponent(filePath)}`;
}

interface EditorState {
  // Video
  videoUrl: string | null;
  videoFile: File | null;
  /** Absolute local path when the video was restored/picked by path (see setVideoByPath). */
  videoPath: string | null;
  videoMeta: VideoMeta | null;
  currentTime: number;
  isPlaying: boolean;
  /**
   * The video a loaded project expects (name/dimensions/duration/path), shown
   * as a hint until the matching file is actually attached — a project file
   * never embeds the video itself.
   */
  expectedVideo: VideoMeta | null;

  // Subtitles
  subtitles: Subtitle[];
  selectedId: string | null;

  // Styling
  style: SubtitleStyle;
  customPresets: StylePreset[];

  /**
   * Undo history: a snapshot of {subtitles, style} taken right before each
   * edit, oldest first. `undo()` walks back one entry at a time, all the
   * way to the project's very first change — not just the last one.
   */
  history: Array<{ subtitles: Subtitle[]; style: SubtitleStyle }>;
  /** history.length at the last save/load/new-project — the "clean" point. */
  savedHistoryLength: number;

  // Actions
  setVideo(file: File): void;
  /** Attaches a video the server can read directly by path — no upload, no re-fetch as a Blob. */
  setVideoByPath(filePath: string): void;
  setVideoMeta(meta: VideoMeta): void;
  setCurrentTime(t: number): void;
  setPlaying(p: boolean): void;

  setSubtitles(subs: Subtitle[]): void;
  addSubtitleAt(t: number): Subtitle;
  updateSubtitle(id: string, patch: Partial<Omit<Subtitle, 'id'>>): void;
  moveSubtitle(id: string, newStart: number): void;
  deleteSubtitle(id: string): void;
  /** Splits a cue in two at time `at`, giving each half a copy of the text. */
  splitSubtitle(id: string, at: number): void;
  selectSubtitle(id: string | null): void;
  /** Steps back through the edit history, one change at a time. */
  undo(): void;

  updateStyle(patch: Partial<SubtitleStyle>): void;
  /** Patches the style a cue actually renders with: its segment's override, or the base style. */
  updateStyleAt(cueId: string, patch: Partial<SubtitleStyle>): void;
  applyPreset(preset: StylePreset): void;
  applyPresetToCue(cueId: string, preset: StylePreset): void;
  clearCueStyle(cueId: string): void;
  saveCustomPreset(name: string): void;
  deleteCustomPreset(id: string): void;

  /** Resets to a blank project: no video, no subtitles, default style. */
  newProject(): void;
  /** Replaces subtitles + style with a loaded project's; clears undo history. */
  loadProject(data: { subtitles: Subtitle[]; style: SubtitleStyle; video?: VideoMeta | null }): void;
  /** Marks the current history position as the last-saved point. */
  markSaved(): void;
}

/** True when there's subtitle work that hasn't been saved since the last edit. */
export function isDirty(s: EditorState): boolean {
  return s.subtitles.length > 0 && s.history.length !== s.savedHistoryLength;
}

/**
 * The <video> element registers itself here so actions (seek) can drive it
 * directly without routing DOM refs through React state.
 */
let videoEl: HTMLVideoElement | null = null;
export function registerVideoElement(el: HTMLVideoElement | null): void {
  videoEl = el;
}
export function seekVideo(t: number): void {
  const s = useEditorStore.getState();
  const clamped = clamp(t, 0, s.videoMeta?.duration ?? t);
  if (videoEl) videoEl.currentTime = clamped;
  s.setCurrentTime(clamped);
}
export function togglePlayback(): void {
  if (!videoEl) return;
  if (videoEl.paused) void videoEl.play();
  else videoEl.pause();
}

export const useEditorStore = createEditorStore();

// Dev aid: expose the live store instance for browser automation, where a
// dynamic import() would get a separate HMR copy instead of this one.
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__editorStore = useEditorStore;
}

function createEditorStore() {
  return create<EditorState>((set, get) => {
    // Snapshots the pre-edit {subtitles, style} onto the undo stack. Called
    // at the top of every leaf action that changes subtitle/style content,
    // BEFORE the mutating set() — never from undo() itself, or undoing would
    // push its own reversal back onto the stack.
    const pushHistory = () => {
      const s = get();
      set({ history: [...s.history, { subtitles: s.subtitles, style: s.style }] });
    };

    return {
      videoUrl: null,
      videoFile: null,
      videoPath: null,
      videoMeta: null,
      expectedVideo: null,
      currentTime: 0,
      isPlaying: false,

      subtitles: [],
      selectedId: null,

      style: { ...DEFAULT_STYLE },
      customPresets: loadCustomPresets(),

      history: [],
      savedHistoryLength: 0,

      setVideo(file) {
        const prev = get().videoUrl;
        if (prev?.startsWith('blob:')) URL.revokeObjectURL(prev);
        set({
          videoFile: file,
          videoPath: null,
          videoUrl: URL.createObjectURL(file),
          videoMeta: null,
          expectedVideo: null,
          currentTime: 0,
          isPlaying: false,
        });
      },

      setVideoByPath(filePath) {
        const prev = get().videoUrl;
        if (prev?.startsWith('blob:')) URL.revokeObjectURL(prev);
        set({
          videoFile: null,
          videoPath: filePath,
          videoUrl: localFileUrl(filePath),
          videoMeta: null,
          expectedVideo: null,
          currentTime: 0,
          isPlaying: false,
        });
      },

      setVideoMeta(meta) {
        set({ videoMeta: meta });
      },

      setCurrentTime(t) {
        set({ currentTime: t });
      },

      setPlaying(p) {
        set({ isPlaying: p });
      },

      setSubtitles(subs) {
        pushHistory();
        set({ subtitles: sortSubtitles(subs), selectedId: null });
      },

      addSubtitleAt(t) {
        pushHistory();
        const sub = createSubtitle(t, t + 2, 'New subtitle');
        set((s) => ({
          subtitles: sortSubtitles([...s.subtitles, sub]),
          selectedId: sub.id,
        }));
        return sub;
      },

      updateSubtitle(id, patch) {
        pushHistory();
        set((s) => ({
          subtitles: sortSubtitles(
            s.subtitles.map((sub) => (sub.id === id ? { ...sub, ...patch } : sub)),
          ),
        }));
      },

      moveSubtitle(id, newStart) {
        pushHistory();
        set((s) => ({
          subtitles: sortSubtitles(
            s.subtitles.map((sub) => {
              if (sub.id !== id) return sub;
              const dur = sub.end - sub.start;
              const start = Math.max(0, newStart);
              return { ...sub, start, end: start + dur };
            }),
          ),
        }));
      },

      deleteSubtitle(id) {
        pushHistory();
        set((s) => ({
          subtitles: s.subtitles.filter((sub) => sub.id !== id),
          selectedId: s.selectedId === id ? null : s.selectedId,
        }));
      },

      splitSubtitle(id, at) {
        const s = get();
        const idx = s.subtitles.findIndex((sub) => sub.id === id);
        if (idx === -1) return;
        const sub = s.subtitles[idx];
        const t = clamp(at, sub.start + MIN_SPLIT_DURATION, sub.end - MIN_SPLIT_DURATION);
        if (t <= sub.start || t >= sub.end) return;

        // Divide the text at roughly the same point the time is split, so
        // each half starts with a sensible default the user can then edit.
        const words = sub.text.trim().split(/\s+/).filter(Boolean);
        let firstText = sub.text;
        let secondText = sub.text;
        if (words.length >= 2) {
          const ratio = (t - sub.start) / (sub.end - sub.start);
          const cut = Math.min(words.length - 1, Math.max(1, Math.round(ratio * words.length)));
          firstText = words.slice(0, cut).join(' ');
          secondText = words.slice(cut).join(' ');
        }

        const first: Subtitle = { ...sub, end: t, text: firstText };
        const second: Subtitle = createSubtitle(t, sub.end, secondText);

        const next = [...s.subtitles];
        next.splice(idx, 1, first, second);

        pushHistory();
        set({ subtitles: sortSubtitles(next), selectedId: second.id });
      },

      selectSubtitle(id) {
        set({ selectedId: id });
      },

      undo() {
        const s = get();
        if (s.history.length === 0) return;
        const prev = s.history[s.history.length - 1];
        set({
          subtitles: prev.subtitles,
          style: prev.style,
          history: s.history.slice(0, -1),
          selectedId: null,
        });
      },

      updateStyle(patch) {
        pushHistory();
        set((s) => ({ style: { ...s.style, ...patch } }));
      },

      updateStyleAt(cueId, patch) {
        const subs = get().subtitles;
        const cue = subs.find((s) => s.id === cueId);
        if (!cue) {
          // No cue (e.g. the idle caption box) — fall back to the base style.
          get().updateStyle(patch);
          return;
        }
        // Editing a cue starts (or updates) a style segment at THIS cue, merging
        // the cue's current effective style with the patch. The change then sticks
        // to this cue and the ones inheriting from it — "selected cue onward".
        const effective = resolveCueStyles(subs, get().style).get(cueId) ?? get().style;
        get().updateSubtitle(cueId, { styleOverride: { ...effective, ...patch } });
      },

      applyPreset(preset) {
        pushHistory();
        set({ style: { ...preset.style } });
      },

      applyPresetToCue(cueId, preset) {
        get().updateSubtitle(cueId, {
          styleOverride: { ...preset.style },
          presetName: preset.name,
        });
      },

      clearCueStyle(cueId) {
        get().updateSubtitle(cueId, { styleOverride: undefined, presetName: undefined });
      },

      saveCustomPreset(name) {
        const preset: StylePreset = {
          id: uid(),
          name,
          builtin: false,
          style: { ...get().style },
        };
        const customPresets = [...get().customPresets, preset];
        saveCustomPresets(customPresets);
        set({ customPresets });
      },

      deleteCustomPreset(id) {
        const customPresets = get().customPresets.filter((p) => p.id !== id);
        saveCustomPresets(customPresets);
        set({ customPresets });
      },

      newProject() {
        const prev = get().videoUrl;
        if (prev?.startsWith('blob:')) URL.revokeObjectURL(prev);
        set({
          videoUrl: null,
          videoFile: null,
          videoPath: null,
          videoMeta: null,
          expectedVideo: null,
          currentTime: 0,
          isPlaying: false,
          subtitles: [],
          selectedId: null,
          style: { ...DEFAULT_STYLE },
          history: [],
          savedHistoryLength: 0,
        });
      },

      loadProject(data) {
        set({
          subtitles: sortSubtitles(data.subtitles),
          style: data.style,
          expectedVideo: data.video ?? null,
          selectedId: null,
          history: [],
          savedHistoryLength: 0,
        });
      },

      markSaved() {
        set((s) => ({ savedHistoryLength: s.history.length }));
      },
    };
  });
}
