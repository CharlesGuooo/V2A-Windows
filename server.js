'use strict';

// V2A for Windows — local backend.
//
// Zero npm dependencies. Responsibilities:
//   - serve the web UI over 127.0.0.1 (a secure context, so getUserMedia +
//     AudioWorklet work exactly like the original web version)
//   - persist settings / history in %APPDATA%\V2A
//   - store API keys encrypted with Windows DPAPI (the Keychain analog)
//   - proxy AI-provider HTTP calls so the page never hits CORS, streaming
//     tokens back over SSE (1:1 with the Swift streaming clients)
//   - own the app lifecycle: browser app-window, tray helper, global hotkey
//
// Ports of: KeychainStore.swift, HistoryStore.swift, HotwordsStore.swift,
// OpenAICompatibleClient.swift, AnthropicClient.swift, GeminiClient.swift.

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { spawn, execFile } = require('node:child_process');

const ROOT = __dirname;
const WEB_DIR = path.join(ROOT, 'web');
const DATA_DIR = path.join(process.env.APPDATA || path.join(process.env.USERPROFILE, 'AppData', 'Roaming'), 'V2A');
const PROFILE_DIR = path.join(DATA_DIR, 'browser-profile');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');
const KEYS_FILE = path.join(DATA_DIR, 'keys.dat');
const LOG_FILE = path.join(DATA_DIR, 'v2a.log');

const BASE_PORT = 8731;
const WINDOW_W = 500;
const WINDOW_H = 780;
const HISTORY_CAP = 20; // HistoryStore.cap

const GITHUB_REPO = 'CharlesGuooo/V2A-Windows';

// package.json is the single source of truth for the version — the About
// screen, the update check and the release artefact names all read it.
const APP_VERSION = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version || '0.0.0';
  } catch {
    return '0.0.0';
  }
})();

// ---------------------------------------------------------------- logging

fs.mkdirSync(DATA_DIR, { recursive: true });

function log(...parts) {
  const line = `[${new Date().toISOString()}] ${parts.join(' ')}\n`;
  try { fs.appendFileSync(LOG_FILE, line); } catch { /* ignore */ }
  if (process.env.V2A_CONSOLE) process.stdout.write(line);
}

process.on('uncaughtException', (e) => log('uncaughtException', e && e.stack || e));
process.on('unhandledRejection', (e) => log('unhandledRejection', e && e.stack || e));

// ---------------------------------------------------------------- providers
// Mirrors V2A/Services/Providers/*.swift — same ids, models, and URLs.

const PROVIDERS = [
  {
    id: 'deepseek',
    displayName: 'Deepseek V4 Flash',
    defaultModel: 'deepseek-v4-flash',
    apiKeyHelpURL: 'https://platform.deepseek.com/api_keys',
    billingURL: 'https://platform.deepseek.com/top_up',
    account: 'deepseek',
    kind: 'openai',
    endpoint: 'https://api.deepseek.com/chat/completions',
  },
  {
    id: 'claude',
    displayName: 'Claude Haiku 4.5',
    defaultModel: 'claude-haiku-4-5-20251001',
    apiKeyHelpURL: 'https://console.anthropic.com/settings/keys',
    billingURL: 'https://console.anthropic.com/settings/billing',
    account: 'provider.claude',
    kind: 'anthropic',
    endpoint: 'https://api.anthropic.com/v1/messages',
  },
  {
    id: 'gemini',
    displayName: 'Gemini 2.5 Flash',
    defaultModel: 'gemini-2.5-flash',
    apiKeyHelpURL: 'https://aistudio.google.com/apikey',
    billingURL: 'https://console.cloud.google.com/billing',
    account: 'provider.gemini',
    kind: 'gemini',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/models',
  },
  {
    id: 'openai',
    displayName: 'OpenAI GPT-4o mini',
    defaultModel: 'gpt-4o-mini',
    apiKeyHelpURL: 'https://platform.openai.com/api-keys',
    billingURL: 'https://platform.openai.com/settings/organization/billing',
    account: 'provider.openai',
    kind: 'openai',
    endpoint: 'https://api.openai.com/v1/chat/completions',
  },
  {
    id: 'groq',
    displayName: 'Groq Llama 3.1 8B',
    defaultModel: 'llama-3.1-8b-instant',
    apiKeyHelpURL: 'https://console.groq.com/keys',
    billingURL: 'https://console.groq.com/settings/billing',
    account: 'provider.groq',
    kind: 'openai',
    endpoint: 'https://api.groq.com/openai/v1/chat/completions',
  },
];

const DEFAULT_PROVIDER_ID = 'deepseek';
const findProvider = (id) => PROVIDERS.find((p) => p.id === id) || null;
const ALL_ACCOUNTS = ['soniox', ...PROVIDERS.map((p) => p.account)];

// ---------------------------------------------------------------- settings

const DEFAULT_SETTINGS = {
  activeProvider: DEFAULT_PROVIDER_ID,
  languages: ['zh', 'en'],
  promptSlot1: '',
  promptSlot2: '',
  hotwords: [],
  onboarded: false,
  uiLanguage: 'zh',       // system | zh | en
  appearance: 'system',   // system | light | dark
  // On by default: the cleaned text is what you actually want in your agent,
  // so putting it straight on the clipboard removes the last manual step.
  autoCopy: true,
  historyEnabled: true,
  // Single source of truth for the global hotkeys — read by the tray helper
  // and shown verbatim in onboarding and settings.
  hotkeys: {
    record: 'Ctrl+Shift+R',
    light: 'Ctrl+Shift+Q',
    deep: 'Ctrl+Shift+D',
    copy: 'Ctrl+Shift+X',
    // Clearing throws away the transcript, so it gets a combination that is
    // hard to hit by accident — and Backspace reads as "delete" anyway.
    clear: 'Ctrl+Shift+Backspace',
  },
  hotkeysEnabled: true,
  autostart: false,       // a shortcut in the Startup folder
};

const HOTKEY_ACTIONS = ['record', 'light', 'deep', 'copy', 'clear'];

function readJson(file, fallback) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed == null ? fallback : parsed;
  } catch {
    return fallback;
  }
}

// Write to a temp file then rename, so a crash mid-write can't corrupt state.
function writeJsonAtomic(file, value) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

// Normalises anything that came from an older settings.json so the rest of the
// code can trust the shape.
function migrateSettings(s) {
  const next = { ...DEFAULT_SETTINGS, ...s };
  next.hotkeys = { ...DEFAULT_SETTINGS.hotkeys, ...(s && s.hotkeys) };
  // Pre-1.0 stored a single `hotkey` string; carry it over as the record key.
  if (s && typeof s.hotkey === 'string' && !(s.hotkeys && s.hotkeys.record)) {
    next.hotkeys.record = s.hotkey;
  }
  if (s && typeof s.hotkeyEnabled === 'boolean' && s.hotkeysEnabled === undefined) {
    next.hotkeysEnabled = s.hotkeyEnabled;
  }
  delete next.hotkey;
  delete next.hotkeyEnabled;
  return next;
}

let settings = migrateSettings(readJson(SETTINGS_FILE, {}));

function saveSettings(patch) {
  // hotkeys is nested, so a shallow spread would drop the keys not being changed.
  const mergedHotkeys = patch.hotkeys
    ? { ...settings.hotkeys, ...patch.hotkeys }
    : settings.hotkeys;
  settings = { ...settings, ...patch, hotkeys: mergedHotkeys };

  if (!Array.isArray(settings.languages) || settings.languages.length === 0) {
    settings.languages = ['zh', 'en'];
  }
  if (!findProvider(settings.activeProvider)) settings.activeProvider = DEFAULT_PROVIDER_ID;
  for (const action of HOTKEY_ACTIONS) {
    if (typeof settings.hotkeys[action] !== 'string' || !settings.hotkeys[action]) {
      settings.hotkeys[action] = DEFAULT_SETTINGS.hotkeys[action];
    }
  }
  writeJsonAtomic(SETTINGS_FILE, settings);
  return settings;
}

// ---------------------------------------------------------------- DPAPI keys
// KeychainStore.swift equivalent. The whole key blob is encrypted as one
// DPAPI CurrentUser secret, so only this Windows user account can read it —
// the same trust boundary the iOS Keychain gives.

// Runs a script through `powershell -Command -` (stdin). Note the constraint:
// in that mode a blank or whitespace-only line silently terminates the current
// statement block — the rest is dropped with no error. Keep generated scripts
// free of blank lines, and prefer one statement per line over multi-line blocks.
function runPowerShell(script) {
  return new Promise((resolve, reject) => {
    // Catch the two silent-failure modes described above at the source, rather
    // than debugging an empty result later.
    const src = script.trim();
    // eslint-disable-next-line no-control-regex
    if (/[^\x00-\x7F]/.test(src)) {
      return reject(new Error('PowerShell script must be ASCII-only; use psText() for non-ASCII literals'));
    }
    if (/^[ \t]*$/m.test(src)) {
      return reject(new Error('PowerShell script must not contain blank lines (stdin mode truncates blocks)'));
    }
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', '-'],
      { windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) return reject(new Error(stderr || err.message));
        resolve(String(stdout).trim());
      },
    ).stdin.end(`${src}\n`);
  });
}

async function dpapiProtect(plaintext) {
  const b64 = Buffer.from(plaintext, 'utf8').toString('base64');
  const script = `
Add-Type -AssemblyName System.Security
$bytes = [Convert]::FromBase64String('${b64}')
$enc = [System.Security.Cryptography.ProtectedData]::Protect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
[Convert]::ToBase64String($enc)
`;
  return runPowerShell(script);
}

async function dpapiUnprotect(cipherB64) {
  const script = `
Add-Type -AssemblyName System.Security
$bytes = [Convert]::FromBase64String('${cipherB64}')
$dec = [System.Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
[Convert]::ToBase64String($dec)
`;
  const outB64 = await runPowerShell(script);
  return Buffer.from(outB64, 'base64').toString('utf8');
}

let keys = {};   // account -> key string

async function loadKeys() {
  if (!fs.existsSync(KEYS_FILE)) { keys = {}; return; }
  try {
    const cipher = fs.readFileSync(KEYS_FILE, 'utf8').trim();
    if (!cipher) { keys = {}; return; }
    keys = JSON.parse(await dpapiUnprotect(cipher)) || {};
    log('keys loaded:', Object.keys(keys).filter((k) => keys[k]).join(',') || '(none)');
  } catch (e) {
    log('key decrypt failed:', e.message);
    keys = {};
  }
}

async function saveKeys(patch) {
  for (const [account, value] of Object.entries(patch)) {
    if (!ALL_ACCOUNTS.includes(account)) continue;
    const trimmed = typeof value === 'string' ? value.trim() : '';
    if (trimmed) keys[account] = trimmed; else delete keys[account];
  }
  const cipher = await dpapiProtect(JSON.stringify(keys));
  fs.writeFileSync(KEYS_FILE, cipher, 'utf8');
}

// ---------------------------------------------------------------- history

function loadHistory() {
  const list = readJson(HISTORY_FILE, []);
  return Array.isArray(list) ? list : [];
}

function appendHistory(session) {
  const list = loadHistory();
  list.unshift(session);                     // newest first
  writeJsonAtomic(HISTORY_FILE, list.slice(0, HISTORY_CAP));
}

// ---------------------------------------------------------------- updates
//
// Deliberately minimal: ask GitHub once every few hours whether a newer
// release exists and let the settings screen show a link. Nothing is
// downloaded, nothing is forced, and any failure is silent — an update check
// must never be a reason the app misbehaves.

const UPDATE_TTL_MS = 6 * 60 * 60 * 1000;
let updateCache = { at: 0, data: null };

// Numeric-segment semver compare. Returns >0 when a is newer than b.
function compareVersions(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

async function checkForUpdate() {
  const now = Date.now();
  if (updateCache.data && now - updateCache.at < UPDATE_TTL_MS) return updateCache.data;

  const fallback = { current: APP_VERSION, latest: null, hasUpdate: false, url: null };
  try {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
      headers: { 'User-Agent': `V2A/${APP_VERSION}`, Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(8000),
    });
    // 404 just means no release has been published yet.
    if (!res.ok) {
      updateCache = { at: now, data: fallback };
      return fallback;
    }
    const json = await res.json();
    const latest = String(json.tag_name || '').replace(/^v/i, '');
    const data = {
      current: APP_VERSION,
      latest: latest || null,
      hasUpdate: !!latest && compareVersions(latest, APP_VERSION) > 0,
      url: json.html_url || `https://github.com/${GITHUB_REPO}/releases/latest`,
    };
    updateCache = { at: now, data };
    return data;
  } catch (e) {
    log('update check failed:', e.message);
    updateCache = { at: now, data: fallback };
    return fallback;
  }
}

// ---------------------------------------------------------------- session
//
// The authoritative transcript state lives here rather than in the page, so
// the global hotkeys keep working with no window open and any window that
// opens later shows what you just dictated. Deliberately in-memory: a restart
// clears it, which matches what closing the app always meant.

const session = {
  recording: false,
  processing: false,
  finalText: '',
  liveText: '',
  processedText: '',
};

// Same rule as AppState.rawDisplay in the iOS app.
function rawText() {
  if (!session.liveText) return session.finalText;
  if (!session.finalText) return session.liveText;
  return `${session.finalText}\n\n${session.liveText}`;
}

function sessionSnapshot() {
  return {
    recording: session.recording,
    processing: session.processing,
    finalText: session.finalText,
    liveText: session.liveText,
    processedText: session.processedText,
  };
}

function broadcastSession() {
  broadcast('session', { session: sessionSnapshot() });
}

// web/prompts.js is an ES module shared with the browser; import it lazily so
// the prompt text has exactly one definition.
let promptDefaults = null;
async function getPromptDefaults() {
  if (!promptDefaults) {
    const href = require('node:url').pathToFileURL(path.join(WEB_DIR, 'prompts.js')).href;
    promptDefaults = (await import(href)).PromptDefaults;
  }
  return promptDefaults;
}

async function promptFor(kind) {
  const p = await getPromptDefaults();
  switch (kind) {
    case 'deep': return p.deepCanonical;
    case 'custom1': return settings.promptSlot1 || p.lightCanonical;
    case 'custom2': return settings.promptSlot2 || p.lightCanonical;
    default: return p.lightCanonical;
  }
}

// ---------------------------------------------------------------- SSE bus
// One SSE stream per open app window. Also our "is a window open?" signal.

const eventClients = new Set();

function broadcast(type, payload = {}) {
  const frame = `data: ${JSON.stringify({ type, ...payload })}\n\n`;
  for (const res of eventClients) {
    try { res.write(frame); } catch { /* client gone */ }
  }
}

// ---------------------------------------------------------------- browser

function findBrowser() {
  const pf = process.env['ProgramFiles'] || 'C:\\Program Files';
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const local = process.env['LOCALAPPDATA'] || '';
  const candidates = [
    path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(local, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ];
  return candidates.find((p) => p && fs.existsSync(p)) || null;
}

let PORT = BASE_PORT;

function openWindow(query = '') {
  const exe = findBrowser();
  if (!exe) {
    log('no Chromium browser found');
    return false;
  }
  const args = [
    `--app=http://127.0.0.1:${PORT}/${query}`,
    `--user-data-dir=${PROFILE_DIR}`,
    `--window-size=${WINDOW_W},${WINDOW_H}`,
    '--no-first-run',
    '--no-default-browser-check',
    // Without all three of these Chromium suspends the renderer once the
    // window is occluded or unfocused, which stalls the SSE stream and makes
    // the global hotkey look broken the moment you switch to another app.
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-features=Translate,TranslateUI,MediaRouter,CalculateNativeWinOcclusion',
  ];
  try {
    const child = spawn(exe, args, { detached: true, stdio: 'ignore', windowsHide: false });
    child.unref();
    log('window opened via', path.basename(exe), query);
    return true;
  } catch (e) {
    log('window open failed:', e.message);
    return false;
  }
}

// Open a real external link in the user's *default* browser, not in our
// chromeless app window (an --app window has no address bar or tabs).
function openExternal(url) {
  if (!/^https?:\/\//i.test(url)) return;
  try {
    spawn('cmd', ['/c', 'start', '', url.replace(/&/g, '^&')], {
      detached: true, stdio: 'ignore', windowsHide: true,
    }).unref();
  } catch (e) {
    log('openExternal failed:', e.message);
  }
}

// ---------------------------------------------------------------- shortcuts
//
// Created through the WScript.Shell COM object, which is also what Explorer
// itself uses for .lnk files — no P/Invoke, nothing an AV scanner objects to.

const psQuote = (s) => `'${String(s).replace(/'/g, "''")}'`;

// PowerShell decodes our stdin using the console's OEM codepage, so a literal
// like '语音转文字' arrives mangled and breaks the parse. Anything non-ASCII
// therefore travels as base64 and gets decoded on the other side.
const psText = (s) => {
  const str = String(s);
  // eslint-disable-next-line no-control-regex
  return /^[\x20-\x7E]*$/.test(str)
    ? psQuote(str)
    : `[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(str, 'utf8').toString('base64')}'))`;
};

const LAUNCHER_VBS = path.join(ROOT, 'V2A.vbs');
const ICON_FILE = path.join(WEB_DIR, 'icon.ico');

// Defines a New-V2ALink function. Every statement stays on its own single
// line on purpose — see the note in runPowerShell about blank lines.
function linkFunctionScript() {
  const wscript = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'wscript.exe');
  const body = [
    '$l = $ws.CreateShortcut($p)',
    `$l.TargetPath = ${psText(wscript)}`,
    `$l.Arguments = ${psText(`"${LAUNCHER_VBS}"`)}`,
    `$l.WorkingDirectory = ${psText(ROOT)}`,
    `$l.IconLocation = ${psText(ICON_FILE)}`,
    `$l.Description = ${psText('V2A - 语音转文字')}`,
    '$l.Save()',
  ].join('; ');
  return [
    '$ws = New-Object -ComObject WScript.Shell',
    `function New-V2ALink($p) { ${body} }`,
  ].join('\n');
}

// Desktop + Start Menu entries. Only created when missing, so a user who moves
// or renames them doesn't get them silently recreated on every launch.
async function ensureShortcuts() {
  try {
    const out = await runPowerShell([
      linkFunctionScript(),
      '$made = @()',
      "$d = Join-Path ([Environment]::GetFolderPath('Desktop')) 'V2A.lnk'",
      'if (-not (Test-Path $d)) { New-V2ALink $d; $made += $d }',
      "$s = Join-Path ([Environment]::GetFolderPath('Programs')) 'V2A.lnk'",
      'if (-not (Test-Path $s)) { New-V2ALink $s; $made += $s }',
      '$made -join ";"',
    ].join('\n'));
    log(out ? `shortcuts created: ${out}` : 'shortcuts already present');
  } catch (e) {
    log('shortcut creation failed:', e.message);
  }
}

// Startup-folder entry, driven by the "开机自动启动" setting.
async function applyAutostart(enabled) {
  try {
    const target = "$t = Join-Path ([Environment]::GetFolderPath('Startup')) 'V2A.lnk'";
    if (enabled) {
      await runPowerShell([linkFunctionScript(), target, 'New-V2ALink $t', "'on'"].join('\n'));
    } else {
      await runPowerShell([target, 'if (Test-Path $t) { Remove-Item $t -Force }', "'off'"].join('\n'));
    }
    log('autostart', enabled ? 'enabled' : 'disabled');
    return true;
  } catch (e) {
    log('autostart change failed:', e.message);
    return false;
  }
}

// ---------------------------------------------------------------- tray helper
//
// The tray icon + global hotkey live in a tiny .NET binary, compiled on first
// run by the C# compiler that ships with Windows. It's shipped as source and
// built locally so there's still nothing to install — and unlike a PowerShell
// script it doesn't trip AMSI heuristics (a tray app that registers a hotkey
// and talks to localhost looks exactly like a keylogger to a script scanner,
// and some AV products quarantine the .ps1 outright).

// Released builds ship a prebuilt V2ATray.exe next to server.js; running from
// source has no such file and compiles one into the data directory instead.
// Preferring the shipped binary matters: a freshly compiled, low-reputation exe
// is exactly what antivirus heuristics quarantine.
const TRAY_SRC = path.join(ROOT, 'scripts', 'V2ATray.cs');
const TRAY_EXE_SHIPPED = path.join(ROOT, 'V2ATray.exe');
const TRAY_EXE_BUILT = path.join(DATA_DIR, 'V2ATray.exe');

let trayProc = null;

function findCsc() {
  const root = process.env.SystemRoot || 'C:\\Windows';
  return [
    path.join(root, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'),
    path.join(root, 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe'),
  ].find((p) => fs.existsSync(p)) || null;
}

// Returns the tray executable to launch, or null if there isn't one.
// A released build always takes the first branch and never invokes a compiler.
function resolveTray() {
  if (fs.existsSync(TRAY_EXE_SHIPPED)) return TRAY_EXE_SHIPPED;
  if (!fs.existsSync(TRAY_SRC)) return null;

  // Source checkout: build once, then reuse until the source changes.
  try {
    if (fs.existsSync(TRAY_EXE_BUILT) &&
        fs.statSync(TRAY_EXE_BUILT).mtimeMs >= fs.statSync(TRAY_SRC).mtimeMs) {
      return TRAY_EXE_BUILT;
    }
  } catch { /* fall through and rebuild */ }

  const csc = findCsc();
  if (!csc) { log('no csc.exe found — tray unavailable'); return null; }

  const args = [
    '/nologo', '/target:winexe', '/optimize+', '/platform:anycpu',
    // Without this csc reads the source in the system ANSI codepage and the
    // Chinese menu labels come out as mojibake.
    '/codepage:65001',
    `/out:${TRAY_EXE_BUILT}`,
    '/reference:System.dll', '/reference:System.Drawing.dll', '/reference:System.Windows.Forms.dll',
    // JavaScriptSerializer, used for the JSON the tray exchanges with us.
    '/reference:System.Web.Extensions.dll',
    TRAY_SRC,
  ];
  const res = require('node:child_process').spawnSync(csc, args, { windowsHide: true, encoding: 'utf8' });
  if (res.status !== 0 || !fs.existsSync(TRAY_EXE_BUILT)) {
    log('tray build failed:', (res.stderr || res.stdout || '').trim().slice(0, 500));
    return null;
  }
  log('tray binary built:', TRAY_EXE_BUILT);
  return TRAY_EXE_BUILT;
}

function startTray() {
  stopTray();
  const exe = resolveTray();
  if (!exe) return;
  // The tray registers every hotkey it is given, so hand it the whole map.
  const hotkeyArg = settings.hotkeysEnabled ? JSON.stringify(settings.hotkeys) : 'None';
  try {
    trayProc = spawn(exe, [String(PORT), hotkeyArg, path.join(WEB_DIR, 'icon.ico')], {
      detached: false, stdio: 'ignore', windowsHide: true,
    });
    trayProc.on('exit', (code) => log('tray exited', code));
    log('tray started:', path.basename(path.dirname(exe)) + '\\' + path.basename(exe), '| hotkeys =', hotkeyArg);
  } catch (e) {
    log('tray start failed:', e.message);
  }
}

function stopTray() {
  if (trayProc && !trayProc.killed) {
    try { trayProc.kill(); } catch { /* ignore */ }
  }
  trayProc = null;
}

function shutdown() {
  log('shutting down');
  stopTray();
  broadcast('quit');
  setTimeout(() => process.exit(0), 150);
}

// ---------------------------------------------------------------- AI cleanup
// Streaming ports of the three Swift low-level clients. `emit` receives each
// token as it arrives; the resolved value is the trimmed full text.

class HttpError extends Error {
  constructor(status, body) {
    super(`HTTP ${status}`);
    this.status = status;
    this.body = body;
  }
}

// Short, toast-sized version of web/errors.js classifyProvider — same branches,
// but the tray only has room for one line.
function describeProviderError(err, provider) {
  const name = provider ? provider.displayName : 'AI';
  const body = String(err.body || '').toLowerCase();
  const quota = body.includes('insufficient') || body.includes('balance')
    || body.includes('quota') || body.includes('resource_exhausted') || body.includes('credit');

  if (err.status === 402 || quota) return `${name} 余额 / 额度不足`;
  if (err.status === 401 || err.status === 403
      || body.includes('api_key_invalid') || body.includes('authentication')
      || (body.includes('invalid') && body.includes('key'))) {
    return `${name} 的 API key 无效或已失效`;
  }
  if (err.status === 429) return '请求太频繁，稍等几秒再试';
  return `整理失败（${err.status}）`;
}

// Reads an SSE-ish HTTP body line by line.
async function* readLines(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      yield buf.slice(0, nl).replace(/\r$/, '');
      buf = buf.slice(nl + 1);
    }
  }
  if (buf) yield buf;
}

async function readErrorBody(response) {
  try {
    const text = await response.text();
    return text.slice(0, 2000);
  } catch {
    return '';
  }
}

async function cleanupOpenAI(p, apiKey, systemPrompt, transcript, emit, signal) {
  const res = await fetch(p.endpoint, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: p.defaultModel,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: transcript },
      ],
      stream: true,
      temperature: 0.2,
    }),
  });
  if (!res.ok) throw new HttpError(res.status, await readErrorBody(res));

  let acc = '';
  for await (const line of readLines(res)) {
    if (!line.startsWith('data: ')) continue;
    const payload = line.slice(6);
    if (payload === '[DONE]') break;
    let obj;
    try { obj = JSON.parse(payload); } catch { continue; }
    const content = obj?.choices?.[0]?.delta?.content;
    if (typeof content === 'string' && content) { acc += content; emit(content); }
  }
  return acc.trim();
}

async function cleanupAnthropic(p, apiKey, systemPrompt, transcript, emit, signal) {
  const res = await fetch(p.endpoint, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: p.defaultModel,
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: transcript }],
      stream: true,
      temperature: 0.2,
    }),
  });
  if (!res.ok) throw new HttpError(res.status, await readErrorBody(res));

  let acc = '';
  for await (const line of readLines(res)) {
    if (!line.startsWith('data: ')) continue;
    let obj;
    try { obj = JSON.parse(line.slice(6)); } catch { continue; }
    if (obj.type === 'content_block_delta' && obj.delta?.type === 'text_delta') {
      const t = obj.delta.text || '';
      if (t) { acc += t; emit(t); }
    } else if (obj.type === 'message_stop') {
      break;
    }
  }
  return acc.trim();
}

async function cleanupGemini(p, apiKey, systemPrompt, transcript, emit, signal) {
  const url = `${p.endpoint}/${p.defaultModel}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: transcript }] }],
      generationConfig: { temperature: 0.2 },
    }),
  });
  if (!res.ok) throw new HttpError(res.status, await readErrorBody(res));

  let acc = '';
  for await (const line of readLines(res)) {
    if (!line.startsWith('data: ')) continue;
    let obj;
    try { obj = JSON.parse(line.slice(6)); } catch { continue; }
    let out = '';
    for (const cand of obj.candidates || []) {
      for (const part of cand.content?.parts || []) {
        if (typeof part.text === 'string') out += part.text;
      }
    }
    if (out) { acc += out; emit(out); }
  }
  return acc.trim();
}

function runCleanup(p, apiKey, systemPrompt, transcript, emit, signal) {
  if (p.kind === 'anthropic') return cleanupAnthropic(p, apiKey, systemPrompt, transcript, emit, signal);
  if (p.kind === 'gemini') return cleanupGemini(p, apiKey, systemPrompt, transcript, emit, signal);
  return cleanupOpenAI(p, apiKey, systemPrompt, transcript, emit, signal);
}

// ---------------------------------------------------------------- HTTP server

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
};

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 4 * 1024 * 1024) { reject(new Error('body too large')); req.destroy(); }
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

async function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const file = path.join(WEB_DIR, rel);
  // Never serve outside web/.
  if (!file.startsWith(WEB_DIR)) { res.writeHead(403).end('forbidden'); return; }
  try {
    const data = await fsp.readFile(file);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': data.length,
      'Cache-Control': 'no-store',
    });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('not found');
  }
}

async function handleApi(req, res, url) {
  const route = url.pathname;

  // ---- bootstrap: everything the page needs on load
  if (route === '/api/bootstrap' && req.method === 'GET') {
    return sendJson(res, 200, {
      settings,
      keys,                                  // loopback only; same process trust boundary
      providers: PROVIDERS.map(({ kind, endpoint, ...pub }) => pub),
      defaultProviderId: DEFAULT_PROVIDER_ID,
      historyCap: HISTORY_CAP,
      version: APP_VERSION,
      repoURL: `https://github.com/${GITHUB_REPO}`,
    });
  }

  // ---- update check (cached, fails silently)
  if (route === '/api/update-check' && req.method === 'GET') {
    return sendJson(res, 200, await checkForUpdate());
  }

  // ---- session: shared transcript state -------------------------------

  if (route === '/api/session' && req.method === 'GET') {
    return sendJson(res, 200, sessionSnapshot());
  }

  // What the tray needs to open a Soniox stream.
  if (route === '/api/session/config' && req.method === 'GET') {
    return sendJson(res, 200, {
      sonioxKey: keys.soniox || '',
      languages: settings.languages,
      hotwords: settings.hotwords,
    });
  }

  if (route === '/api/session/recording' && req.method === 'POST') {
    const { recording } = await readBody(req);
    session.recording = !!recording;
    if (session.recording) session.liveText = '';
    broadcastSession();
    return sendJson(res, 200, { ok: true });
  }

  // Live (interim) transcript while recording.
  if (route === '/api/session/transcript' && req.method === 'POST') {
    const { text } = await readBody(req);
    session.liveText = String(text || '');
    broadcastSession();
    return sendJson(res, 200, { ok: true });
  }

  // End of a recording: fold the live text into the accumulated transcript.
  if (route === '/api/session/commit' && req.method === 'POST') {
    const { text } = await readBody(req);
    const piece = String(text || '').trim();
    if (piece) session.finalText = session.finalText ? `${session.finalText}\n\n${piece}` : piece;
    session.liveText = '';
    session.recording = false;
    broadcastSession();
    return sendJson(res, 200, { ok: true, chars: piece.length });
  }

  // Free-form edit from the UI window.
  if (route === '/api/session/text' && req.method === 'POST') {
    const body = await readBody(req);
    if (typeof body.finalText === 'string') { session.finalText = body.finalText; session.liveText = ''; }
    if (typeof body.processedText === 'string') session.processedText = body.processedText;
    broadcastSession();
    return sendJson(res, 200, { ok: true });
  }

  if (route === '/api/session/processed' && req.method === 'GET') {
    return sendJson(res, 200, { text: session.processedText });
  }

  if (route === '/api/session/clear' && req.method === 'POST') {
    const had = !!(session.finalText || session.liveText || session.processedText);
    session.finalText = '';
    session.liveText = '';
    session.processedText = '';
    broadcastSession();
    return sendJson(res, 200, { ok: true, cleared: had });
  }

  // Tells the tray to start/stop capturing (the window's record button).
  if (route === '/api/session/record/toggle' && req.method === 'POST') {
    broadcast('toggle-record');
    return sendJson(res, 200, { ok: true });
  }

  // Runs an AI cleanup. Answers the caller synchronously (the tray shows a
  // toast with the outcome) while streaming tokens to any open window.
  if (route === '/api/session/cleanup' && req.method === 'POST') {
    const { kind } = await readBody(req);
    const source = rawText().trim();

    if (session.recording) return sendJson(res, 200, { ok: false, message: '正在录音，先停止再整理' });
    if (session.processing) return sendJson(res, 200, { ok: false, message: '正在整理中，稍等' });
    if (!source) return sendJson(res, 200, { ok: false, message: '没有可整理的内容' });

    const provider = findProvider(settings.activeProvider);
    const apiKey = provider ? keys[provider.account] : null;
    if (!provider || !apiKey) {
      return sendJson(res, 200, {
        ok: false,
        message: `还没有配置 ${provider ? provider.displayName : 'AI'} 的 API key`,
      });
    }

    session.processing = true;
    session.processedText = '';
    broadcastSession();

    try {
      const systemPrompt = await promptFor(kind);
      const full = await runCleanup(
        provider, apiKey, systemPrompt, source,
        (token) => {
          session.processedText += token;
          broadcast('cleanup-token', { v: token });
        },
        undefined,
      );
      session.processedText = full;

      if (settings.historyEnabled) {
        appendHistory({
          id: require('node:crypto').randomUUID(),
          timestamp: new Date().toISOString(),
          raw: source,
          cleaned: full,
          providerId: provider.id,
          mode: kind || 'light',
        });
      }
      return sendJson(res, 200, { ok: true, text: full, copied: !!settings.autoCopy });
    } catch (e) {
      const message = e instanceof HttpError
        ? describeProviderError(e, provider)
        : `整理失败：${e.message || e}`;
      log('cleanup failed:', message);
      return sendJson(res, 200, { ok: false, message });
    } finally {
      session.processing = false;
      broadcastSession();
    }
  }

  // ---- settings
  if (route === '/api/settings' && req.method === 'POST') {
    const patch = await readBody(req);
    const before = JSON.stringify([settings.hotkeys, settings.hotkeysEnabled]);
    const autostartChanged =
      patch.autostart !== undefined && patch.autostart !== settings.autostart;
    saveSettings(patch);
    if (JSON.stringify([settings.hotkeys, settings.hotkeysEnabled]) !== before) startTray();
    if (autostartChanged) await applyAutostart(settings.autostart);
    return sendJson(res, 200, { ok: true, settings });
  }

  // ---- API keys (DPAPI)
  if (route === '/api/keys' && req.method === 'POST') {
    const patch = await readBody(req);
    try {
      await saveKeys(patch);
      return sendJson(res, 200, { ok: true, keys });
    } catch (e) {
      log('saveKeys failed:', e.message);
      return sendJson(res, 500, { ok: false, error: e.message });
    }
  }

  // ---- history
  if (route === '/api/history' && req.method === 'GET') {
    return sendJson(res, 200, { sessions: loadHistory() });
  }
  if (route === '/api/history' && req.method === 'POST') {
    const session = await readBody(req);
    if (settings.historyEnabled) appendHistory(session);
    return sendJson(res, 200, { ok: true });
  }
  if (route === '/api/history' && req.method === 'DELETE') {
    const { id } = await readBody(req);
    if (id) writeJsonAtomic(HISTORY_FILE, loadHistory().filter((s) => s.id !== id));
    else writeJsonAtomic(HISTORY_FILE, []);
    return sendJson(res, 200, { ok: true });
  }

  // ---- open a link in the default browser
  if (route === '/api/open' && req.method === 'POST') {
    const { url: target } = await readBody(req);
    openExternal(String(target || ''));
    return sendJson(res, 200, { ok: true });
  }

  // ---- SSE event stream (also the "a window is open" signal)
  if (route === '/api/events' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(': connected\n\n');
    eventClients.add(res);
    const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* ignore */ } }, 25000);
    req.on('close', () => { clearInterval(ping); eventClients.delete(res); });
    return undefined;
  }

  // ---- tray / hotkey / second-instance commands
  if (route.startsWith('/api/tray/') && req.method === 'POST') {
    const action = route.slice('/api/tray/'.length);
    log('tray action:', action);
    if (action === 'toggle-record') {
      if (eventClients.size > 0) broadcast('toggle-record');
      else openWindow('?autorecord=1');       // no window open — open one that starts recording
    } else if (action === 'show') {
      if (eventClients.size > 0) broadcast('focus');
      openWindow('');
    } else if (action === 'quit') {
      sendJson(res, 200, { ok: true });
      return shutdown();
    }
    return sendJson(res, 200, { ok: true, windows: eventClients.size });
  }

  // ---- streaming AI cleanup proxy
  if (route === '/api/cleanup' && req.method === 'POST') {
    const { providerId, systemPrompt, transcript } = await readBody(req);
    const provider = findProvider(providerId);
    if (!provider) return sendJson(res, 400, { error: 'unknown-provider', providerId });
    const apiKey = keys[provider.account];
    if (!apiKey) return sendJson(res, 400, { error: 'missing-key' });

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    const send = (obj) => { try { res.write(`data: ${JSON.stringify(obj)}\n\n`); } catch { /* ignore */ } };

    const controller = new AbortController();
    req.on('close', () => controller.abort());

    try {
      const full = await runCleanup(
        provider, apiKey, String(systemPrompt || ''), String(transcript || ''),
        (token) => send({ t: 'token', v: token }),
        controller.signal,
      );
      send({ t: 'done', v: full });
    } catch (e) {
      if (e instanceof HttpError) send({ t: 'error', kind: 'http', status: e.status, body: e.body });
      else if (e.name === 'AbortError') { /* client navigated away */ }
      else send({ t: 'error', kind: 'network', message: String(e.message || e) });
    }
    return res.end();
  }

  return sendJson(res, 404, { error: 'not-found' });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  if (url.pathname.startsWith('/api/')) {
    handleApi(req, res, url).catch((e) => {
      log('api error', url.pathname, e.stack || e.message);
      if (!res.headersSent) sendJson(res, 500, { error: String(e.message || e) });
      else res.end();
    });
    return;
  }
  serveStatic(req, res, url.pathname);
});

// Refuse anything that isn't loopback.
server.on('connection', (socket) => {
  const addr = socket.remoteAddress || '';
  if (!addr.includes('127.0.0.1') && addr !== '::1') socket.destroy();
});

// ---------------------------------------------------------------- startup

// Single instance: if the port is already taken, hand off to the running copy.
function pingExisting(port) {
  return new Promise((resolve) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: '/api/tray/show', method: 'POST', timeout: 1500 },
      (res) => { res.resume(); resolve(res.statusCode === 200); },
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.end('{}');
  });
}

async function main() {
  const already = await pingExisting(BASE_PORT);
  if (already) {
    log('another instance is running; asked it to show its window');
    process.exit(0);
  }

  await loadKeys();

  server.listen(BASE_PORT, '127.0.0.1', () => {
    PORT = server.address().port;
    log('V2A server listening on http://127.0.0.1:' + PORT);
    startTray();
    ensureShortcuts();
    if (!process.env.V2A_NO_WINDOW) openWindow('');
  });

  server.on('error', (e) => {
    log('server error:', e.message);
    process.exit(1);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

main();
