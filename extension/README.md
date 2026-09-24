# Subsper for Adobe Premiere Pro

This folder contains the Premiere CEP extension from the [Subsper repository](../README.md). It shares the subtitle engine and most of its interface with Subsper Desktop. The extension reads an active sequence, creates editable subtitle segments, and can send captions back to the timeline.

The [current preview release](https://github.com/mertrusen/subsper/releases/tag/preview-1.4.0-preview.1) includes a timestamped, self-signed `.zxp`. It does not include a new desktop installer. Transcription needs local `whisper-cli` and `ffmpeg` binaries; the speech model downloads once on first use.

The `main` branch can be ahead of this package. Use the source setup below for the latest editor changes until a newer `.zxp` is released.

## Install the packaged extension

1. Download `Subsper-Premiere-1.4.0-preview.1.zxp` from [Releases](https://github.com/mertrusen/subsper/releases).
2. Install it with a ZXP installer that supports sideloading self-signed CEP extensions. Restart Premiere.
3. Open **Window → Extensions → Subsper**. If the panel reports a missing engine, install compatible `whisper-cli` and `ffmpeg` commands on your system path or use the source setup below.

Normal local transcription does not require Python. Optional WhisperX speaker labelling needs a separate Python environment and model access. Online text features use your configured provider and are detailed in [Privacy](../PRIVACY.md).

## Use the panel

1. Select the Premiere sequence you want to work on. Set In/Out first if you only want part of it transcribed.
2. In **Subtitles**, choose a model and language in transcription settings, then transcribe. Review text and timing before sending anything to the timeline.
3. In **Subtitles → Settings**, choose the spoken language and the source track if automatic audio selection picks music or another sound. Auto tries video sound first; use A1/A2 for a separate microphone. Choose the optional line-preview font from the list and set its point size, weight, and caption-box width. Possible third lines are highlighted as an estimate. Click a word to split, use **↑** or drag a caption number onto a neighbor to merge, and use **Cmd/Ctrl+Z** to undo. Preview warnings never block sending; check the final wrapping in Premiere.
4. In **Export**, save SRT/VTT/TXT or choose **Send captions to Premiere**. The extension creates a new caption track and leaves previous tracks intact. A new track uses Premiere's default subtitle font; apply your saved Track Style to it in Premiere. CEP does not provide an API to copy that saved style automatically. If automatic placement is unavailable, the panel saves an SRT for manual import.
5. In **Tools**, use sequence editing and audio actions as needed. Some actions alter clips or timing; save your Premiere project and review the result. Desktop-specific style and burn-in controls are not shown in the Premiere panel.

For CapCut, export **SRT** and style inside CapCut, or import a video with the captions already burned in. CapCut's documented import does not list ASS. See the [format guide](../README.md#which-export-should-i-choose).

## Develop from source

The repository root owns shared files. Do not edit mirrored `extension/js/` and `extension/css/` files independently; run `bash scripts/sync-to-extension.sh` from the root after a shared UI or engine change.

For local CEP development, place or link this folder at:

| Platform | CEP folder |
| --- | --- |
| macOS | `~/Library/Application Support/Adobe/CEP/extensions/com.whisper.studio` |
| Windows | `%APPDATA%\Adobe\CEP\extensions\com.whisper.studio` |

Developer-mode sideloading may require `PlayerDebugMode=1` for the CSXS version used by your Premiere installation. Restart Premiere after changing the CEP folder or debug setting. The manifest is in [CSXS/manifest.xml](CSXS/manifest.xml).

The extension searches for binaries in its own `bin/<platform>/` directory, an installed Subsper Desktop app, then system locations or `PATH`. In a source checkout, `npm run prep` at the repository root prepares `bin/<platform>/`; link that directory into `extension/bin` for local development if needed. Do not commit binaries or a private signing certificate. See [scripts/fetch-binaries.mjs](../scripts/fetch-binaries.mjs) and [docs/SIGNING.md](../docs/SIGNING.md).

Run `bash dev/test/check-mirror.sh` from the root before packaging. A real Premiere project test is still needed for sequence-specific behavior.
