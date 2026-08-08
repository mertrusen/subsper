# Third-party notices

Subsper ships and uses the components below. Their licences are reproduced or
linked here as those licences require. Nothing in this file changes the terms
under which Subsper itself is licensed — see [LICENSE](LICENSE).

---

## FFmpeg — LGPL v2.1 or later

Subsper bundles an **ffmpeg** executable and invokes it as a separate process.

The bundled build is **plain LGPL**. It is configured *without*
`--enable-gpl`, `--enable-version3` and `--enable-nonfree`, and without any
GPL-licensed external library (no libx264, libx265, libvpx, libaom …).
`scripts/build-ffmpeg-lgpl.sh` fails the build if any of those ever reappear.

Video re-encoding therefore uses the operating system's own encoder —
VideoToolbox on macOS, Media Foundation on Windows — not libx264.

- Upstream source: <https://ffmpeg.org/releases/> (version pinned in
  `scripts/build-ffmpeg-lgpl.sh`)
- Licence: <https://www.ffmpeg.org/legal.html>
- Full text: LGPL v2.1 — <https://www.gnu.org/licenses/old-licenses/lgpl-2.1.html>

**Written offer of source.** The bundled ffmpeg is unmodified upstream source
built with the flags recorded in `scripts/build-ffmpeg-lgpl.sh`. You can
reproduce it exactly by running that script, and you can obtain the complete
corresponding source from the release URL above. On request we will also
provide it directly at the address in [LICENSE](LICENSE).

> Historical note, kept deliberately: releases up to and including v1.3.0
> bundled the `ffmpeg-static` npm binary, which on macOS is an evermeet.cx
> build configured with `--enable-gpl --enable-version3 --enable-nonfree`.
> A binary built with `--enable-nonfree` may not be redistributed at all.
> Those releases must not be distributed further.

---

## whisper.cpp — MIT

The speech-recognition engine (`whisper-cli`), built from source and bundled.

- Source: <https://github.com/ggml-org/whisper.cpp>
- Licence: MIT

```
Copyright (c) 2023-2024 The ggml authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

`ggml` is vendored inside whisper.cpp and carries the same MIT licence.

---

## Whisper speech models — MIT

Downloaded on first use, not bundled in the installer.

- Weights: OpenAI Whisper, MIT — <https://github.com/openai/whisper>
- GGML conversions: <https://huggingface.co/ggerganov/whisper.cpp>

---

## Electron, Node.js, Chromium — desktop app only

- Electron — MIT — <https://github.com/electron/electron>
- Node.js — MIT
- Chromium — BSD-3-Clause and others — <https://chromium.googlesource.com/chromium/src/+/main/LICENSE>

## npm dependencies — desktop app only

| Package | Licence |
|---|---|
| `electron-updater` | MIT |
| `diff` | BSD-3-Clause |

---

## Adobe CEP — Premiere extension only

`extension/js/CSInterface.js` is distributed by Adobe as part of the CEP
resources and is used under Adobe's terms.

- Source: <https://github.com/Adobe-CEP/CEP-Resources>

`ZXPSignCmd`, used at build time to sign the `.zxp`, is likewise Adobe's and is
not redistributed with the product.

---

## Optional online services

These are **off by default**. Subsper's transcription and editing run entirely
offline; the features below only reach the network when the user explicitly
enables them and supplies their own API key. See [PRIVACY.md](PRIVACY.md).

| Service | Used for | Key |
|---|---|---|
| Google Gemini / OpenAI / Anthropic | AI grammar, translation, tags, chapters | user's own |
| Pexels | optional stock B-roll | user's own |
| Hugging Face | one-time speech-model download | none |
| GitHub | update check | none |

Optional Pro speaker labelling uses **WhisperX** (BSD-4-Clause) and
**pyannote.audio** (MIT), which the user installs themselves. Neither is
bundled.
