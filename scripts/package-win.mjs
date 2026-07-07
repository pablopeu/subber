/**
 * Builds a self-contained Windows package: Subber.exe (Node runtime + server
 * bundled) plus the built web client, fonts, and helper scripts, zipped as
 * dist-win/Subber-win-x64.zip. The exe serves the app at http://localhost:3001
 * and opens the browser — video files never leave the machine.
 *
 * Usage: npm run package:win   (cross-builds fine from Linux/macOS)
 * FFmpeg is not redistributed: the package includes Setup-FFmpeg.bat which
 * downloads a Windows build next to the exe on first use.
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'dist-win');
const APP = path.join(OUT, 'Subber');

const run = (cmd, cwd = ROOT) => {
  console.log(`\n$ ${cmd}`);
  execSync(cmd, { cwd, stdio: 'inherit' });
};

// 1. Fresh output tree.
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(APP, { recursive: true });

// 2. Build the client and place it as web/.
run('npm run build -w client');
fs.cpSync(path.join(ROOT, 'client/dist'), path.join(APP, 'web'), { recursive: true });

// 3. Bundle the server to a single CJS file (pkg requires CommonJS).
const banner = `const import_meta_url = require('url').pathToFileURL(__filename).href;`;
run(
  `npx esbuild server/src/index.js --bundle --platform=node --format=cjs ` +
    `--outfile=dist-win/server.cjs --define:import.meta.url=import_meta_url ` +
    `--banner:js="${banner}"`,
);

// 4. Compile the executable (downloads the prebuilt Node runtime for Windows).
run(`npx @yao-pkg/pkg dist-win/server.cjs --target node22-win-x64 --output "${path.join(APP, 'Subber.exe')}"`);

// 5. Fonts (must exist — run `npm run fonts` first if missing).
const fontsSrc = path.join(ROOT, 'server/fonts');
if (!fs.existsSync(path.join(fontsSrc, 'manifest.json'))) {
  console.error('server/fonts is empty — run `npm run fonts` first.');
  process.exit(1);
}
fs.cpSync(fontsSrc, path.join(APP, 'fonts'), { recursive: true });

// 6. Inbox folder + helper scripts + readme.
fs.mkdirSync(path.join(APP, 'temp'), { recursive: true });

fs.writeFileSync(
  path.join(APP, 'Setup-FFmpeg.ps1'),
  `$ErrorActionPreference = 'Stop'
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
`,
);

fs.writeFileSync(
  path.join(APP, 'Setup-FFmpeg.bat'),
  `@echo off\r\npowershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Setup-FFmpeg.ps1"\r\npause\r\n`,
);

fs.writeFileSync(
  path.join(APP, 'LEEME.txt'),
  `Subber - Subtitle Burn-in Studio (Windows, local)
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
`,
);

// 7. Zip it (python3 zipfile: no external zip dependency needed).
const zipScript = `
import os, zipfile
root = ${JSON.stringify(APP)}
out = ${JSON.stringify(path.join(OUT, 'Subber-win-x64.zip'))}
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    for base, _, files in os.walk(root):
        for f in files:
            p = os.path.join(base, f)
            z.write(p, os.path.relpath(p, os.path.dirname(root)))
print('zipped:', out)
`;
fs.writeFileSync(path.join(OUT, 'zip.py'), zipScript);
run(`python3 "${path.join(OUT, 'zip.py')}"`);
fs.rmSync(path.join(OUT, 'zip.py'));
console.log(`\n✔ Package ready: ${path.join(OUT, 'Subber-win-x64.zip')}`);
