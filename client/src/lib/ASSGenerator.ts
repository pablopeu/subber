import type { Subtitle } from '../types/Subtitle';
import { resolveCueStyles, sortSubtitles } from '../types/Subtitle';
import type { SubtitleStyle } from '../types/Style';
import { toAssTimestamp } from './time';
import { fitTextToBox } from './textFit';
import { getFontSizeCorrection } from './fonts';

/**
 * Generates an ASS (Advanced SubStation Alpha) file from the internal
 * subtitle + style model. ASS is used instead of drawtext filters because
 * it natively supports outlines, shadows, alignment, margins and boxes,
 * and libass renders it deterministically inside FFmpeg.
 *
 * Parity notes (kept in sync with SubtitleCanvas.tsx):
 * - Sizes are in video pixels: PlayResX/Y = the video's native resolution
 *   and the preview scales by displayWidth / videoWidth, so both renderers
 *   work in the same coordinate space.
 * - Background box mode uses BorderStyle=3; ASS boxes have square corners
 *   and no text outline/shadow, and the preview mirrors those constraints.
 * - Caption box mode emits two events per cue: a layer-0 rounded-rect
 *   drawing (\p1) and a layer-1 text event with the auto-fitted \fs and
 *   explicit \N breaks from textFit.ts, so export wrapping never depends
 *   on libass. Fades use \fad with the same ramp the preview computes.
 * - lineSpacing has no ASS style equivalent and is preview-only.
 */

export interface VideoDimensions {
  width: number;
  height: number;
}

/** Horizontal safe margin, as a fraction of video width, on each side. */
export const SAFE_MARGIN_RATIO = 0.05;

/** Padding of the background box, derived from font size (shared with preview). */
export function boxPadding(style: SubtitleStyle): number {
  return Math.round(style.fontSize * 0.25);
}

/**
 * Converts a nominal (preview) pixel font size to the value libass needs to
 * actually render at that size for the given font — see FontInfo.sizeCorrection.
 */
function assFontSize(fontSize: number, fontFamily: string): number {
  return Math.round(fontSize * getFontSizeCorrection(fontFamily) * 10) / 10;
}

/** '#rrggbb' + alpha (0..1) → ASS '&HAABBGGRR' (AA=00 is opaque). */
export function toAssColor(hex: string, alpha = 1): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const rgb = m ? m[1] : 'ffffff';
  const r = rgb.slice(0, 2);
  const g = rgb.slice(2, 4);
  const b = rgb.slice(4, 6);
  const a = Math.round((1 - Math.max(0, Math.min(1, alpha))) * 255)
    .toString(16)
    .padStart(2, '0');
  return `&H${a}${b}${g}${r}`.toUpperCase();
}

function alignmentCode(style: SubtitleStyle): number {
  // Numpad alignment: 2 = bottom-center, 5 = middle-center, 8 = top-center.
  switch (style.alignment) {
    case 'top':
      return 8;
    case 'center':
      return 5;
    default:
      return 2;
  }
}

function escapeAssText(text: string): string {
  return text
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/\r\n|\r|\n/g, '\\N');
}

function buildStyleLine(name: string, style: SubtitleStyle): string {
  // Caption box mode draws its own rectangle event, so the text style stays
  // BorderStyle=1 with outline/shadow available.
  const inlineBox = style.background && !style.captionBox;
  const primary = toAssColor(style.color, style.opacity);
  const outline = toAssColor(style.outlineColor, style.opacity);
  // BackColour doubles as shadow colour (BorderStyle 1) or box colour (BorderStyle 3).
  const back = inlineBox
    ? toAssColor(style.backgroundColor, style.backgroundOpacity * style.opacity)
    : toAssColor(style.shadowColor, style.opacity);

  const borderStyle = inlineBox ? 3 : 1;
  // In inline box mode the Outline field becomes the box padding and text
  // outline / shadow are unavailable — the preview enforces the same rules.
  const outlineWidth = inlineBox ? boxPadding(style) : style.outlineWidth;
  const shadowDepth = 0; // Shadow offsets are emitted per-event (\xshad/\yshad).

  const fields = [
    name,
    style.fontFamily,
    assFontSize(style.fontSize, style.fontFamily),
    primary,
    primary, // SecondaryColour — reserved for future karaoke support.
    outline,
    back,
    style.bold ? -1 : 0,
    style.italic ? -1 : 0,
    style.underline ? -1 : 0,
    0, // StrikeOut
    100, // ScaleX
    100, // ScaleY
    style.letterSpacing,
    0, // Angle
    borderStyle,
    outlineWidth,
    shadowDepth,
    alignmentCode(style),
    0, // MarginL — horizontal margins are set per-event.
    0, // MarginR
    0, // MarginV — vertical margin is set per-event.
    1, // Encoding
  ];
  return `Style: ${fields.join(',')}`;
}

/** Per-event override tags (position, shadow offsets, blur). */
function buildOverrides(style: SubtitleStyle, video: VideoDimensions): string {
  const tags: string[] = [];
  if (style.position && !style.captionBox) {
    const x = Math.round(style.position.x * video.width);
    const y = Math.round(style.position.y * video.height);
    // \an5 anchors the block at its center, matching the preview's drag anchor.
    tags.push(`\\an5\\pos(${x},${y})`);
  }
  if (!style.background || style.captionBox) {
    tags.push(...shadowTags(style));
  }
  tags.push(...fadeTags(style));
  return tags.length ? `{${tags.join('')}}` : '';
}

function shadowTags(style: SubtitleStyle): string[] {
  if (!style.shadow) return [];
  const tags = [`\\xshad${style.shadowOffsetX}\\yshad${style.shadowOffsetY}`];
  if (style.shadowBlur > 0) {
    // \blur softens border+shadow edges; closest ASS analog to canvas blur.
    tags.push(`\\blur${(style.shadowBlur / 2).toFixed(1)}`);
  }
  return tags;
}

/** True when the shadow needs the two-layer glow treatment (see below). */
function hasBlurredShadow(style: SubtitleStyle): boolean {
  return style.shadow && style.shadowBlur > 0;
}

/**
 * Override tags for a standalone "glow" event: a full duplicate of the cue,
 * tinted with the shadow colour and blurred, meant to sit on a layer behind
 * an unblurred copy of the text.
 *
 * libass's \blur blurs the *entire* glyph (fill included) once there's no
 * outline width for it to act on instead — which is the common case here
 * (many presets use outlineWidth 0). Blurring the live text directly turns
 * it to illegible mush instead of the soft drop-shadow the style panel and
 * canvas preview show. Rendering the blur on its own duplicate underneath a
 * crisp copy reproduces the preview's actual look: sharp text, soft glow.
 */
function shadowGlowTag(style: SubtitleStyle): string {
  const alpha = Math.round((1 - Math.max(0, Math.min(1, style.opacity))) * 255)
    .toString(16)
    .padStart(2, '0')
    .toUpperCase();
  const color = toAssColor(style.shadowColor).slice(4); // BBGGRR, no alpha byte
  const blur = (style.shadowBlur / 2).toFixed(1);
  return `\\bord0\\shad0\\1a&H${alpha}&\\1c&H${color}&\\blur${blur}`;
}

function fadeTags(style: SubtitleStyle): string[] {
  return style.fadeMs > 0 ? [`\\fad(${Math.round(style.fadeMs)},${Math.round(style.fadeMs)})`] : [];
}

/** ASS \p1 drawing of a rounded rectangle with origin at (0,0). */
function roundedRectDrawing(w: number, h: number, radius: number): string {
  const r = Math.max(0, Math.min(radius, w / 2, h / 2));
  const f = (n: number) => Math.round(n);
  if (r < 1) return `m 0 0 l ${f(w)} 0 ${f(w)} ${f(h)} 0 ${f(h)}`;
  return (
    `m ${f(r)} 0 ` +
    `l ${f(w - r)} 0 b ${f(w)} 0 ${f(w)} 0 ${f(w)} ${f(r)} ` +
    `l ${f(w)} ${f(h - r)} b ${f(w)} ${f(h)} ${f(w)} ${f(h)} ${f(w - r)} ${f(h)} ` +
    `l ${f(r)} ${f(h)} b 0 ${f(h)} 0 ${f(h)} 0 ${f(h - r)} ` +
    `l 0 ${f(r)} b 0 0 0 0 ${f(r)} 0`
  );
}

/**
 * Caption box mode: the box drawing (layer 0) plus one text event per
 * auto-fitted line (layer 1, or layers 1+2 when the shadow needs the glow
 * treatment) — each explicitly positioned rather than joined with \N, so we
 * control line spacing instead of libass. All events share timing and fade.
 */
function buildCaptionBoxEvents(
  sub: Subtitle,
  style: SubtitleStyle,
  video: VideoDimensions,
  styleName: string,
): string[] {
  const box = {
    x: style.boxRect.x * video.width,
    y: style.boxRect.y * video.height,
    w: style.boxRect.width * video.width,
    h: style.boxRect.height * video.height,
  };
  const fade = fadeTags(style).join('');
  const time = `${toAssTimestamp(sub.start)},${toAssTimestamp(sub.end)}`;

  const boxAlpha = Math.round((1 - style.backgroundOpacity * style.opacity) * 255)
    .toString(16)
    .padStart(2, '0')
    .toUpperCase();
  const boxColor = toAssColor(style.backgroundColor).slice(4); // BBGGRR part
  const boxTags = `\\an7\\pos(${Math.round(box.x)},${Math.round(box.y)})\\bord0\\shad0\\1c&H${boxColor}\\1a&H${boxAlpha}&${fade}\\p1`;
  const boxEvent = `Dialogue: 0,${time},${styleName},,0,0,0,,{${boxTags}}${roundedRectDrawing(box.w, box.h, style.borderRadius)}`;

  const fitted = fitTextToBox(sub.text.trim(), style, box.w, box.h);
  const cx = Math.round(box.x + box.w / 2);
  const cy = Math.round(box.y + box.h / 2);
  const fs = assFontSize(fitted.fontSize, style.fontFamily);

  // libass derives a multi-line event's line-to-line advance from the same
  // per-font metrics that assFontSize() compensates for, so simply joining
  // lines with \N re-inflates the gap between them by that same factor —
  // fine for the (corrected) glyph size, wrong for spacing. Positioning each
  // line as its own event at a y we compute from the *nominal* fontSize and
  // lineSpacing (matching the canvas preview) keeps glyphs correctly sized
  // without stretching the box's line spacing.
  const lineHeight = fitted.fontSize * style.lineSpacing;
  const totalHeight = fitted.lines.length * lineHeight;
  const lineY = (i: number) => Math.round(cy - totalHeight / 2 + lineHeight * (i + 0.5));
  const blurred = hasBlurredShadow(style);

  const events = [boxEvent];
  fitted.lines.forEach((line, i) => {
    const text = escapeAssText(line);
    const y = lineY(i);
    if (blurred) {
      const sx = cx + Math.round(style.shadowOffsetX);
      const sy = y + Math.round(style.shadowOffsetY);
      const glowTags = `\\an5\\pos(${sx},${sy})\\fs${fs}${shadowGlowTag(style)}${fade}`;
      events.push(`Dialogue: 1,${time},${styleName},,0,0,0,,{${glowTags}}${text}`);
      const textTags = `\\an5\\pos(${cx},${y})\\fs${fs}${fade}`;
      events.push(`Dialogue: 2,${time},${styleName},,0,0,0,,{${textTags}}${text}`);
    } else {
      const textTags = `\\an5\\pos(${cx},${y})\\fs${fs}${shadowTags(style).join('')}${fade}`;
      events.push(`Dialogue: 1,${time},${styleName},,0,0,0,,{${textTags}}${text}`);
    }
  });

  return events;
}

export function generateAss(
  subtitles: Subtitle[],
  style: SubtitleStyle,
  video: VideoDimensions,
): string {
  const marginH = Math.round(video.width * SAFE_MARGIN_RATIO);

  // Per-cue effective styles (segment inheritance), deduplicated into named
  // ASS styles: identical effective styles share one Style line.
  const effective = resolveCueStyles(subtitles, style);
  const styleNames = new Map<string, string>(); // JSON key → ASS style name
  const styleLines: string[] = [];
  const nameOf = (s: SubtitleStyle): string => {
    const key = JSON.stringify(s);
    let name = styleNames.get(key);
    if (!name) {
      name = styleNames.size === 0 ? 'Default' : `S${styleNames.size}`;
      styleNames.set(key, name);
      styleLines.push(buildStyleLine(name, s));
    }
    return name;
  };
  nameOf(style); // base style is always Default

  const events = sortSubtitles(subtitles)
    .filter((s) => s.text.trim() && s.end > s.start)
    .flatMap((s) => {
      const st = effective.get(s.id) ?? style;
      const name = nameOf(st);
      if (st.captionBox) return buildCaptionBoxEvents(s, st, video, name);

      const time = `${toAssTimestamp(s.start)},${toAssTimestamp(s.end)}`;
      const text = escapeAssText(s.text.trim());

      // Background-box mode disables shadow entirely (mirrors buildOverrides'
      // own gate), so only free/aligned text ever needs the glow treatment.
      if (!st.background && hasBlurredShadow(st)) {
        const fade = fadeTags(st).join('');

        if (st.position) {
          const x = Math.round(st.position.x * video.width);
          const y = Math.round(st.position.y * video.height);
          const sx = x + Math.round(st.shadowOffsetX);
          const sy = y + Math.round(st.shadowOffsetY);
          const glow = `{\\an5\\pos(${sx},${sy})${shadowGlowTag(st)}${fade}}`;
          const main = `{\\an5\\pos(${x},${y})${fade}}`;
          return [
            `Dialogue: 0,${time},${name},,0,0,0,,${glow}${text}`,
            `Dialogue: 1,${time},${name},,0,0,0,,${main}${text}`,
          ];
        }

        // Alignment/margin layout: two events with identical text, font and
        // alignment auto-resolve to the same anchor, so the glow copy just
        // needs its own MarginV nudged by the vertical shadow offset — no
        // \pos needed. Horizontal offset is skipped here: shifting MarginL/R
        // would change the wrap width and could wrap the glow copy onto a
        // different number of lines than the crisp copy above it.
        const mainMarginV = Math.round(st.alignment === 'top' ? st.marginTop : st.marginBottom);
        const glowMarginV = Math.round(
          st.alignment === 'top'
            ? st.marginTop + st.shadowOffsetY
            : st.marginBottom - st.shadowOffsetY,
        );
        const glow = `{${shadowGlowTag(st)}${fade}}`;
        const main = fade ? `{${fade}}` : '';
        return [
          `Dialogue: 0,${time},${name},,${marginH},${marginH},${glowMarginV},,${glow}${text}`,
          `Dialogue: 1,${time},${name},,${marginH},${marginH},${mainMarginV},,${main}${text}`,
        ];
      }

      const marginV = Math.round(st.alignment === 'top' ? st.marginTop : st.marginBottom);
      const overrideText = buildOverrides(st, video) + text;
      return [
        `Dialogue: 0,${time},${name},,${marginH},${marginH},${marginV},,${overrideText}`,
      ];
    });

  return [
    '[Script Info]',
    '; Generated by Subber',
    'ScriptType: v4.00+',
    `PlayResX: ${video.width}`,
    `PlayResY: ${video.height}`,
    'WrapStyle: 1', // Greedy end-of-line wrapping, matching canvas text wrapping.
    'ScaledBorderAndShadow: yes',
    'YCbCr Matrix: None',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    ...styleLines,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ...events,
    '',
  ].join('\n');
}
