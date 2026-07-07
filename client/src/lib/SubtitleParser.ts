import SrtParser from 'srt-parser-2';
import type { Subtitle } from '../types/Subtitle';
import { createSubtitle, sortSubtitles } from '../types/Subtitle';
import { toSrtTimestamp } from './time';

/**
 * Subtitle import pipeline, SubtitleEdit-style: decode bytes with encoding
 * detection, sniff the format from content (never trust the extension),
 * and fall back to a lenient timestamp scanner for malformed files.
 *
 * Supported: SRT (strict + lenient), WebVTT, ASS/SSA, SubViewer, MicroDVD.
 * Inline styling tags are stripped: styling is owned by the app's style
 * model, not by the source file.
 */

export const SUBTITLE_EXTENSIONS = ['.srt', '.vtt', '.ass', '.ssa', '.sub', '.txt'];

/** Decodes raw subtitle bytes: BOM first, strict UTF-8 next, Latin-1 last. */
export function decodeSubtitleBytes(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(buf);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    // Not valid UTF-8 — windows-1252 covers the common Latin legacy files.
    return new TextDecoder('windows-1252').decode(buf);
  }
}

export async function parseSubtitleFileFromFile(file: File): Promise<Subtitle[]> {
  return parseSubtitleFile(decodeSubtitleBytes(await file.arrayBuffer()));
}

export function parseSubtitleFile(content: string): Subtitle[] {
  const text = content.replace(/^﻿/, '').replace(/\r\n?/g, '\n');

  let subs: Subtitle[];
  if (/^\s*WEBVTT/.test(text)) {
    subs = parseSrtLike(vttToSrt(text));
  } else if (/^\s*\[Script Info\]/im.test(text) || /^Dialogue:/m.test(text)) {
    subs = parseAss(text);
  } else if (/^\{\d+\}\{\d+\}/m.test(text)) {
    subs = parseMicroDvd(text);
  } else if (/^\d{2}:\d{2}:\d{2}\.\d{2},\d{2}:\d{2}:\d{2}\.\d{2}/m.test(text)) {
    subs = parseSubViewer(text);
  } else {
    subs = parseSrtLike(text);
  }

  if (subs.length === 0) {
    throw new Error(
      'No subtitle cues found — supported formats are SRT, WebVTT, ASS/SSA, SubViewer and MicroDVD.',
    );
  }
  return sortSubtitles(subs);
}

/** True if the content looks like any supported subtitle format. */
export function looksLikeSubtitles(content: string): boolean {
  try {
    return parseSubtitleFile(content).length > 0;
  } catch {
    return false;
  }
}

// ─── SRT ──────────────────────────────────────────────────────────────────

function parseSrtLike(text: string): Subtitle[] {
  // Try the strict parser first, then the lenient scanner; keep the richer result.
  let strict: Subtitle[] = [];
  try {
    const parser = new SrtParser();
    strict = parser
      .fromSrt(text)
      .filter((c) => c.endSeconds > c.startSeconds)
      .map((c) => makeCue(c.startSeconds, c.endSeconds, c.text))
      .filter((c): c is Subtitle => c !== null);
  } catch {
    // fall through to the lenient scanner
  }
  const lenient = scanTimestampPairs(text);
  return lenient.length > strict.length ? lenient : strict;
}

/**
 * Lenient SRT recovery: find "start --> end" pairs anywhere and take the
 * following lines as text. Tolerates missing indexes/blank lines, dot or
 * colon millisecond separators, 1-digit hours and missing hours.
 */
function scanTimestampPairs(text: string): Subtitle[] {
  const ts = String.raw`(\d{1,2}:)?\d{1,2}:\d{1,2}[,.:]\d{1,3}`;
  const pairRe = new RegExp(`^[ \\t]*(${ts})[ \\t]*-{1,3}>[ \\t]*(${ts}).*$`, 'gm');

  const matches = [...text.matchAll(pairRe)];
  const subs: Subtitle[] = [];
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const start = flexibleTimeToSeconds(m[1]);
    const end = flexibleTimeToSeconds(m[3]);
    if (start === null || end === null) continue;

    const from = m.index! + m[0].length;
    const to = i + 1 < matches.length ? matches[i + 1].index! : text.length;
    const lines = text
      .slice(from, to)
      .split('\n')
      .map((l) => l.trim())
      // Drop the next cue's numeric index (trailing lone number before a cut).
      .filter((l, idx, arr) => !(idx === arr.length - 1 && /^\d+$/.test(l)));
    const cue = makeCue(start, end, lines.join('\n'));
    if (cue) subs.push(cue);
  }
  return subs;
}

/** "1:02:03,450" | "02:03.4" | "3:15:500" → seconds. */
function flexibleTimeToSeconds(raw: string): number | null {
  const m = /^(?:(\d{1,2}):)?(\d{1,2}):(\d{1,2})[,.:](\d{1,3})$/.exec(raw.trim());
  if (!m) return null;
  const [, h, min, s, ms] = m;
  return (
    Number(h ?? 0) * 3600 +
    Number(min) * 60 +
    Number(s) +
    Number(ms.padEnd(3, '0')) / 1000
  );
}

// ─── WebVTT ───────────────────────────────────────────────────────────────

function vttToSrt(text: string): string {
  return text
    .replace(/^\s*WEBVTT[^\n]*\n/, '')
    .replace(/^(NOTE|STYLE|REGION)\b[^]*?(\n\n|$)/gm, '')
    // VTT allows missing hours and uses '.' for millis.
    .replace(
      /(^|\n)((?:\d{1,2}:)?\d{2}:\d{2})\.(\d{3})([^\n]*?-->\s*)((?:\d{1,2}:)?\d{2}:\d{2})\.(\d{3})/g,
      (_m, pre, s, sms, arrow, e, ems) => `${pre}${s},${sms}${arrow}${e},${ems}`,
    );
}

// ─── ASS / SSA ────────────────────────────────────────────────────────────

function parseAss(text: string): Subtitle[] {
  // Field order comes from the Format line when present (ASS vs SSA differ).
  const formatMatch = /^Format:\s*(.+)$/m.exec(
    text.split(/^\[Events\]/m)[1] ?? text,
  );
  const fields = (formatMatch?.[1] ?? 'Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text')
    .split(',')
    .map((f) => f.trim().toLowerCase());
  const startIdx = fields.indexOf('start');
  const endIdx = fields.indexOf('end');
  const textIdx = fields.indexOf('text');

  const subs: Subtitle[] = [];
  for (const line of text.split('\n')) {
    const m = /^Dialogue:\s*(.*)$/.exec(line.trim());
    if (!m) continue;
    const parts = splitAssFields(m[1], fields.length);
    const start = assTimeToSeconds(parts[startIdx]);
    const end = assTimeToSeconds(parts[endIdx]);
    if (start === null || end === null) continue;
    const cueText = (parts[textIdx] ?? '')
      .replace(/\{[^}]*\}/g, '') // override tags
      .replace(/\\N|\\n/g, '\n')
      .replace(/\\h/g, ' ');
    const cue = makeCue(start, end, cueText);
    if (cue) subs.push(cue);
  }
  return subs;
}

/** Splits a Dialogue line into N fields; the last (Text) may contain commas. */
function splitAssFields(line: string, count: number): string[] {
  const parts = line.split(',');
  if (parts.length <= count) return parts.map((p) => p.trim());
  return [...parts.slice(0, count - 1).map((p) => p.trim()), parts.slice(count - 1).join(',')];
}

function assTimeToSeconds(raw: string | undefined): number | null {
  const m = /^(\d+):(\d{1,2}):(\d{1,2})[.:](\d{1,2})$/.exec((raw ?? '').trim());
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(2, '0')) / 100;
}

// ─── MicroDVD ─────────────────────────────────────────────────────────────

function parseMicroDvd(text: string): Subtitle[] {
  let fps = 25;
  const subs: Subtitle[] = [];
  for (const line of text.split('\n')) {
    const m = /^\{(\d+)\}\{(\d+)\}(.*)$/.exec(line.trim());
    if (!m) continue;
    const [, startF, endF, body] = m;
    // Convention: a first line {1}{1}23.976 declares the frame rate.
    if (startF === endF && /^\d+(\.\d+)?$/.test(body.trim())) {
      fps = parseFloat(body.trim()) || fps;
      continue;
    }
    const cleaned = body.replace(/\{[^}]*\}/g, '').replace(/\|/g, '\n');
    const cue = makeCue(Number(startF) / fps, Number(endF) / fps, cleaned);
    if (cue) subs.push(cue);
  }
  return subs;
}

// ─── SubViewer ────────────────────────────────────────────────────────────

function parseSubViewer(text: string): Subtitle[] {
  const re = /^(\d{2}):(\d{2}):(\d{2})\.(\d{2}),(\d{2}):(\d{2}):(\d{2})\.(\d{2})\s*\n([^]*?)(?=\n\s*\n|\n\d{2}:\d{2}:\d{2}\.|$)/gm;
  const subs: Subtitle[] = [];
  for (const m of text.matchAll(re)) {
    const start = +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 100;
    const end = +m[5] * 3600 + +m[6] * 60 + +m[7] + +m[8] / 100;
    const cue = makeCue(start, end, m[9].replace(/\[br\]/gi, '\n'));
    if (cue) subs.push(cue);
  }
  return subs;
}

// ─── Shared ───────────────────────────────────────────────────────────────

function makeCue(start: number, end: number, rawText: string): Subtitle | null {
  const text = rawText
    .replace(/<[^>]+>/g, '')
    .replace(/\{\\[^}]*\}/g, '')
    .trim();
  if (!text || !(end > start) || start < 0) return null;
  return createSubtitle(start, end, text);
}

/** Serializes the internal model back to a standard SRT file. */
export function toSrt(subs: Subtitle[]): string {
  return sortSubtitles(subs)
    .map(
      (s, i) =>
        `${i + 1}\n${toSrtTimestamp(s.start)} --> ${toSrtTimestamp(s.end)}\n${s.text.trim()}\n`,
    )
    .join('\n');
}
