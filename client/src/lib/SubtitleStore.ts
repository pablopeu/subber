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
}

interface EditorState {
  // Video
  videoUrl: string | null;
  videoFile: File | null;
  videoMeta: VideoMeta | null;
  currentTime: number;
  isPlaying: boolean;

  // Subtitles
  subtitles: Subtitle[];
  selectedId: string | null;

  // Styling
  style: SubtitleStyle;
  customPresets: StylePreset[];

  // Actions
  setVideo(file: File): void;
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

  updateStyle(patch: Partial<SubtitleStyle>): void;
  /** Patches the style a cue actually renders with: its segment's override, or the base style. */
  updateStyleAt(cueId: string, patch: Partial<SubtitleStyle>): void;
  applyPreset(preset: StylePreset): void;
  applyPresetToCue(cueId: string, preset: StylePreset): void;
  clearCueStyle(cueId: string): void;
  saveCustomPreset(name: string): void;
  deleteCustomPreset(id: string): void;
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
  return create<EditorState>((set, get) => ({
  videoUrl: null,
  videoFile: null,
  videoMeta: null,
  currentTime: 0,
  isPlaying: false,

  subtitles: [],
  selectedId: null,

  style: { ...DEFAULT_STYLE },
  customPresets: loadCustomPresets(),

  setVideo(file) {
    const prev = get().videoUrl;
    if (prev) URL.revokeObjectURL(prev);
    set({
      videoFile: file,
      videoUrl: URL.createObjectURL(file),
      videoMeta: null,
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
    set({ subtitles: sortSubtitles(subs), selectedId: null });
  },

  addSubtitleAt(t) {
    const sub = createSubtitle(t, t + 2, 'New subtitle');
    set((s) => ({
      subtitles: sortSubtitles([...s.subtitles, sub]),
      selectedId: sub.id,
    }));
    return sub;
  },

  updateSubtitle(id, patch) {
    set((s) => ({
      subtitles: sortSubtitles(
        s.subtitles.map((sub) => (sub.id === id ? { ...sub, ...patch } : sub)),
      ),
    }));
  },

  moveSubtitle(id, newStart) {
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
    set((s) => ({
      subtitles: s.subtitles.filter((sub) => sub.id !== id),
      selectedId: s.selectedId === id ? null : s.selectedId,
    }));
  },

  splitSubtitle(id, at) {
    set((s) => {
      const idx = s.subtitles.findIndex((sub) => sub.id === id);
      if (idx === -1) return s;
      const sub = s.subtitles[idx];
      const t = clamp(at, sub.start + MIN_SPLIT_DURATION, sub.end - MIN_SPLIT_DURATION);
      if (t <= sub.start || t >= sub.end) return s;

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
      return { subtitles: sortSubtitles(next), selectedId: second.id };
    });
  },

  selectSubtitle(id) {
    set({ selectedId: id });
  },

  updateStyle(patch) {
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
  }));
}
