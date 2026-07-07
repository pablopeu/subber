/**
 * Font pipeline. The backend hosts a set of TTF files (fetched from Google
 * Fonts at setup time) and serves them both to the browser (via FontFace)
 * and to FFmpeg (via the ass filter's fontsdir option). Because preview and
 * export consume the *same font files*, text metrics match between the two.
 */

export interface FontInfo {
  family: string;
  /** URL path of the TTF, served by the backend. */
  file: string;
  weights: number[];
  /**
   * libass scales a style's Fontsize by the font's own (winAscent +
   * winDescent) / unitsPerEm instead of treating it as a literal em-square
   * pixel size the way canvas/CSS do, so the same nominal size renders at a
   * different — usually smaller — apparent size per font family in the
   * export than in the preview. ASSGenerator multiplies Fontsize by this
   * factor (computed once from the TTF by fetch-fonts.mjs) to compensate.
   */
  sizeCorrection?: number;
}

/** Fonts assumed available on the OS even when the backend set is missing. */
export const SYSTEM_FALLBACK_FONTS: FontInfo[] = [
  { family: 'Arial', file: '', weights: [400, 700] },
  { family: 'DejaVu Sans', file: '', weights: [400, 700] },
];

let loaded: FontInfo[] | null = null;

/** Fetches the backend font manifest and registers each face with the browser. */
export async function loadFonts(): Promise<FontInfo[]> {
  if (loaded) return loaded;
  try {
    const res = await fetch('/api/fonts');
    if (!res.ok) throw new Error(`font manifest: HTTP ${res.status}`);
    const fonts = (await res.json()) as FontInfo[];
    await Promise.allSettled(
      fonts.flatMap((f) =>
        f.weights.map(async (weight) => {
          const face = new FontFace(f.family, `url(${f.file}-${weight}.ttf)`, {
            weight: String(weight),
          });
          document.fonts.add(await face.load());
        }),
      ),
    );
    loaded = [...fonts, ...SYSTEM_FALLBACK_FONTS];
  } catch (err) {
    console.warn('Falling back to system fonts:', err);
    loaded = SYSTEM_FALLBACK_FONTS;
  }
  return loaded;
}

/**
 * The export's Fontsize correction for a family (see FontInfo.sizeCorrection).
 * Falls back to 1 (no correction) for unknown fonts or before the manifest
 * has loaded — better to under-correct than to guess.
 */
export function getFontSizeCorrection(family: string): number {
  return loaded?.find((f) => f.family === family)?.sizeCorrection ?? 1;
}
