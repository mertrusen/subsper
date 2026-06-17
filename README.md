# Subsper

By **zipheron**. Local AI subtitles, audio cleanup & silence cutting. 100% offline & free.

This repo holds **two apps that share the same engine**:

| App | For | Where |
|-----|-----|-------|
| **Desktop** (this folder) | CapCut / any editor — no Premiere needed. Windows + macOS. | [Releases](../../releases) → `.exe` / `.dmg` |
| **Premiere extension** | Adobe Premiere Pro users | [`extension/`](extension/) — see [extension/README.md](extension/README.md) |

The Premiere extension reuses the Desktop app's bundled engine, so **installing the
Desktop app makes both work** — no Python, no terminal.

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

### macOS (Apple Silicon & Intel)
Download `Subsper-x.x.x-mac.dmg` from **Releases**, drag to Applications, open it.

> **⚠️ "App is damaged and can't be opened" error?**
> macOS Gatekeeper shows this for unsigned apps. To fix it, open Terminal and run:
> `xattr -cr /Applications/Subsper.app`
> Then you can open the app normally.

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
1. **Open Video / Audio File** (or drag-and-drop onto the window)
2. Pick model + language → **Transcribe File**
3. Edit segments (click a word to split, double-click to edit, 🧹 to clean up)
4. **⬇ Export → SRT** → import into CapCut
5. Bonus: **🔊 Audio → Enhance** and **✂️ Edit → Cut Silences** export cleaned/trimmed files

## How it's built
Same UI/logic as the Premiere extension. `desktop-shim.js` stubs the Premiere
(CEP) APIs so `main.js` loads unchanged; `desktop-app.js` overrides the I/O
boundary (file pickers, media playback, exports) and hides Premiere-only tools.
The Python scripts in `scripts/` are shared and run via Node `spawn`.
