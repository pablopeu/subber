import type { Subtitle } from '../types/Subtitle';
import { sortSubtitles, uid } from '../types/Subtitle';
import type { SubtitleStyle } from '../types/Style';
import { DEFAULT_STYLE } from '../types/Style';

/**
 * Project file: the editor's own save/load format (distinct from .ass/.srt
 * export). It captures everything needed to resume editing — subtitles,
 * style, and video metadata for reference — but never the video itself, so
 * files stay small. When the video was attached via the native file picker
 * (see ProjectFile.ts / Editor.tsx's pickVideo), `video.path` lets reopening
 * restore it with zero clicks by asking the local server to stream it back
 * from that same path; otherwise the user re-selects it once.
 */

export const PROJECT_EXTENSION = '.subber.json';

export interface ProjectVideoInfo {
  name: string;
  width: number;
  height: number;
  duration: number;
  /** Absolute local path, only present when picked via the native dialog. */
  path?: string;
}

interface ProjectFileV1 {
  app: 'subber';
  version: 1;
  video: ProjectVideoInfo | null;
  subtitles: Subtitle[];
  style: SubtitleStyle;
}

export interface LoadedProject {
  subtitles: Subtitle[];
  style: SubtitleStyle;
  video: ProjectVideoInfo | null;
}

export function serializeProject(
  subtitles: Subtitle[],
  style: SubtitleStyle,
  video: ProjectVideoInfo | null,
): string {
  const data: ProjectFileV1 = { app: 'subber', version: 1, video, subtitles, style };
  return JSON.stringify(data, null, 2);
}

/** Best-effort project filename derived from the loaded video's name. */
export function projectFileName(videoName: string | undefined): string {
  const base = videoName ? videoName.replace(/\.[^.]+$/, '') : 'project';
  return `${base}${PROJECT_EXTENSION}`;
}

function parseSubtitle(raw: unknown): Subtitle | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.text !== 'string' || typeof r.start !== 'number' || typeof r.end !== 'number') return null;
  return {
    id: typeof r.id === 'string' ? r.id : uid(),
    start: r.start,
    end: r.end,
    text: r.text,
    styleOverride:
      r.styleOverride && typeof r.styleOverride === 'object'
        ? (r.styleOverride as Partial<SubtitleStyle>)
        : undefined,
    presetName: typeof r.presetName === 'string' ? r.presetName : undefined,
    words: Array.isArray(r.words) ? (r.words as Subtitle['words']) : undefined,
  };
}

/** Parses a project file's text, defensively merging style against defaults. */
export function parseProjectFile(text: string): LoadedProject {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Not a valid project file (invalid JSON)');
  }
  if (!data || typeof data !== 'object' || !Array.isArray((data as ProjectFileV1).subtitles)) {
    throw new Error('Not a valid Subber project file');
  }
  const d = data as ProjectFileV1;
  const subtitles = sortSubtitles(d.subtitles.map(parseSubtitle).filter((s): s is Subtitle => s !== null));
  const style: SubtitleStyle = { ...DEFAULT_STYLE, ...(d.style && typeof d.style === 'object' ? d.style : {}) };
  const video =
    d.video && typeof d.video === 'object' && typeof d.video.name === 'string'
      ? { ...d.video, path: typeof d.video.path === 'string' ? d.video.path : undefined }
      : null;
  return { subtitles, style, video };
}
