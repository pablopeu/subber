# Subber — Subtitle Burn-in Studio

A browser-based subtitle editor in the spirit of VEED / CapCut / Descript: upload a video,
import or create subtitles, style them with live preview, then export an MP4 with the
subtitles permanently burned in by FFmpeg.

![stack](https://img.shields.io/badge/react-19-blue) ![stack](https://img.shields.io/badge/vite-7-purple) ![stack](https://img.shields.io/badge/ffmpeg-server--side-green)

## Features

- **Video upload** — MP4, MOV, MKV, WebM (previewed locally, never uploaded until export)
- **Subtitles** — import `.srt` / simple `.vtt`, or create cues manually
- **Timeline** — draggable / resizable cue blocks, click-to-seek ruler, synced playhead, zoom
- **Cue editor** — start / end / duration / text with flexible timecode input
- **Live preview** — Konva canvas overlay; only the subtitle layer redraws, never the video
- **Styling** — font (Google Fonts, self-hosted), size, bold/italic/underline, text & outline
  color, outline width, shadow (color/blur/offset), opacity, background box
  (color/opacity/radius), letter & line spacing, top/center/bottom alignment, margins,
  free positioning by dragging the subtitle on the video
- **Caption box** — "Loud"-style solid box placed anywhere on the video (drag to move,
  handles to resize); text auto-fits the box so it never overflows, cues fade in/out
  (configurable ms), exported with real rounded corners via ASS \p1 drawings + \fad
- **Presets** — Classic, Netflix, YouTube, TikTok, CapCut Modern, Minimal, Cinema, Podcast,
  Loud, Gaming + user presets saved to localStorage
- **Server inbox** — files dropped in `temp/` on the server are importable with one click;
  subtitle parsing is SubtitleEdit-grade (encoding detection UTF-8/UTF-16/Latin-1; SRT strict
  + lenient recovery, WebVTT, ASS/SSA, SubViewer, MicroDVD)
- **Export** — the internal model is compiled to an ASS file (never drawtext filters) and the
  backend runs `ffmpeg -vf ass=subtitles.ass` to produce H.264 MP4; also exports `.ass` / `.srt`

## Getting started

Requirements: Node ≥ 20 and `ffmpeg` on PATH.

```bash
npm install          # installs client + server workspaces
npm run fonts        # one-time: downloads Google Fonts TTFs into server/fonts
npm run dev          # server on :3001, client on :5173
```

Open http://localhost:5173.

Production: `npm run build` (client → `client/dist`), `npm run start` (export server).
Serve `client/dist` from any static host and proxy `/api` + `/fonts` to the server.

### Windows standalone package

`npm run package:win` produces `dist-win/Subber-win-x64.zip` (cross-builds from Linux):
a portable folder with `Subber.exe` (Node runtime + server + built client), fonts, a `temp/`
inbox and `Setup-FFmpeg.bat` (downloads FFmpeg beside the exe on first run). Double-clicking
`Subber.exe` serves everything at `http://localhost:3001` and opens the browser — videos are
processed locally and never leave the machine.

### Per-cue styles

Each subtitle can start its own style segment: pick a preset in the cue editor ("Style from
here") or apply one from the Presets tab with "Selected cue onward". Following cues inherit it
until the next styled cue; unstyled leading cues use the base style edited in the Style tab.
The ASS export emits one style per distinct segment.

## Architecture

```
client/src
├── types/        Subtitle.ts, Style.ts        ← the internal model (single source of truth)
├── lib/
│   ├── SubtitleStore.ts   zustand store; narrow selectors keep 60fps ticks cheap
│   ├── SubtitleParser.ts  SRT/VTT → model, model → SRT
│   ├── ASSGenerator.ts    model → ASS (styles, colors, alignment, \pos, \xshad, \blur)
│   ├── FFmpegExporter.ts  Exporter interface + backend implementation
│   ├── presets.ts         built-in + localStorage presets
│   └── fonts.ts           loads backend-hosted TTFs via FontFace
├── components/   VideoPlayer, SubtitleCanvas, SubtitleTimeline,
│                 SubtitleEditor, StylePanel, PresetSelector, ExportDialog, UploadDropzone
└── pages/        Editor.tsx

server/
├── src/index.js  Express: /api/fonts, /api/export (+status/download), /fonts static
├── src/jobs.js   FFmpeg job runner with stderr progress parsing and TTL cleanup
└── scripts/fetch-fonts.mjs   downloads TTFs from Google Fonts + writes manifest.json
```

Key decisions:

- **One model, two renderers.** Preview (Konva) and export (libass) both consume the same
  `Subtitle[]` + `SubtitleStyle`, expressed in *video pixels* (`PlayResX/Y` = native video
  resolution; the canvas scales by `displayWidth / videoWidth`). Preview mirrors ASS
  constraints (e.g. box mode disables outline/shadow) so what you see is what FFmpeg burns.
- **Same font files everywhere.** The backend serves the TTFs to the browser (`FontFace`) and
  passes the same directory to FFmpeg (`ass=…:fontsdir=`), so text metrics match.
- **Video is never re-rendered.** The `<video>` element mounts once; time updates flow through
  the store to the canvas and playhead only.
- **Pluggable exporter.** `Exporter` is an interface — an ffmpeg.wasm fallback can be added
  without touching the UI.

Known approximations: `lineSpacing` and box `borderRadius` are preview-only (ASS has no
equivalents); canvas shadow blur ≈ libass `\blur`.

## Future-proofing

The model already reserves room for karaoke / word-by-word highlighting (`Subtitle.words`,
ASS `SecondaryColour`), per-cue style overrides (`styleOverride`), animations
(`SubtitleStyle.animation`), and multiple tracks (cues are independent, overlap-safe and
stack like libass). AI transcription/translation only needs to emit `Subtitle[]`.
