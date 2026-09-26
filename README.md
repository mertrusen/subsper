# Subsper

[Türkçe kullanım kılavuzu](README.tr.md)

Subsper turns speech into editable subtitles. This repository contains a standalone desktop app and an Adobe Premiere Pro extension. Transcription, editing, and export run on your computer; optional online features are explained in [Privacy](PRIVACY.md).

| Product | Use it for | Current distribution |
| --- | --- | --- |
| Desktop | Transcribe video/audio files, edit and style captions, export subtitle files or a video with subtitles burned in. | Windows x64 `.exe` and Apple Silicon macOS `.dmg` in [Releases](https://github.com/mertrusen/subsper/releases). |
| Premiere extension | Transcribe an active sequence or In/Out range and send captions to the timeline. | `.zxp` package on [Releases](https://github.com/mertrusen/subsper/releases). |

**Release status:** [Subsper 1.5.3 Preview 1](https://github.com/mertrusen/subsper/releases/tag/v1.5.3-preview.1) contains Windows x64 and Apple Silicon macOS desktop installers plus the Premiere `.zxp`. The desktop installers are unsigned preview builds; signed final releases require the setup in [docs/SIGNING.md](docs/SIGNING.md). The older `v1.3` installers contain the old interface.

The source and preview packages use version 1.5.3-preview.1.

The `main` branch may include editor changes newer than that packaged preview. Build or link the extension from source to try those changes before the next release.

## Features

- **Subtitles:** local whisper.cpp transcription, SRT import, editable text and timing, and a waveform on desktop.
- **Style:** presets or custom font, size, colour, position, and width. Bundled Inter, Montserrat, Oswald, and Bebas Neue fonts carry SIL Open Font Licences. Fade, pop, and bounce effects are available for ASS and burned-in video.
- **Export:** SRT, VTT, ASS, TXT, burned-in MP4, and a vertical 9:16 video option on desktop. A `.subsper` project saves captions and settings; keep the original media file too.
- **More tools:** silence cutting, repeat and filler detection, audio enhancement, profanity censoring, chapters, clip suggestions, and related actions live under **Tools**. Premiere adds timeline-specific actions such as Auto Zoom, Multicam, marker cuts, vertical resize, and music ducking. Review output from tools that alter media or a sequence.

Normal transcription uses a local model. The first use downloads it once; later use can be offline. Optional translation, grammar, and content features can send subtitle **text** to the provider whose API key you configure. Stock-footage search and update checks also use the network. See [Privacy](PRIVACY.md).

## Desktop: install and use

Download the installer for your platform from [Preview 1](https://github.com/mertrusen/subsper/releases/tag/v1.5.3-preview.1): `Subsper-Setup-1.5.3-preview.1.exe` for Windows x64 or `Subsper-1.5.3-preview.1-mac-arm64.dmg` for Apple Silicon macOS. These preview installers are unsigned. To run from source instead, install Node.js, Git, CMake, and a C/C++ build toolchain. The macOS FFmpeg build also needs `pkg-config`; on Windows, the default GPU engine build needs the Vulkan SDK (or set `SKIP_WHISPER_GPU=1` for a CPU-only development build). Native engine preparation builds or downloads whisper.cpp and an LGPL FFmpeg binary and can take time and disk space.

```bash
git clone https://github.com/mertrusen/subsper.git
cd subsper
npm install
npm run prep
npm start
```

1. Click **Open Video / Audio File**, or drop one file into the window. Dropping two or more media files starts batch transcription.
2. Use the transcription-settings control beside the Subtitles title to change model or spoken language, then click **Transcribe File**. On first use the model downloads to your application-data folder. You can instead load an existing `.srt`.
3. Edit the subtitle list: double-click text to change it, click a word to split, or use **↑** to merge with the preceding caption. You can also drag a caption number onto an adjacent caption to merge. A subtitle's jump control seeks to its time; a paused video stays paused. **Space** plays or pauses, **Cmd/Ctrl+Z** undoes an edit, and **Alt+Left/Right** nudges the selected subtitle start by 0.1 s. Add **Shift** to nudge its end.
4. On the waveform, click to seek or drag the playhead. The wheel zooms around the pointer; drag the strip or use **Shift+wheel** to pan. **+**, **−**, and **Fit** control zoom. During playback, the view follows the playhead.
5. In **Style**, choose a preset, font, position, and animation. Check the rendered result before publishing.
6. In **Export**, choose a subtitle file, video output, or **Save project**. A `.subsper` project stores a reference to the media, not a copy of it.

### Which export should I choose?

| Output | Style support | Use |
| --- | --- | --- |
| **SRT** | Font and animation are not reliably preserved. | Editable text and timing for CapCut, Premiere, and other editors; style it there. |
| **VTT** | Subsper does not include its visual style. | Web captions. |
| **ASS** | Font, colour, position, karaoke, and supported animation. | ASS-capable players/renderers; the selected font must be available to the renderer. |
| **Burned-in MP4** | Appearance is rendered into the video. | Keep the same look everywhere; captions are no longer separately editable. |
| **TXT** | No timing or style. | Plain transcript. |

**CapCut:** import SRT for editable captions, then choose a font and animation inside CapCut. Its [documented subtitle import](https://www.capcut.com/help/how-to-import-subtitles) covers SRT/TXT, not ASS. To keep the exact Subsper look, import a video with subtitles already burned in.

### Command line

After preparing the engine, the CLI writes an SRT next to each input file:

```bash
npm run cli -- video.mp4
npm run cli -- video1.mp4 video2.mp4 --model small --lang tr
npm run cli -- --help
```

The CLI uses the local model cache and native engine. It exports plain SRT, without the app's visual style.

## Premiere: install and use

1. Download `Subsper-Premiere-1.5.3-preview.1.zxp` from the [current release](https://github.com/mertrusen/subsper/releases/tag/v1.5.3-preview.1). Install it with a ZXP installer and restart Premiere. This preview is self-signed and timestamped, so use your installer's sideload flow if needed.
2. Provide local `whisper-cli` and `ffmpeg` binaries through a compatible Desktop installation, your system path, or the source setup in [extension/README.md](extension/README.md). The speech model downloads on first use.
3. Open **Window → Extensions → Subsper**, select a sequence, and transcribe it. Set In/Out first to limit the range.
4. In **Subtitles → Settings**, choose the spoken language and, if needed, the audio track containing speech. Automatic source selection tries video sound first; select the correct A1/A2 track for a separate microphone. Toggle the line preview and choose its font, size, weight, tracking, and caption-box width (default example: Helvetica Bold 50). Only the word estimated to start a third line is marked red. You can opt into automatic splitting of new transcripts there or split existing captions with the settings button. Premiere may wrap differently. Click any word to split; use **↑** or drag a caption number onto an adjacent caption to merge. **Cmd/Ctrl+Z** undoes an edit. The preview never blocks sending.
5. Use **Export** to send editable captions to a **new** Premiere caption track or save SRT/VTT/TXT. The extension keeps existing tracks untouched. A new track uses Premiere's default subtitle font; the CEP scripting API cannot read and reapply a saved Track Style automatically, so apply that style to the new track in Premiere. Desktop-only font/animation controls are absent from the Premiere panel.

The extension shares UI and subtitle logic with Desktop. Only the extension runs Premiere sequence tools. See [extension/README.md](extension/README.md) for developer installation.

## Development, tests, and release

The repository root is the source of truth for shared code. After editing shared `js/`, `css/`, `index.html`, or font assets, refresh the Premiere copy:

```bash
bash scripts/sync-to-extension.sh
```

Run the relevant checks before committing:

```bash
bash dev/test/run.sh
bash dev/test/ffmpeg-smoke.sh
bash dev/test/check-mirror.sh
node dev/test/host-captions.test.js
node dev/v2-harness.js
python3 dev/test/ui-audit.py
python3 dev/test/settings-audit.py
```

`dev/test/dom-harness.sh` and `dev/test/page-isolation.sh` also test browser behavior when Chrome/Chromium is available. Unit tests do not replace a real Premiere sequence test or an installer test.

`npm run dist:win` runs on Windows and `npm run dist:mac` on macOS for local package experiments. These commands do not publish. A `v*` tag starts the release workflow, which requires signing secrets for native installers; see [docs/SIGNING.md](docs/SIGNING.md). Routine pushes do not package or upload large Actions artifacts.

The bundled FFmpeg build is kept LGPL-only and checked for GPL/non-free components. See [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) for component and font licences.

## Troubleshooting

- **Engine missing:** confirm `whisper-cli` and `ffmpeg` are available. Run `npm run prep` in a source checkout; see [extension setup](extension/README.md) for the Premiere path.
- **First transcription waits:** the model must download once. Check your connection and free disk space; later use reads the cache.
- **Font or animation disappears after SRT export:** use ASS or burn the subtitles into video when appearance matters.
- **Project opens without video:** `.subsper` stores a media path, not the media file. Restore or reopen the original file.
- **Premiere output differs from the preview:** native captions use Premiere's own styling; inspect the resulting timeline.
- **macOS blocks Electron or Subsper:** stop using that copy. `npm start` refuses to launch a local Electron bundle that fails macOS checks. Do not remove its quarantine or re-sign it to get around a malware/revocation alert; use a verified signed and notarized distribution.

Report problems in [GitHub Issues](https://github.com/mertrusen/subsper/issues). Include version, platform, reproduction steps, and output format. Do not post private media or API keys.

## Licence

See [LICENSE](LICENSE), [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md), and [PRIVACY.md](PRIVACY.md).
