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

> **⚠️ macOS 26 (Tahoe) and unsigned builds:** on Tahoe an ad-hoc-signed build
> is refused outright — you get **"Malware Blocked"**, and right-click → Open no
> longer helps. Use a **signed & notarized** release (see
> [RELEASING.md](RELEASING.md)); those install with no warning at all. Builds
> made with `npm run dist:mac` are unsigned and for development only.

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

The home screen is a grid of tools grouped by job — Subtitles, Editing, Audio,
Content. Pick one and you get that tool alone, with its settings folded under it.
**Esc** goes back; the last tool you used sits at the top for one-tap return.

1. **Open Video / Audio File** (or drag-and-drop onto the window — drop 2+ files for batch mode)
2. Pick model + language → **Transcribe File**
3. Edit segments (click a word to split, double-click to edit, 🧹 to clean up,
   **Cmd/Ctrl+Z** = undo, **Alt+←/→** = nudge timing). On the waveform strip you can
   drag a segment to move it, drag its edges to retime it (they never overlap),
   scroll ↕ to zoom, ↔ to pan, and drag the triangle playhead to scrub.
4. **Style** the captions: 16-preset gallery, per-speaker colours, a mock-up in
   your video's aspect ratio where you drag the subtitle into place, X/Y and
   max-width sliders, and your own `.ttf`/`.otf` fonts — the live preview on the
   video matches what gets burned in.
5. **⬇ Export** → SRT / VTT / ASS / word-by-word SRT / **burn-in MP4** / 9:16
   vertical clip — or save the session as a **`.subsper` project**.
6. More tools: **Cut Silences · Remove Repeats · Cut Filler Words · Enhance Audio ·
   Beep Profanity · Chapters · Viral Clips · Speech Pace · Social Pack · B-Roll**.
   Every smart tool works with no API key (on-device heuristics) and simply gets
   sharper if you add one.

The Premiere extension adds the timeline-only tools on top: Auto Zoom, Podcast
Multicam, Cut by Markers, Vertical Resize, Music Ducking and batch transcribe
across sequences.

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
