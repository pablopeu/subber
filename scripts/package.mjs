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
import AdmZip from 'adm-zip';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

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

// --- Windows system tray (PowerShell + WinForms, no native binary) ---------
// Spawns next to Subber.exe; draws the Subber icon at runtime and offers
// Open / Quit. Self-exits if the server disappears. See server/src/index.js.

const TRAY_PS1 = `param([string]$Port = "3001")
$ErrorActionPreference = 'Continue'
$url = "http://localhost:$Port"
$log = Join-Path $PSScriptRoot 'tray-error.log'
function Log($m) { try { Add-Content -Path $log -Value "[$(Get-Date -Format o)] $m" } catch {} }
Log("tray start port=$Port ps=$PSVersionTable.PSVersion")

try {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  [System.Windows.Forms.Application]::EnableVisualStyles()

  # Subber icon (purple square + white S); fall back to a system icon if drawing fails.
  $icon = $null
  try {
    $bmp = New-Object System.Drawing.Bitmap 32, 32
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.Clear([System.Drawing.Color]::FromArgb(255, 109, 92, 255))
    $brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
    $font = New-Object System.Drawing.Font 'Segoe UI', 16, ([System.Drawing.FontStyle]::Bold)
    $rect = New-Object System.Drawing.RectangleF 0, 0, 32, 32
    $fmt = New-Object System.Drawing.StringFormat
    $fmt.Alignment = [System.Drawing.StringAlignment]::Center
    $fmt.LineAlignment = [System.Drawing.StringAlignment]::Center
    $g.DrawString('S', $font, $brush, $rect, $fmt)
    $g.Dispose()
    $icon = [System.Drawing.Icon]::FromHandle($bmp.GetHicon())
    Log("icon drawn")
  } catch {
    Log("icon draw failed: $($_.Exception.Message)")
    $icon = [System.Drawing.SystemIcons]::Application
  }

  $ni = New-Object System.Windows.Forms.NotifyIcon
  $ni.Icon = $icon
  $ni.Text = 'Subber'
  $ni.Visible = $true
  Log("notifyicon visible")

  $menu = New-Object System.Windows.Forms.ContextMenu
  $open = $menu.MenuItems.Add('Open Subber')
  [void]$menu.MenuItems.Add('-')
  $quit = $menu.MenuItems.Add('Quit Subber')
  $ni.ContextMenu = $menu

  $open.add_Click({ try { Start-Process $url } catch {} })
  $ni.add_MouseDoubleClick({ try { Start-Process $url } catch {} })
  $quit.add_Click({
    Log("quit clicked")
    try { Invoke-WebRequest -UseBasicParsing "$url/api/shutdown" -Method POST -TimeoutSec 2 } catch {}
    $ni.Visible = $false
    [System.Windows.Forms.Application]::Exit()
  })

  # Hidden form (off-screen, transparent) hosts the message loop.
  $form = New-Object System.Windows.Forms.Form
  $form.ShowInTaskbar = $false
  $form.FormBorderStyle = 'FixedToolWindow'
  $form.Opacity = 0
  $form.Size = New-Object System.Drawing.Size 0, 0
  $form.StartPosition = 'Manual'
  $form.Location = New-Object System.Drawing.Point -32000, -32000

  # Self-exit if the server disappears.
  $timer = New-Object System.Windows.Forms.Timer
  $timer.Interval = 3000
  $timer.add_Tick({
    try { Invoke-WebRequest -UseBasicParsing "$url/api/fonts" -TimeoutSec 2 | Out-Null }
    catch { Log("server gone"); $ni.Visible = $false; $form.Close() }
  })
  $timer.Start()

  Log("entering message loop")
  [System.Windows.Forms.Application]::Run($form)
  Log("tray exited")
} catch {
  Log("FATAL: $($_.Exception.Message)")
}
`;

function writeTray(appDir) {
  fs.writeFileSync(path.join(appDir, 'tray.ps1'), TRAY_PS1);
}

/** Flip a Windows .exe subsystem CONSOLE→GUI so it runs with no cmd window. */
function hideConsole(exePath) {
  try {
    const fd = fs.openSync(exePath, 'r+');
    try {
      const off = Buffer.alloc(4);
      fs.readSync(fd, off, 0, 4, 0x3c);
      const subOff = off.readUInt32LE(0) + 0x5c; // e_lfanew + PE optional hdr Subsystem
      const sub = Buffer.alloc(2);
      fs.readSync(fd, sub, 0, 2, subOff);
      if (sub.readUInt16LE(0) === 3) {
        sub.writeUInt16LE(2, 0); // IMAGE_SUBSYSTEM_WINDOWS_GUI
        fs.writeSync(fd, sub, 0, 2, subOff);
      }
    } finally {
      fs.closeSync(fd);
    }
  } catch (err) {
    console.warn(`\n⚠ Could not hide the console window (${err.message}).`);
  }
}

function readmeFor(os) {
  if (os === 'win') {
    return `Subber - Subtitle Burn-in Studio (Windows, local)
==================================================

1. La primera vez: doble click en Setup-FFmpeg.bat (descarga FFmpeg junto al exe).
   Si ya tenes FFmpeg instalado en el PATH, no hace falta.
2. Doble click en Subber.exe. Se abre el navegador en http://localhost:3001 y
   aparece un icono de Subber en la bandeja del sistema (junto al reloj).
3. Todo corre en esta maquina: el video nunca viaja a ningun servidor.
4. Para cerrar la app: boton de power (esquina superior derecha de la app) o
   clic derecho sobre el icono de la bandeja -> Quit Subber.

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

function zipWithAdm(appDir, outFile) {
  // Pure-JS zip (no python/zip CLI) so this works identically on Linux, macOS
  // and the Windows CI runner. Wrap everything under a top-level "Subber/" so
  // extraction yields a single folder.
  const zip = new AdmZip();
  zip.addLocalFolder(appDir, 'Subber');
  zip.writeZip(outFile);
  console.log('zipped:', outFile);
}

function tarGz(appDir, outFile) {
  // tar -C <parent> -czf <out> <toplevel> — preserves the +x bit on Subber.
  const parent = path.dirname(appDir);
  const toplevel = path.basename(appDir);
  run(`tar -C "${parent}" -czf "${outFile}" "${toplevel}"`);
}

// --- startup crash logging --------------------------------------------------
// Prepended to the bundled server so a packaged binary never "flashes and
// dies" silently: any boot error is written to crash.log beside the exe, sent
// to stderr, and the process is kept alive briefly so a console window stays
// open when double-clicked. Runs before any app code, so it catches module-load
// throws too. Disabled with SUBBER_NO_CRASHLOG=1.

const CRASH_HANDLER = `;(function () {
  if (process.env.SUBBER_NO_CRASHLOG === '1') return;
  var fs = require('fs'), p = require('path');
  var base = ('pkg' in process || process.env.SUBBER_PACKAGED === '1')
    ? p.dirname(process.execPath)
    : p.join(__dirname, '..');
  function report(e) {
    var msg = (e && (e.stack || e.message)) || ('' + e);
    var out = '[' + new Date().toISOString() + '] Subber crashed:\\n' + msg +
      '\\nplatform=' + process.platform + ' arch=' + process.arch + ' node=' + process.version + '\\n';
    try { fs.writeFileSync(p.join(base, 'crash.log'), out); } catch (_) {}
    try { console.error(out); } catch (_) {}
    setTimeout(function () {}, 60000);
  }
  process.on('uncaughtException', report);
  process.on('unhandledRejection', report);
})();`;

function prependCrashHandler(file) {
  const src = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, CRASH_HANDLER + '\n' + src);
}

// --- Windows installer (NSIS) ----------------------------------------------

function findMakensis() {
  // $MAKENSIS wins (lets a rootless build point at a binary not on PATH).
  if (process.env.MAKENSIS && fs.existsSync(process.env.MAKENSIS)) return process.env.MAKENSIS;
  // PATH search that works on Windows too (no `command -v` in cmd.exe).
  const exts =
    process.platform === 'win32' ? (process.env.PATHEXT || '.EXE').split(';') : [''];
  const sep = process.platform === 'win32' ? ';' : ':';
  for (const dir of (process.env.PATH || '').split(sep)) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = path.join(dir, 'makensis' + ext);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  // Windows fallback: Chocolatey installs NSIS to Program Files (x86)\NSIS but
  // doesn't reliably add makensis to PATH (it's what bit the CI build).
  if (process.platform === 'win32') {
    for (const base of [process.env['ProgramFiles(x86)'], process.env.ProgramFiles]) {
      if (!base) continue;
      const candidate = path.join(base, 'NSIS', 'makensis.exe');
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
}

// Locate NSIS's data dir (Stubs/Include/Plugins): layout differs by installer —
// Debian puts it at <bin>/../share/nsis, a Windows/zip install keeps it next to
// makensis. Pick the first candidate that actually has Stubs/ or Include/;
// return null to let makensis fall back to its compiled-in default (or $NSISDIR).
function resolveNsisDir(bin) {
  const dir = path.dirname(bin);
  const candidates = [path.join(dir, '..', 'share', 'nsis'), dir, path.join(dir, '..')];
  for (const d of candidates) {
    if (fs.existsSync(path.join(d, 'Stubs')) || fs.existsSync(path.join(d, 'Include'))) return d;
  }
  return null;
}

function buildInstaller(appDir) {
  const makensis = findMakensis();
  if (!makensis) {
    console.warn('\n⚠ makensis not found — skipping Windows installer.');
    console.warn('  Install NSIS (Debian: apt-get install nsis; Windows: choco install nsis) to build it.');
    return;
  }
  const nsisdir = resolveNsisDir(makensis);
  const env = nsisdir ? { ...process.env, NSISDIR: nsisdir } : process.env;
  const outDir = path.dirname(appDir); // dist-win
  const output = path.join(outDir, 'Subber-Setup-x64.exe');
  const nsi = path.join(ROOT, 'scripts', 'installer.nsi');
  console.log(`\n$ makensis installer.nsi (NSISDIR=${nsisdir})`);
  execSync(
    `"${makensis}" -V2 -DVER=${VERSION} -DSRC="${appDir}" -DOUTPUT="${output}" "${nsi}"`,
    { cwd: ROOT, stdio: 'inherit', env },
  );
  console.log(`\n✔ installer ready: ${output}`);
}

// --- main ------------------------------------------------------------------

function build(os) {
  const cfg = PLATFORMS[os];
  if (!cfg) throw new Error(`Unknown platform "${os}". Use: win | linux`);

  if (os === 'win' && process.platform !== 'win32') {
    console.warn('\n⚠ Cross-compiling the Windows package on a non-Windows host.');
    console.warn('  The resulting Subber.exe will FAIL on Windows: pkg embeds V8 bytecode');
    console.warn('  compiled by the host Node, which the target V8 rejects ("V8 rejected the');
    console.warn('  bytecode cache"). Build on Windows (the release workflow uses windows-latest)');
    console.warn('  to get a working binary.');
  }

  const OUT = path.join(ROOT, cfg.distDir);
  const APP = path.join(OUT, 'Subber');

  // 1. Fresh output tree.
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(APP, { recursive: true });

  // 2. Place the built client as web/. The Vite/rolldown native binding only
  //    installs for the host platform, so the output (portable HTML/JS/CSS) is
  //    built once on Linux and reused everywhere via $SUBBER_WEB.
  let webSrc;
  if (process.env.SUBBER_WEB) {
    webSrc = path.resolve(ROOT, process.env.SUBBER_WEB);
    console.log(`\nUsing pre-built client from ${webSrc}`);
  } else {
    run('npm run build -w client');
    webSrc = path.join(ROOT, 'client/dist');
  }
  fs.cpSync(webSrc, path.join(APP, 'web'), { recursive: true });

  // 3. Bundle the server to a single CJS file (pkg requires CommonJS).
  const banner = `const import_meta_url = require('url').pathToFileURL(__filename).href;`;
  const cjsOut = path.join(OUT, 'server.cjs');
  run(
    `npx esbuild server/src/index.js --bundle --platform=node --format=cjs ` +
      `--outfile="${cjsOut}" --define:import.meta.url=import_meta_url ` +
      `--banner:js="${banner}"`,
  );
  prependCrashHandler(cjsOut);

  // 4. Compile the executable (downloads the prebuilt Node runtime for the target).
  const exePath = path.join(APP, cfg.exe);
  run(`npx @yao-pkg/pkg "${cjsOut}" --target ${cfg.pkgTarget} --output "${exePath}"`);
  if (os === 'linux') fs.chmodSync(exePath, 0o755);
  if (os === 'win') hideConsole(exePath);

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
  if (os === 'win') {
    writeTray(APP);
    // Native "select a video" dialog (see server/src/index.js's pickFileNative);
    // resolved at runtime via BASE/scripts/pick-file.ps1, same relative layout
    // as in dev mode (server/scripts/pick-file.ps1).
    fs.mkdirSync(path.join(APP, 'scripts'), { recursive: true });
    fs.cpSync(path.join(ROOT, 'server/scripts/pick-file.ps1'), path.join(APP, 'scripts', 'pick-file.ps1'));
  }
  fs.writeFileSync(path.join(APP, 'LEEME.txt'), readmeFor(os));

  // 7. Archive.
  const archivePath = path.join(OUT, cfg.archiveName);
  if (os === 'win') zipWithAdm(APP, archivePath);
  else tarGz(APP, archivePath);

  // 8. Windows also gets a proper installer (NSIS) next to the portable zip.
  if (os === 'win') buildInstaller(APP);

  console.log(`\n✔ ${os} package ready: ${archivePath}`);
}

const targets = process.argv.slice(2);
if (targets.length === 0) {
  console.error('Usage: node scripts/package.mjs <win|linux> [...]');
  process.exit(1);
}
for (const t of targets) build(t);
