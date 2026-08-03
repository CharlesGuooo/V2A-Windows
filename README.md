<div align="center">

**English** · [中文](README.zh-CN.md)

# V2A for Windows

**Speak → live transcript → AI cleans it up → paste into ChatGPT, Claude, or any agent**

For when typing is the bottleneck. Bring your own keys — no backend, no account, no telemetry.

[![Download](https://img.shields.io/github/v/release/CharlesGuooo/V2A-Windows?label=download&style=for-the-badge)](https://github.com/CharlesGuooo/V2A-Windows/releases/latest)
[![License](https://img.shields.io/badge/license-MIT-blue?style=for-the-badge)](LICENSE)

<img src="docs/screenshot-dark.png" width="420" alt="V2A main window">

</div>

---

## Why

Talking to an AI agent, you can usually say more than you can type. But pasting a raw
transcript is miserable — it's full of "um", "you know", and mid-sentence corrections.

V2A closes that gap: **after transcription, an AI rewrites it by rules you control.**
The screenshot above is a real example — the speaker changed their mind halfway
("change the login flow first — no wait, do the data migration first"), and Deep cleanup
silently resolved it into the correct order.

---

## Install

### Option 1 — Installer (recommended)

Grab `V2A-Setup-x.y.z.exe` (~23 MB) from
[**Releases**](https://github.com/CharlesGuooo/V2A-Windows/releases/latest) and double-click it.
**No admin rights, no UAC prompt** — it installs to `%LOCALAPPDATA%\Programs\V2A`.
The Node runtime is bundled, so **there is nothing else to install**.

Uninstall from Add or remove programs. It asks whether to also delete your API keys and
history (it keeps them by default).

### Option 2 — Portable

Grab `V2A-x.y.z-portable.zip` (~32 MB), unzip anywhere, run `V2A.vbs` inside.
No registry writes, no uninstall entry — deleting the folder *is* uninstalling.

### Option 3 — From source

Needs [Node.js](https://nodejs.org) 18+ (LTS is fine).

```bash
git clone https://github.com/CharlesGuooo/V2A-Windows
cd V2A-Windows
```

Then double-click `V2A.vbs`. On first run it compiles a small tray helper using the C#
compiler already on every Windows machine — the source is `scripts/V2ATray.cs`, so read it
first if you like.

> Something wrong? Launch with `V2A-调试模式.bat` to keep a console open with live logs.
> Either way, logs land in `%APPDATA%\V2A\v2a.log`.

---

## ⚠️ Windows and your antivirus will complain

**Not a bug — this is what unsigned software gets.** A code-signing certificate runs
$200–400/year and now requires a hardware token, which is hard to justify for a free tool.

**SmartScreen**: a blue "Windows protected your PC" screen. Click **More info** →
**Run anyway**. It stops appearing once a release has enough downloads.

**Antivirus**: the tray helper registers global hotkeys, opens the microphone, and talks to
the network. That combination looks a lot like spyware to behavioural detection, and some
products (McAfee, in testing) will block or delete it. If that happens, add `%APPDATA%\V2A`
and the install directory to your antivirus exclusions.

**Don't want to take my word for it:**

- Every release ships `SHA256SUMS.txt` so you can verify what you downloaded:
  ```powershell
  Get-FileHash .\V2A-Setup-1.0.3.exe -Algorithm SHA256
  ```
- **The tray helper's full source ships inside the package** (`scripts\V2ATray.cs`).
  Read it, and rebuild it yourself with `csc.exe` if you want.
- Zero third-party dependencies. No `node_modules`, nothing you can't audit.

---

## Setup: two API keys

First launch walks you through five steps. Both keys are free to obtain:

| Key | What it does | Where |
|---|---|---|
| **Soniox** | Real-time speech → text | [console.soniox.com](https://console.soniox.com/) |
| **An AI provider** (pick one) | Cleans up the transcript | see below |

| Provider | Notes |
|---|---|
| **Deepseek** (default) | Direct. Free credit on signup, strong with Chinese — good first choice |
| **GPT-OSS 120B** | Via OpenRouter, pinned to Cerebras — blazing fast |
| **GLM 4.7** | Via OpenRouter, pinned to Cerebras — fast and solid |

GPT-OSS and GLM **share one OpenRouter key**, so you only paste it once.

Keys are encrypted at rest with **Windows Data Protection (DPAPI)** — only your Windows
account can decrypt them. Switch providers any time; each key is stored separately.

---

## Hotkeys

**Global** — they work from any window, and **they keep working after you close the V2A
window** (it stays in the notification area). All rebindable in Settings.

| Shortcut | Action |
|---|---|
| `Ctrl+Shift+R` | Start / stop recording |
| `Ctrl+Shift+Q` | Quick cleanup |
| `Ctrl+Shift+D` | Deep cleanup |
| `Ctrl+Shift+X` | Copy the cleaned text |
| `Ctrl+Shift+Backspace` | Clear everything |

While recording, a small bar appears in the bottom-right (record dot, elapsed time, level
meter). **It never takes focus**, so the caret stays wherever you were typing. Cleanup
finished, copied, nothing to clean up — all reported the same unobtrusive way.

> A global hotkey takes that combination away from every other application, so if one
> clashes with something you use, rebind it in Settings. If another program already owns a
> combination, the tray tells you which one failed to register.

**Closing the window is not quitting.** Double-click the tray icon to bring it back,
right-click to quit for good. Settings also has "Start with Windows" (~90 MB resident).

---

## Two cleanup styles

| | What it does | When |
|---|---|---|
| **Quick** | Strips fillers, fixes punctuation, light polish — your wording mostly survives | You spoke clearly and just want the "um"s gone |
| **Deep** | Resolves self-corrections to final intent, turns spoken lists into bullets, merges later additions back into the right point | You rambled or thought out loud |

You can also write **two custom prompts** (Settings → Cleanup Style) and reach them by
**right-clicking** a cleanup button. You can even dictate the custom prompt itself.

The built-in prompts are visible in the app, and live in [`web/prompts.js`](web/prompts.js).

---

## Privacy

No backend, no account, no analytics, no ads.

- API keys are DPAPI-encrypted on your machine. We never see them and never upload them.
- Audio goes to Soniox with **your** Soniox key; cleanup goes to your provider with **your**
  provider key. **Nothing routes through any server of ours.**
- Hotwords, custom styles and transcript history (last 20) stay in `%APPDATA%\V2A`.
- Uninstalling asks before deleting any of it.

---

## Troubleshooting

**Nothing happens on double-click / it says Node.js is missing**
The installer bundles Node, so this only affects running from source — install
[Node.js LTS](https://nodejs.org) and reboot so `PATH` updates.

**A hotkey does nothing**
Something else probably owns it (IMEs, screen recorders and screenshot tools are common
culprits). The tray shows a balloon naming any combination that failed to register.
Rebind it in Settings → Global hotkeys.

**Recording starts but nothing is transcribed**
Check the level meter on the floating bar. If it never moves, Windows is sending silence —
check Settings → Privacy & security → Microphone, and that the right input device is
selected in the Windows sound settings.

**I can't find the tray icon**
Windows hides infrequently-used tray icons behind the small arrow in the corner. Drag V2A
out of that overflow to pin it to the taskbar.

**"Out of balance" or "invalid key"**
The in-app error links straight to that provider's top-up or key page.

**Remove every trace**
Delete `%APPDATA%\V2A` (keys, settings, history, logs).

---

## Development

Zero third-party dependencies, no build step — edit and run.

```
V2A.vbs                    launcher (UTF-16LE — don't let an editor save it as UTF-8)
server.js                  static server, settings, DPAPI, AI proxy, session state, SSE
scripts/V2ATray.cs         tray, hotkeys, mic capture, Soniox, overlays
scripts/build-release.mjs  release packaging
installer/V2A.iss          Inno Setup wizard
web/
  theme.css                design tokens (colours copied from the iOS asset catalog)
  state.js                 port of AppState.swift, now a view model over the server
  main-screen.js           ContentView.swift + TranscriptPaneView.swift
  settings.js              settings, prompt manager, history, FAQ, about, languages
  onboarding.js            OnboardingFlow.swift
  soniox.js                SonioxClient.swift (browser fallback path)
  recorder.js              MicRecorder.swift (browser fallback path)
  errors.js                FailureClassifier from AppError.swift
  prompts.js               PromptDefaults.swift, prompt text verbatim
  i18n.js                  Localizable.xcstrings
```

Build a release (needs `winget install JRSoftware.InnoSetup` once):

```bash
node scripts/build-release.mjs
```

Artefacts land in `dist/`: installer, portable zip, SHA256 list.

### Design notes

- **Capture and session state are native, not in the page.** The window is a view; closing
  it doesn't stop a recording. Keeping the browser alive just to hold the recorder would
  have cost ~600 MB resident instead of ~90 MB.
- **The page is served from `http://127.0.0.1`**, a secure context, so the browser fallback
  path can still use `getUserMedia` and `AudioWorklet` when needed.
- **Soniox is a direct WebSocket** — no CORS, and audio never passes through a middleman.
- **AI requests are proxied by the local server** so provider keys never enter the page and
  streaming tokens come back over SSE.
- **The tray is a compiled binary rather than a PowerShell script.** A `.ps1` that registers
  global hotkeys and talks to the network is indistinguishable from a keylogger to a script
  scanner — in testing it got quarantined outright.

---

## Credits

A Windows port of [**CharlesGuooo/V2A**](https://github.com/CharlesGuooo/V2A), a pure
SwiftUI iOS app. The interface design, colour tokens, prompt text and copy all come from
there, ported item by item. If you want this on an iPhone, go to that repo.

## License

MIT — see [LICENSE](LICENSE).
