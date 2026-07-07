/**
 * Subtitle style model — the single source of truth for both the Konva
 * live preview and the generated ASS file. Sizes and offsets are expressed
 * in video pixels (relative to the video's native resolution), so preview
 * and export stay visually identical regardless of the on-screen zoom.
 */

export type SubtitleAlignment = 'bottom' | 'top' | 'center';

/** Normalized rectangle (0..1 of video width/height), top-left anchored. */
export interface NormalizedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Placeholder for future animated subtitle support. */
export type SubtitleAnimation = 'none' | 'fade' | 'pop' | 'slide-up' | 'typewriter';

export interface SubtitleStyle {
  fontFamily: string;
  /** Font size in video pixels. */
  fontSize: number;
  color: string;

  outlineColor: string;
  outlineWidth: number;

  shadow: boolean;
  shadowColor: string;
  shadowBlur: number;
  shadowOffsetX: number;
  shadowOffsetY: number;

  alignment: SubtitleAlignment;
  marginBottom: number;
  marginTop: number;

  bold: boolean;
  italic: boolean;
  underline: boolean;

  letterSpacing: number;
  /** Line height multiplier. Applied in preview; ASS approximates it. */
  lineSpacing: number;

  background: boolean;
  backgroundColor: string;
  /** 0..1 — alpha of the background box. */
  backgroundOpacity: number;
  /** Rounded corners of the box. Preview-accurate; ASS boxes are square. */
  borderRadius: number;

  /** 0..1 — overall text opacity. */
  opacity: number;

  /**
   * Free positioning: normalized center of the subtitle block (0..1 in both
   * axes). When null, the alignment + margins rules apply instead.
   */
  position: { x: number; y: number } | null;

  /**
   * Caption box mode ("Loud"-style): subtitles render inside a fixed box
   * placed anywhere on the video. Font size auto-fits so text never
   * overflows the box. Overrides alignment / free position / inline
   * background while enabled.
   */
  captionBox: boolean;
  /** Position + size of the caption box, draggable/resizable on the preview. */
  boxRect: NormalizedRect;
  /** Fade in/out duration for each cue, in milliseconds (0 = off). */
  fadeMs: number;

  /** Placeholder — no-op today, reserved for animated subtitle rendering. */
  animation: SubtitleAnimation;
}

export const DEFAULT_STYLE: SubtitleStyle = {
  fontFamily: 'Inter',
  fontSize: 48,
  color: '#ffffff',
  outlineColor: '#000000',
  outlineWidth: 3,
  shadow: false,
  shadowColor: '#000000',
  shadowBlur: 8,
  shadowOffsetX: 0,
  shadowOffsetY: 4,
  alignment: 'bottom',
  marginBottom: 64,
  marginTop: 64,
  bold: false,
  italic: false,
  underline: false,
  letterSpacing: 0,
  lineSpacing: 1.2,
  background: false,
  backgroundColor: '#000000',
  backgroundOpacity: 0.6,
  borderRadius: 8,
  opacity: 1,
  position: null,
  captionBox: false,
  boxRect: { x: 0.25, y: 0.68, width: 0.5, height: 0.22 },
  fadeMs: 150,
  animation: 'none',
};

export interface StylePreset {
  id: string;
  name: string;
  /** Built-in presets ship with the app; custom ones live in localStorage. */
  builtin: boolean;
  style: SubtitleStyle;
}
