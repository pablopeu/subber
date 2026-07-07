import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Filesystem layout resolution for the two run modes:
 * - Dev / repo mode: assets live in server/ and the inbox is <repo>/temp.
 * - Packaged mode (single executable built by scripts/package-win.mjs):
 *   everything lives next to the executable — web/ (built client),
 *   fonts/, temp/ (inbox), tmp/ (jobs) and optionally ffmpeg(.exe).
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const IS_PACKAGED = 'pkg' in process || process.env.SUBBER_PACKAGED === '1';

export const BASE = IS_PACKAGED
  ? path.dirname(process.execPath)
  : path.resolve(__dirname, '..');

export const FONTS_DIR = process.env.SUBBER_FONTS ?? path.join(BASE, 'fonts');
export const TMP_DIR = path.join(BASE, 'tmp');
export const WEB_DIR = process.env.SUBBER_WEB ?? path.join(BASE, 'web');
export const INBOX_DIR =
  process.env.SUBBER_INBOX ?? (IS_PACKAGED ? path.join(BASE, 'temp') : path.resolve(BASE, '..', 'temp'));

/** ffmpeg binary: FFMPEG_PATH env → sibling of the executable → system PATH. */
export function resolveFfmpeg() {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  const name = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const sibling = path.join(BASE, name);
  if (fs.existsSync(sibling)) return sibling;
  return 'ffmpeg';
}
