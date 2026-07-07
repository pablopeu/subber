/**
 * Builds a self-contained Subber package for a given OS: a Node-runtime
 * executable (Node + server bundled) plus the built web client, fonts and an
 * FFmpeg setup helper, archived in dist-<os>/. The executable serves the app at
 * http://localhost:3001 and opens the browser — video files never leave the
 * machine.
 *
 * Usage:
 *   npm run package:win      → dist-win/Subber-win-x64.zip
 *   npm run package:linux    → dist-linux/Subber-linux-x64.tar.gz
 *   npm run package:all      → both
 *   node scripts/package.mjs <win|linux>
 *
 * Both targets cross-build fine from any host OS: @yao-pkg/pkg downloads the
 * prebuilt Node runtime for the requested target. FFmpeg is not redistributed —
 * each package includes a setup helper that fetches it on first use.
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const PLATFORMS = {
  win: {
    pkgTarget: 'node22-win-x64',
    exe: 'Subber.exe',
    distDir: 'dist-win',
    archiveName: 'Subber-win-x64.zip',
  },
  linux: {
    pkgTarget: 'node22-linux-x64',
    exe: 'Subber',
    distDir: 'dist-linux',
    archiveName: 'Subber-linux-x64.tar.gz',
  },
};

const run = (cmd, cwd = ROOT) => {
  console.log(`\n$ ${cmd}`);
  execSync(cmd, { cwd, stdio: 'inherit' });
};

// --- FFmpeg setup helpers (one per platform) -------------------------------

const FFMPEG_PS1 = `$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
if (Test-Path (Join-Path $here 'ffmpeg.exe')) { Write-Host 'ffmpeg.exe ya existe junto a Subber.exe.'; exit 0 }
if (Get-Command ffmpeg -ErrorAction SilentlyContinue) { Write-Host 'FFmpeg ya esta en el PATH del sistema.'; exit 0 }
Write-Host 'Descargando FFmpeg (~100 MB)...'
$zip = Join-Path $env:TEMP 'subber-ffmpeg.zip'
$dir = Join-Path $env:TEMP 'subber-ffmpeg'
Invoke-WebRequest 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip' -OutFile $zip
Expand-Archive $zip -DestinationPath $dir -Force
$exe = Get-ChildItem $dir -Recurse -Filter ffmpeg.exe | Select-Object -First 1
Copy-Item $exe.FullName -Destination $here
Remove-Item $zip -Force; Remove-Item $dir -Recurse -Force
Write-Host 'Listo: ffmpeg.exe quedo junto a Subber.exe.'
`;

const FFMPEG_BAT = `@echo off\r\npowershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Setup-FFmpeg.ps1"\r\npause\r\n`;

const FFMPEG_SH = `#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
if [ -x "$HERE/ffmpeg" ]; then echo "ffmpeg ya existe junto a Subber."; exit 0; fi
if command -v ffmpeg >/dev/null 2>&1; then echo "FFmpeg ya esta en el PATH del sistema."; exit 0; fi
echo "FFmpeg no encontrado. Intentando instalarlo via el gestor de paquetes..."
if command -v apt-get >/dev/null 2>&1; then
  sudo apt-get update && sudo apt-get install -y ffmpeg
elif command -v dnf >/dev/null 2>&1; then
  sudo dnf install -y ffmpeg
elif command -v pacman >/dev/null 2>&1; then
  sudo pacman -S --noconfirm ffmpeg
else
  echo "No se detecto gestor de paquetes. Descargando build estatico de FFmpeg..."
  tmp="$(mktemp -d)"
  curl -fL "https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz" -o "$tmp/ffmpeg.tar.xz"
  tar -xJf "$tmp/ffmpeg.tar.xz" -C "$tmp"
  bin="$(find "$tmp" -type f -name ffmpeg | head -n1)"
  cp "$bin" "$HERE/ffmpeg"
  chmod +x "$HERE/ffmpeg"
  rm -rf "$tmp"
fi
echo "Listo."
`;

function writeFfmpegSetup(os, appDir) {
  if (os === 'win') {
    fs.writeFileSync(path.join(appDir, 'Setup-FFmpeg.ps1'), FFMPEG_PS1);
    fs.writeFileSync(path.join(appDir, 'Setup-FFmpeg.bat'), FFMPEG_BAT);
  } else {
    const file = path.join(appDir, 'setup-ffmpeg.sh');
    fs.writeFileSync(file, FFMPEG_SH);
    fs.chmodSync(file, 0o755);
  }
}

function readmeFor(os) {
  if (os === 'win') {
    return `Subber - Subtitle Burn-in Studio (Windows, local)
==================================================

1. La primera vez: doble click en Setup-FFmpeg.bat (descarga FFmpeg junto al exe).
   Si ya tenes FFmpeg instalado en el PATH, no hace falta.
2. Doble click en Subber.exe. Se abre el navegador en http://localhost:3001.
3. Todo corre en esta maquina: el video nunca viaja a ningun servidor.

Carpetas:
  temp\\   -> dejar aca videos o subtitulos para importarlos con un click desde la app
  fonts\\  -> tipografias usadas por la vista previa y por FFmpeg
  tmp\\    -> archivos temporales de exportacion (se limpian solos)

Variables opcionales: PORT (puerto), FFMPEG_PATH (ruta a ffmpeg), SUBBER_NO_OPEN=1 (no abrir navegador).
`;
  }
  return `Subber - Subtitle Burn-in Studio (Linux, local)
===============================================

1. La primera vez (opcional): ejecuta ./setup-ffmpeg.sh si no tenes FFmpeg.
   Intenta instalarlo via tu gestor de paquetes (apt/dnf/pacman) o descarga un
   build estatico junto al ejecutable. Si ya tenes FFmpeg en el PATH, saltealo.
2. Ejecuta ./Subber. Se abre el navegador en http://localhost:3001.
3. Todo corre en esta maquina: el video nunca viaja a ningun servidor.

Carpetas:
  temp/   -> dejar aca videos o subtitulos para importarlos con un click desde la app
  fonts/  -> tipografias usadas por la vista previa y por FFmpeg
  tmp/    -> archivos temporales de exportacion (se limpian solos)

Variables opcionales: PORT (puerto), FFMPEG_PATH (ruta a ffmpeg), SUBBER_NO_OPEN=1 (no abrir navegador).
`;
}

// --- archiving -------------------------------------------------------------

function zipWithPython(appDir, outFile) {
  const script = `
import os, zipfile
root = ${JSON.stringify(appDir)}
out = ${JSON.stringify(outFile)}
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    for base, _, files in os.walk(root):
        for f in files:
            p = os.path.join(base, f)
            z.write(p, os.path.relpath(p, os.path.dirname(root)))
print('zipped:', out)
`;
  const tmp = path.join(path.dirname(outFile), 'zip.py');
  fs.writeFileSync(tmp, script);
  try {
    run(`python3 "${tmp}"`);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

function tarGz(appDir, outFile) {
  // tar -C <parent> -czf <out> <toplevel> — preserves the +x bit on Subber.
  const parent = path.dirname(appDir);
  const toplevel = path.basename(appDir);
  run(`tar -C "${parent}" -czf "${outFile}" "${toplevel}"`);
}

// --- main ------------------------------------------------------------------

function build(os) {
  const cfg = PLATFORMS[os];
  if (!cfg) throw new Error(`Unknown platform "${os}". Use: win | linux`);

  const OUT = path.join(ROOT, cfg.distDir);
  const APP = path.join(OUT, 'Subber');

  // 1. Fresh output tree.
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(APP, { recursive: true });

  // 2. Build the client and place it as web/.
  run('npm run build -w client');
  fs.cpSync(path.join(ROOT, 'client/dist'), path.join(APP, 'web'), { recursive: true });

  // 3. Bundle the server to a single CJS file (pkg requires CommonJS).
  const banner = `const import_meta_url = require('url').pathToFileURL(__filename).href;`;
  const cjsOut = path.join(OUT, 'server.cjs');
  run(
    `npx esbuild server/src/index.js --bundle --platform=node --format=cjs ` +
      `--outfile="${cjsOut}" --define:import.meta.url=import_meta_url ` +
      `--banner:js="${banner}"`,
  );

  // 4. Compile the executable (downloads the prebuilt Node runtime for the target).
  const exePath = path.join(APP, cfg.exe);
  run(`npx @yao-pkg/pkg "${cjsOut}" --target ${cfg.pkgTarget} --output "${exePath}"`);
  if (os === 'linux') fs.chmodSync(exePath, 0o755);

  // 5. Fonts (must exist — run `npm run fonts` first if missing).
  const fontsSrc = path.join(ROOT, 'server/fonts');
  if (!fs.existsSync(path.join(fontsSrc, 'manifest.json'))) {
    console.error('server/fonts is empty — run `npm run fonts` first.');
    process.exit(1);
  }
  fs.cpSync(fontsSrc, path.join(APP, 'fonts'), { recursive: true });

  // 6. Inbox folder + FFmpeg setup helper + readme.
  fs.mkdirSync(path.join(APP, 'temp'), { recursive: true });
  writeFfmpegSetup(os, APP);
  fs.writeFileSync(path.join(APP, 'LEEME.txt'), readmeFor(os));

  // 7. Archive.
  const archivePath = path.join(OUT, cfg.archiveName);
  if (os === 'win') zipWithPython(APP, archivePath);
  else tarGz(APP, archivePath);

  console.log(`\n✔ ${os} package ready: ${archivePath}`);
}

const targets = process.argv.slice(2);
if (targets.length === 0) {
  console.error('Usage: node scripts/package.mjs <win|linux> [...]');
  process.exit(1);
}
for (const t of targets) build(t);
