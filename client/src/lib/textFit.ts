import Konva from 'konva';
import type { SubtitleStyle } from '../types/Style';

/**
 * Caption-box text fitting, shared by the Konva preview and the ASS
 * generator so both produce identical line breaks and font sizes.
 *
 * The style's fontSize acts as the *maximum*: the fitter searches for the
 * largest size ≤ max whose greedy word-wrapped lines fit the box (minus
 * padding) in both axes. Explicit newlines in the cue are preserved.
 * Line breaks are returned explicitly (the ASS output joins with \N) so the
 * export never depends on libass's own wrapping.
 */

export interface FittedText {
  fontSize: number;
  lines: string[];
  /** Width of the widest line and total text height, in the same px unit as the box. */
  width: number;
  height: number;
}

/** Box padding as a fraction of the box's smaller dimension. */
export const CAPTION_BOX_PAD_RATIO = 0.1;

const MIN_FONT_SIZE = 8;
/** Fraction of the inner width the fitter targets, absorbing renderer deltas. */
const WIDTH_SAFETY = 0.98;

// Measure with a (reused, off-stage) Konva.Text node so the numbers come
// from the exact engine the preview renders with — no truncation surprises.
let measureNode: Konva.Text | null = null;
function measureWidth(text: string, style: SubtitleStyle, size: number): number {
  if (!measureNode) measureNode = new Konva.Text({});
  measureNode.setAttrs({
    text,
    fontFamily: style.fontFamily,
    fontSize: size,
    fontStyle:
      style.bold && style.italic ? 'italic bold' : style.bold ? 'bold' : style.italic ? 'italic' : 'normal',
    letterSpacing: style.letterSpacing,
    width: undefined,
  });
  return measureNode.width();
}

/** Greedy word wrap at a given size; single overlong words overflow (caller shrinks). */
function wrapAtSize(
  text: string,
  style: SubtitleStyle,
  size: number,
  maxWidth: number,
): { lines: string[]; fits: boolean } {
  const lines: string[] = [];
  let fits = true;
  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;
    let current = words[0];
    for (const word of words.slice(1)) {
      const candidate = `${current} ${word}`;
      if (measureWidth(candidate, style, size) <= maxWidth) {
        current = candidate;
      } else {
        lines.push(current);
        current = word;
      }
    }
    lines.push(current);
  }
  for (const line of lines) {
    if (measureWidth(line, style, size) > maxWidth) fits = false;
  }
  return { lines, fits };
}

/**
 * Fits text into a box of boxWidth × boxHeight (video pixels), returning the
 * chosen font size and explicit line breaks. Binary-searches the size.
 */
export function fitTextToBox(
  text: string,
  style: SubtitleStyle,
  boxWidth: number,
  boxHeight: number,
): FittedText {
  const pad = captionBoxPadding(boxWidth, boxHeight);
  const innerW = Math.max(10, (boxWidth - pad * 2) * WIDTH_SAFETY);
  const innerH = Math.max(10, boxHeight - pad * 2);

  const fitsAt = (size: number): string[] | null => {
    const { lines, fits } = wrapAtSize(text, style, size, innerW);
    if (!fits) return null;
    const height = lines.length * size * style.lineSpacing;
    return height <= innerH ? lines : null;
  };

  let bestSize = MIN_FONT_SIZE;
  let bestLines = text.split('\n');
  let lo = MIN_FONT_SIZE;
  let hi = Math.max(MIN_FONT_SIZE, style.fontSize);
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    const lines = fitsAt(mid);
    if (lines) {
      bestSize = mid;
      bestLines = lines;
      lo = mid;
    } else {
      hi = mid;
    }
  }
  const fontSize = Math.floor(bestSize * 10) / 10;
  const width = Math.max(...bestLines.map((l) => measureWidth(l, style, fontSize)), 1);
  return {
    fontSize,
    lines: bestLines,
    width,
    height: bestLines.length * fontSize * style.lineSpacing,
  };
}

export function captionBoxPadding(boxWidth: number, boxHeight: number): number {
  return Math.min(boxWidth, boxHeight) * CAPTION_BOX_PAD_RATIO;
}

/**
 * Per-frame fade multiplier for a cue (0..1). Used by the preview; the ASS
 * export expresses the same ramp with \fad.
 */
export function fadeAlphaAt(t: number, start: number, end: number, fadeMs: number): number {
  if (fadeMs <= 0) return 1;
  const fade = Math.min(fadeMs / 1000, (end - start) / 2);
  if (fade <= 0) return 1;
  const a = Math.min((t - start) / fade, (end - t) / fade, 1);
  return Math.max(0, Math.min(1, a));
}
