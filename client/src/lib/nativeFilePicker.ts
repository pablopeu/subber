/**
 * Asks the local server to open a native "select video" dialog (see
 * server/src/index.js's /api/pick-file) — it has real filesystem access, so
 * it can report an absolute path a browser tab never can. Resolves to null
 * if the user cancelled; throws if the platform helper isn't available
 * (missing zenity/PowerShell), so callers can fall back to a classic
 * <input type="file">.
 */
export async function pickVideoPathNative(): Promise<string | null> {
  const res = await fetch('/api/pick-file', { method: 'POST' });
  if (!res.ok) throw new Error('native picker unavailable');
  const { path } = (await res.json()) as { path: string | null };
  return path;
}
