# Subsper

By **zipheron**. Local AI subtitles, audio cleanup & silence cutting. 100% offline & free.

This repo holds **two apps that share the same engine**:

| App | For | Where |
|-----|-----|-------|
| **Desktop** (this folder) | CapCut / any editor — no Premiere needed. Windows + macOS. | [Releases](../../releases) → `.exe` / `.dmg` |
| **Premiere extension** | Adobe Premiere Pro users | [Releases](../../releases) → `Subsper-Premiere-*.zxp` |

The Premiere extension reuses the Desktop app's bundled engine, so **installing the
Desktop app makes both work** — no Python, no terminal.

### Installing the Premiere extension (.zxp)

1. Download `Subsper-Premiere-x.x.x.zxp` from **[Releases](../../releases)**.
2. Install it with a ZXP installer — either
   [aescripts ZXP Installer](https://aescripts.com/learn/zxp-installer/) or
   [Anastasiy's Extension Manager](https://install.anastasiy.com/) (both free):
   open the app, drag the `.zxp` in, done.
3. Restart Premiere → **Window → Extensions → Subsper**.

(Developers can still clone [`extension/`](extension/) into the CEP extensions
folder with PlayerDebugMode — see [extension/README.md](extension/README.md).)

---

## Subsper — Desktop

Local AI subtitles, audio cleanup & silence cutting for **CapCut** (or any editor).
No Premiere needed. Runs on **Windows** and macOS. 100% offline & free.

---

## ⬇️ For users — install the app (zero setup)

**No Python. No ffmpeg. No terminal.** The AI engine (whisper.cpp + ffmpeg) is
bundled inside the app. The only one-time step is a model download on first use.

### Windows
1. Go to the **[Releases](../../releases)** page and download the latest
   `Subsper-Setup-x.x.x.exe`.
2. Run it (Windows SmartScreen may warn because the app isn't code-signed yet →
   *More info → Run anyway*). Install.
3. Open a video → **Transcribe**. On the **first** run it downloads the speech
   model once (cached in `%APPDATA%\Subsper\models`); after that it's instant & offline.

### macOS (Apple Silicon — M1/M2/M3/M4)
Download `Subsper-x.x.x-mac-arm64.dmg` from **Releases**, drag to Applications, open it.
(Intel Macs are not supported since v1.8.0 — the last Intel build is
[v1.7.1](../../releases/tag/v1).)

> **⚠️ First launch on macOS:** the app is ad-hoc signed (not notarized), so
> Gatekeeper warns once. **Right-click the app → Open → Open** (or allow it under
> System Settings → Privacy & Security). If you ever see "damaged", run:
> `xattr -cr /Applications/Subsper.app`

> **Optional — Pro engine:** for speaker labels (diarization) install Python +
> WhisperX and pick it in Settings. Everyone else needs nothing.

---

## 🛠 For the maintainer — build & publish

The Windows `.exe` is **built automatically in the cloud by GitHub Actions** — you
don't need a Windows PC.

1. Push this folder to a GitHub repo (see below).
2. Every push to `main` builds the installer and uploads it as an **artifact**
   (Actions tab → latest run → Artifacts).
3. To publish a downloadable **Release** your friend can grab:
   ```
   git tag v1.0.0
   git push origin v1.0.0
   ```
   GitHub Actions builds and attaches `Subsper-Setup-1.0.0.exe` to a Release.

### First-time push
```
cd WhisperStudioDesktop
git init
git add .
git commit -m "Subsper Desktop"
gh repo create subsper --public --source=. --push
```

### Build locally instead (optional)
```
npm install
npm run dist:win    # on Windows → dist/Subsper-Setup-x.x.x.exe
npm run dist:mac    # on macOS  → dist/*.dmg
npm start           # run from source
```

---

## Usage
1. **Open Video / Audio File** (or drag-and-drop onto the window — drop 2+ files for batch mode)
2. Pick model + language → **Transcribe File**
3. Edit segments (click a word to split, double-click to edit, 🧹 to clean up,
   **Cmd/Ctrl+Z** = undo, **Alt+←/→** = nudge timing, drag segment edges on the waveform)
4. **⬇ Export** → SRT / VTT / ASS / word-by-word SRT / **burn-in MP4** — or save the
   session as a **`.subsper` project** and continue later
5. Bonus tools: **🔊 Audio → Enhance / Beep Profanity** · **✂️ Edit → Cut Silences /
   Cut Filler Words** — each exports a processed copy of your file

### Command line (headless)
```bash
npm run cli -- video.mp4                     # → video.srt next to the file
npm run cli -- *.mp4 --model small --lang tr # batch, smaller model, forced language
```
Uses the same bundled engine — no Python, no UI. Great for automation.

## How it's built
Same UI/logic as the Premiere extension. `desktop-shim.js` stubs the Premiere
(CEP) APIs so `main.js` loads unchanged; `desktop-app.js` overrides the I/O
boundary (file pickers, media playback, exports) and hides Premiere-only tools.
The Python scripts in `scripts/` are shared and run via Node `spawn`.
