# Subsper

By **zipheron**. Local AI subtitles, audio cleanup & silence cutting.

**Your media never leaves your machine.** Transcription, editing and export all
run on your own hardware. A handful of *optional* extras — AI grammar and
translation, stock B-roll, the update check — do use the network, and
[PRIVACY.md](PRIVACY.md) lists every one of them. The old "100% offline" claim
was not quite true once those features existed, so it is stated properly now.

Licensing: [LICENSE](LICENSE) · third-party components:
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)

This repo holds **two apps that share the same engine**:

| App | For | Where |
|-----|-----|-------|
| **Desktop** (this folder) | CapCut / any editor — no Premiere needed. Windows + macOS. | [Releases](../../releases) → `.exe` / `.dmg` |
| **Premiere extension** | Adobe Premiere Pro users | [Releases](../../releases) → `Subsper-Premiere-*.zxp` |

> **Download links depend on this repo being reachable.** They point at its
> Releases page, and so do the in-app update check and `electron-updater`. If
> the repo is private, all three go dead at once — silently, in the case of the
> update check. Selling from your own site or Gumroad instead means editing
> `DIST` in `js/main.js` and the `publish` block in `package.json`; nothing else
> hard-codes a URL.

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
No Premiere needed. Runs on **Windows** and macOS. Transcription and editing are
fully offline — see [PRIVACY.md](PRIVACY.md) for the optional online extras.

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

Releases must be **signed** — an unsigned build greets every buyer with
"Subsper is damaged" on macOS or a SmartScreen block on Windows. The tag build
now refuses to publish without the certificates. See
[docs/SIGNING.md](docs/SIGNING.md) for what to buy and which secrets to set.

### Build locally instead (optional)
```
npm install
npm run dist:win    # on Windows → dist/Subsper-Setup-x.x.x.exe
npm run dist:mac    # on macOS  → dist/*.dmg
npm start           # run from source
```

The bundled `ffmpeg` is built from source as **plain LGPL**
(`scripts/build-ffmpeg-lgpl.sh`), because the `ffmpeg-static` package it used to
come from is configured `--enable-nonfree` and may not be redistributed at all.
The build fails on purpose if a GPL or non-free component ever creeps back in.

### Tests
```
dev/test/run.sh                       # unit suite (node, or JavaScriptCore if node is absent)
dev/test/check-mirror.sh              # desktop and extension copies must stay identical
dev/test/ffmpeg-smoke.sh              # the bundled ffmpeg can do what the app asks
dev/test/dom-harness.sh               # segment-list clicks, in a real browser
python3 dev/test/ui-audit.py          # dead buttons, untranslated strings, empty tool pages
python3 dev/test/settings-audit.py    # settings nothing reads, settings nothing can change
node dev/v2-harness.js                # feature gating, desktop vs extension
```

The panel is not a window — people dock it into whatever gap they have. To see
the layout at the sizes that actually happen:

```
python3 dev/test/build-panel-sizes.py /tmp/sizes && open /tmp/sizes/panel-sizes.html
```

Each size renders in its own iframe, because media queries measure the viewport
and inside CEP the panel *is* the viewport — a fixed-size `<div>` would never
trigger them and would report every size as fine.

CI runs the suite, both audits, the DOM harness and the ffmpeg smoke test on
every push and pull request. The packaging jobs do not start until they pass.

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
