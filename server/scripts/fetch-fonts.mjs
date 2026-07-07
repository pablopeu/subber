/**
 * Downloads a curated set of Google Fonts as TTF files into server/fonts
 * and writes manifest.json. The same files are served to the browser
 * (FontFace preview) and passed to FFmpeg (ass filter fontsdir), which is
 * what keeps preview and export typography identical.
 *
 * The Google Fonts CSS API serves TTF sources when the client does not
 * advertise woff2 support — a plain fetch (no browser UA) does exactly that.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FONTS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'fonts');

const FAMILIES = [
  { family: 'Inter', weights: [400, 700] },
  { family: 'Roboto', weights: [400, 700] },
  { family: 'Montserrat', weights: [400, 700] },
  { family: 'Poppins', weights: [400, 700] },
  { family: 'Oswald', weights: [400, 700] },
  { family: 'Bebas Neue', weights: [400] },
  { family: 'Anton', weights: [400] },
  { family: 'Playfair Display', weights: [400, 700] },
  { family: 'Orbitron', weights: [400, 700] },
];

const slug = (family) => family.toLowerCase().replace(/\s+/g, '-');

/** Reads one sfnt table's raw bytes out of a TTF buffer by 4-char tag. */
function readSfntTable(buf, tag) {
  const numTables = buf.readUInt16BE(4);
  for (let i = 0; i < numTables; i++) {
    const record = 12 + i * 16;
    if (buf.toString('ascii', record, record + 4) === tag) {
      const offset = buf.readUInt32BE(record + 8);
      const length = buf.readUInt32BE(record + 12);
      return buf.subarray(offset, offset + length);
    }
  }
  return null;
}

/**
 * libass scales a style's Fontsize by the font's (winAscent + winDescent) /
 * unitsPerEm — the OS/2 table's Windows-compatible line metrics — instead of
 * treating it as a literal em-square pixel size the way canvas/CSS do. For
 * fonts with generous vertical metrics (common in modern webfonts) that
 * makes libass render noticeably smaller than the same nominal size in the
 * browser preview, and by a different amount per family. This factor lets
 * ASSGenerator compensate so the exported burn-in matches what was designed.
 */
function fontSizeCorrection(buf) {
  const head = readSfntTable(buf, 'head');
  const os2 = readSfntTable(buf, 'OS/2');
  if (!head || !os2 || head.length < 20 || os2.length < 78) return 1;
  const unitsPerEm = head.readUInt16BE(18);
  const winAscent = os2.readUInt16BE(74);
  const winDescent = os2.readUInt16BE(76);
  if (!unitsPerEm) return 1;
  return Math.round(((winAscent + winDescent) / unitsPerEm) * 1000) / 1000;
}

async function fetchTtfUrls(family, weights) {
  const url = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@${weights.join(';')}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'curl/8' } });
  if (!res.ok) throw new Error(`CSS API ${res.status} for ${family}`);
  const css = await res.text();

  /** @type {Map<number, string>} */
  const byWeight = new Map();
  for (const block of css.match(/@font-face\s*\{[^}]*\}/g) ?? []) {
    const weight = Number(/font-weight:\s*(\d+)/.exec(block)?.[1]);
    const src = /url\((https:[^)]+\.ttf)\)/.exec(block)?.[1];
    if (weight && src && !byWeight.has(weight)) byWeight.set(weight, src);
  }
  return byWeight;
}

async function main() {
  await fs.mkdir(FONTS_DIR, { recursive: true });
  const manifest = [];

  for (const { family, weights } of FAMILIES) {
    try {
      const urls = await fetchTtfUrls(family, weights);
      const saved = [];
      let sizeCorrection = 1;
      for (const weight of weights) {
        const src = urls.get(weight) ?? urls.values().next().value;
        if (!src) continue;
        const file = path.join(FONTS_DIR, `${slug(family)}-${weight}.ttf`);
        const res = await fetch(src);
        if (!res.ok) throw new Error(`TTF download ${res.status}`);
        const bytes = Buffer.from(await res.arrayBuffer());
        await fs.writeFile(file, bytes);
        // The regular weight is the reference for sizing; metrics rarely
        // differ meaningfully across weights within the same family.
        if (weight === 400 || saved.length === 0) sizeCorrection = fontSizeCorrection(bytes);
        saved.push(weight);
      }
      if (saved.length) {
        manifest.push({ family, file: `/fonts/${slug(family)}`, weights: saved, sizeCorrection });
        console.log(`✓ ${family} (${saved.join(', ')}) size×${sizeCorrection}`);
      }
    } catch (err) {
      console.warn(`✗ ${family}: ${err.message}`);
    }
  }

  await fs.writeFile(
    path.join(FONTS_DIR, 'manifest.json'),
    JSON.stringify(manifest, null, 2),
  );
  console.log(`Wrote manifest with ${manifest.length} families → ${FONTS_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
