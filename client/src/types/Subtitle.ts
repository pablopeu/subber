/**
 * Core subtitle cue model. All times are in seconds (float).
 *
 * Every feature of the app — preview, timeline, editor, ASS export —
 * renders from this model. FFmpeg never manipulates subtitles directly;
 * it only consumes the ASS file generated from these objects.
 */
export interface Subtitle {
  id: string;
  start: number;
  end: number;
  text: string;
  /**
   * Optional per-cue style. A cue with a style starts a new "segment": it
   * and every following cue inherit it, until another cue sets its own.
   * Cues before the first styled cue use the global (base) style.
   */
  styleOverride?: Partial<import('./Style').SubtitleStyle>;
  /** Display name of the preset applied to this cue (when styleOverride set). */
  presetName?: string;
  /**
   * Future-proofing: word-level timings for karaoke / word-by-word
   * highlighting and ASR alignment. Unused by the current renderer.
   */
  words?: Array<{ start: number; end: number; text: string }>;
}

/**
 * ID generator with a fallback: crypto.randomUUID is unavailable on
 * insecure origins (plain-HTTP LAN access), where the app must still work.
 */
export function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createSubtitle(start: number, end: number, text: string): Subtitle {
  return { id: uid(), start, end, text };
}

/** Cues sorted by start time; ties broken by end time. */
export function sortSubtitles(subs: Subtitle[]): Subtitle[] {
  return [...subs].sort((a, b) => a.start - b.start || a.end - b.end);
}

/** All cues visible at time t (supports overlapping cues). */
export function activeSubtitlesAt(subs: Subtitle[], t: number): Subtitle[] {
  return subs.filter((s) => t >= s.start && t < s.end);
}

/**
 * Resolves the effective style of every cue: a cue with its own style
 * starts a segment inherited by the following cues; otherwise the base
 * style applies. Returns a map keyed by cue id.
 */
export function resolveCueStyles<S>(
  subs: Subtitle[],
  base: S,
): Map<string, S> {
  const map = new Map<string, S>();
  let current = base;
  for (const sub of sortSubtitles(subs)) {
    if (sub.styleOverride) {
      current = { ...base, ...sub.styleOverride } as S;
    }
    map.set(sub.id, current);
  }
  return map;
}

/**
 * The cue whose styleOverride a given cue inherits from (itself included),
 * or null when it falls through to the base style. Used so direct
 * manipulation (dragging a caption box) edits the right style source.
 */
export function styleSourceCue(subs: Subtitle[], cueId: string): Subtitle | null {
  const sorted = sortSubtitles(subs);
  let source: Subtitle | null = null;
  for (const sub of sorted) {
    if (sub.styleOverride) source = sub;
    if (sub.id === cueId) return source;
  }
  return null;
}
