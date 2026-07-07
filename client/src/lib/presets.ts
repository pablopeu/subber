import type { StylePreset, SubtitleStyle } from '../types/Style';
import { DEFAULT_STYLE } from '../types/Style';

/**
 * Built-in style presets inspired by modern video editors.
 * Custom presets are stored in localStorage alongside these.
 */

function preset(id: string, name: string, style: Partial<SubtitleStyle>): StylePreset {
  return { id, name, builtin: true, style: { ...DEFAULT_STYLE, ...style } };
}

export const BUILTIN_PRESETS: StylePreset[] = [
  preset('classic', 'Classic', {
    fontFamily: 'Inter',
    fontSize: 48,
    color: '#ffffff',
    outlineColor: '#000000',
    outlineWidth: 3,
  }),
  preset('netflix', 'Netflix', {
    fontFamily: 'Roboto',
    fontSize: 46,
    color: '#ffffff',
    outlineColor: '#000000',
    outlineWidth: 1.5,
    shadow: true,
    shadowColor: '#000000',
    shadowBlur: 4,
    shadowOffsetX: 0,
    shadowOffsetY: 2,
  }),
  preset('youtube', 'YouTube', {
    fontFamily: 'Roboto',
    fontSize: 42,
    color: '#ffffff',
    outlineWidth: 0,
    background: true,
    backgroundColor: '#000000',
    backgroundOpacity: 0.75,
    borderRadius: 4,
  }),
  preset('tiktok', 'TikTok', {
    fontFamily: 'Montserrat',
    fontSize: 64,
    bold: true,
    color: '#ffe600',
    outlineColor: '#000000',
    outlineWidth: 4,
    shadow: true,
    shadowColor: '#000000',
    shadowBlur: 0,
    shadowOffsetX: 2,
    shadowOffsetY: 2,
    alignment: 'center',
  }),
  preset('capcut', 'CapCut Modern', {
    fontFamily: 'Poppins',
    fontSize: 56,
    bold: true,
    color: '#ffffff',
    outlineWidth: 0,
    shadow: true,
    shadowColor: '#000000',
    shadowBlur: 18,
    shadowOffsetX: 0,
    shadowOffsetY: 6,
  }),
  preset('minimal', 'Minimal', {
    fontFamily: 'Inter',
    fontSize: 40,
    color: '#d0d0d0',
    outlineWidth: 0,
    shadow: false,
  }),
  preset('cinema', 'Cinema', {
    fontFamily: 'Playfair Display',
    fontSize: 50,
    color: '#f5f0e6',
    outlineColor: '#000000',
    outlineWidth: 1,
    italic: true,
    alignment: 'bottom',
    marginBottom: 96,
    letterSpacing: 1,
  }),
  preset('podcast', 'Podcast', {
    fontFamily: 'Poppins',
    fontSize: 60,
    bold: true,
    color: '#ffffff',
    outlineWidth: 0,
    alignment: 'center',
    background: true,
    backgroundColor: '#000000',
    backgroundOpacity: 0.55,
    borderRadius: 16,
  }),
  preset('loud', 'Loud', {
    // Adobe Express "Loud" look: solid pastel box, heavy dark type that
    // auto-fits the box, soft fade in/out.
    fontFamily: 'Anton',
    fontSize: 72,
    color: '#111111',
    outlineWidth: 0,
    shadow: false,
    captionBox: true,
    backgroundColor: '#8cebb6',
    backgroundOpacity: 1,
    borderRadius: 0,
    boxRect: { x: 0.55, y: 0.55, width: 0.38, height: 0.3 },
    fadeMs: 200,
    letterSpacing: 1,
  }),
  preset('gaming', 'Gaming', {
    fontFamily: 'Orbitron',
    fontSize: 52,
    bold: true,
    color: '#39ff14',
    outlineColor: '#7a00ff',
    outlineWidth: 2,
    shadow: true,
    shadowColor: '#39ff14',
    shadowBlur: 16,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
  }),
];

const STORAGE_KEY = 'subber.customPresets.v1';

export function loadCustomPresets(): StylePreset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StylePreset[];
    return parsed.map((p) => ({
      ...p,
      builtin: false,
      style: { ...DEFAULT_STYLE, ...p.style },
    }));
  } catch {
    return [];
  }
}

export function saveCustomPresets(presets: StylePreset[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
}
