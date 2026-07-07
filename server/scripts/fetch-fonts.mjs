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
      for (const weight of weights) {
        const src = urls.get(weight) ?? urls.values().next().value;
        if (!src) continue;
        const file = path.join(FONTS_DIR, `${slug(family)}-${weight}.ttf`);
        const res = await fetch(src);
        if (!res.ok) throw new Error(`TTF download ${res.status}`);
        await fs.writeFile(file, Buffer.from(await res.arrayBuffer()));
        saved.push(weight);
      }
      if (saved.length) {
        manifest.push({ family, file: `/fonts/${slug(family)}`, weights: saved });
        console.log(`✓ ${family} (${saved.join(', ')})`);
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
