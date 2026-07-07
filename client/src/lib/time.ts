/** Time helpers shared by the timeline, editor and exporters. Seconds in, formatted strings out. */

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/** "m:ss.cc" — compact display for the player and timeline ruler. */
export function formatTime(t: number): string {
  if (!Number.isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const cs = Math.floor((t * 100) % 100);
  return `${m}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

/** "hh:mm:ss.mmm" — precise display for cue editing fields. */
export function formatTimecode(t: number): string {
  if (!Number.isFinite(t) || t < 0) t = 0;
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60);
  const ms = Math.round((t % 1) * 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

/**
 * Parses flexible timecode input: "1:02:03.450", "02:03.4", "63.5", "90".
 * Returns null when the input is not a valid time.
 */
export function parseTimecode(input: string): number | null {
  const str = input.trim().replace(',', '.');
  if (!str) return null;
  const parts = str.split(':');
  if (parts.length > 3) return null;
  let t = 0;
  for (const part of parts) {
    if (!/^\d*(\.\d+)?$/.test(part) || part === '') return null;
    t = t * 60 + parseFloat(part);
  }
  return Number.isFinite(t) ? t : null;
}

/** SRT timestamp: "00:00:01,500". */
export function toSrtTimestamp(t: number): string {
  return formatTimecode(t).replace('.', ',');
}

/** ASS timestamp: "0:00:01.50" (centisecond precision). */
export function toAssTimestamp(t: number): string {
  if (!Number.isFinite(t) || t < 0) t = 0;
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60);
  const cs = Math.floor((t * 100) % 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}
