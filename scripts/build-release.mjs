// Builds the two release artefacts:
//
//   dist/V2A-Setup-<version>.exe     wizard installer (Inno Setup)
//   dist/V2A-<version>-portable.zip  unzip and run
//
// Both bundle node.exe, so nothing has to be installed first. Written in Node
// rather than PowerShell because this machine's AV quarantines .ps1 files that
// do anything interesting.
//
//   node scripts/build-release.mjs            build everything
//   node scripts/build-release.mjs --no-installer   skip the Inno Setup step

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const PAYLOAD = path.join(DIST, 'V2A');

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const VERSION = pkg.version;

const skipInstaller = process.argv.includes('--no-installer');

const log = (...a) => console.log(...a);
const die = (msg) => { console.error(`\n  ERROR: ${msg}\n`); process.exit(1); };

function findFirst(candidates, what) {
  const hit = candidates.find((p) => p && fs.existsSync(p));
  if (!hit) die(`${what} not found. Looked in:\n    ${candidates.join('\n    ')}`);
  return hit;
}

function humanSize(bytes) {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${(bytes / 1024).toFixed(0)} KB`;
}

function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

// ---------------------------------------------------------------- 1. clean

log(`\n  V2A release build — version ${VERSION}\n`);

if (fs.existsSync(DIST)) fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(PAYLOAD, { recursive: true });

// ------------------------------------------------- 2. compile the tray app

const csc = findFirst([
  path.join(process.env.SystemRoot || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'),
  path.join(process.env.SystemRoot || 'C:\\Windows', 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe'),
], 'The .NET Framework C# compiler (csc.exe)');

const trayExe = path.join(PAYLOAD, 'V2ATray.exe');
log('  [1/5] compiling V2ATray.exe');
const cscRes = spawnSync(csc, [
  '/nologo', '/target:winexe', '/optimize+', '/platform:anycpu',
  // Without this csc reads the source as ANSI and the Chinese menu labels
  // come out as mojibake.
  '/codepage:65001',
  `/out:${trayExe}`,
  '/reference:System.dll', '/reference:System.Drawing.dll', '/reference:System.Windows.Forms.dll',
  '/reference:System.Web.Extensions.dll',
  path.join(ROOT, 'scripts', 'V2ATray.cs'),
], { encoding: 'utf8', windowsHide: true });

if (cscRes.status !== 0 || !fs.existsSync(trayExe)) {
  die(`csc failed:\n${(cscRes.stderr || cscRes.stdout || '').trim()}`);
}
log(`        ${humanSize(fs.statSync(trayExe).size)}`);

// ------------------------------------------------------ 3. stage the files

log('  [2/5] staging payload');

const NODE_EXE = process.execPath;
fs.copyFileSync(NODE_EXE, path.join(PAYLOAD, 'node.exe'));

for (const f of ['server.js', 'V2A.vbs', 'package.json', 'LICENSE', 'README.md']) {
  const src = path.join(ROOT, f);
  if (!fs.existsSync(src)) die(`missing ${f}`);
  fs.copyFileSync(src, path.join(PAYLOAD, f));
}

fs.cpSync(path.join(ROOT, 'web'), path.join(PAYLOAD, 'web'), {
  recursive: true,
  // Debug entry points never belong in a release.
  filter: (src) => !path.basename(src).startsWith('_'),
});

// The tray source travels with the build so anyone can audit what the binary
// they were shipped actually does.
fs.mkdirSync(path.join(PAYLOAD, 'scripts'), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'scripts', 'V2ATray.cs'), path.join(PAYLOAD, 'scripts', 'V2ATray.cs'));

const payloadBytes = fs.readdirSync(PAYLOAD, { recursive: true, withFileTypes: true })
  .filter((d) => d.isFile())
  .reduce((sum, d) => sum + fs.statSync(path.join(d.parentPath ?? d.path, d.name)).size, 0);
log(`        ${humanSize(payloadBytes)} unpacked`);

// Sanity check: the launcher must still be UTF-16LE or Windows Script Host
// will read it in the ANSI codepage and choke on the Chinese strings.
const vbsHead = fs.readFileSync(path.join(PAYLOAD, 'V2A.vbs')).subarray(0, 2);
if (vbsHead[0] !== 0xff || vbsHead[1] !== 0xfe) {
  die('V2A.vbs lost its UTF-16LE BOM — the launcher would fail to parse.');
}

// ------------------------------------------------------- 4. portable zip

log('  [3/5] building portable zip');
const zipPath = path.join(DIST, `V2A-${VERSION}-portable.zip`);
// Compress-Archive is built into Windows PowerShell; no extra tooling.
const zipRes = spawnSync('powershell.exe', [
  '-NoProfile', '-NonInteractive', '-Command',
  `Compress-Archive -Path '${PAYLOAD}' -DestinationPath '${zipPath}' -CompressionLevel Optimal -Force`,
], { encoding: 'utf8', windowsHide: true });
if (zipRes.status !== 0 || !fs.existsSync(zipPath)) {
  die(`zip failed:\n${(zipRes.stderr || zipRes.stdout || '').trim()}`);
}
log(`        ${humanSize(fs.statSync(zipPath).size)}`);

// -------------------------------------------------------- 5. the installer

let setupPath = null;
if (skipInstaller) {
  log('  [4/5] skipping installer (--no-installer)');
} else {
  const iscc = findFirst([
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Inno Setup 6', 'ISCC.exe'),
    path.join(process.env['ProgramFiles(x86)'] || '', 'Inno Setup 6', 'ISCC.exe'),
    path.join(process.env.ProgramFiles || '', 'Inno Setup 6', 'ISCC.exe'),
  ], 'Inno Setup (ISCC.exe) — install it with: winget install JRSoftware.InnoSetup');

  log('  [4/5] compiling installer (this takes a minute — lzma2/max on ~86 MB)');
  const issRes = spawnSync(iscc, [
    `/DAppVersion=${VERSION}`,
    `/DPayloadDir=${PAYLOAD}`,
    path.join(ROOT, 'installer', 'V2A.iss'),
  ], { encoding: 'utf8', windowsHide: true, cwd: path.join(ROOT, 'installer') });

  if (issRes.status !== 0) die(`ISCC failed:\n${(issRes.stdout || '') + (issRes.stderr || '')}`);
  setupPath = path.join(DIST, `V2A-Setup-${VERSION}.exe`);
  if (!fs.existsSync(setupPath)) die('ISCC reported success but produced no installer');
  log(`        ${humanSize(fs.statSync(setupPath).size)}`);
}

// ------------------------------------------------------------ 6. checksums

log('  [5/5] checksums\n');

const artefacts = [zipPath, setupPath].filter(Boolean);
const lines = artefacts.map((f) => `${sha256(f)}  ${path.basename(f)}`);
fs.writeFileSync(path.join(DIST, 'SHA256SUMS.txt'), `${lines.join('\n')}\n`, 'utf8');

for (const f of artefacts) {
  log(`  ${path.basename(f).padEnd(34)} ${humanSize(fs.statSync(f).size).padStart(9)}`);
  log(`  ${' '.repeat(34)} ${sha256(f)}`);
}

log(`\n  Done. Artefacts in ${DIST}\n`);
