# Privacy

Short version: **your media never leaves your machine.** Transcription, editing
and export all run locally. A few optional features do talk to the internet, and
this page lists every one of them so you can decide.

---

## What runs entirely offline

| | |
|---|---|
| Speech recognition | whisper.cpp on your CPU/GPU. Your audio is never uploaded. |
| Subtitle editing, splitting, timing | local |
| Spelling & punctuation pass | local, rule-based — no AI, no network |
| Filler removal, profanity filter, custom dictionary | local |
| Silence detection and cutting, audio cleanup | local ffmpeg |
| Export: SRT, VTT, ASS, TXT, burn-in video | local ffmpeg |
| Sending captions to the Premiere timeline | local |

You can pull the network cable out and everything above still works, once the
speech model has been downloaded.

---

## What reaches the internet

All of these are **off unless you turn them on**, and the AI ones need an API
key that you supply yourself.

### 1. Speech model download — once, no account

On the first transcription the chosen model (75 MB – 1.5 GB) is downloaded from
Hugging Face and cached locally. No data about you is sent. After this, no
further download is needed.

- Host: `huggingface.co`
- Cached in: `~/Library/Application Support/Subsper/models` (macOS),
  `%APPDATA%\Subsper\models` (Windows)

### 2. AI features — your transcript is sent to the provider you pick

**This is the one to read carefully.** These features send your **subtitle
text** (not your audio, not your video) to a third-party AI provider:

| Feature | What is sent |
|---|---|
| Grammar / spelling fix (AI) | the transcript lines |
| Translate | the transcript lines |
| Tags / SEO, chapters, viral-clip picks | the transcript |

You choose the provider and paste your own API key: Google Gemini, OpenAI,
Anthropic, or any OpenAI-compatible endpoint. Your key is stored locally in the
app's settings and is sent only to that provider. Billing is between you and
them, and **their** terms govern what they do with the text — check whether your
plan allows training on submitted data.

If you never open these features, nothing is sent.

The offline **Spelling & Punctuation** pass exists precisely so the common case
does not need any of this.

### 3. Stock B-roll (optional)

If you enable stock footage, a search query is sent to Pexels with your own
Pexels API key. Your transcript is not uploaded; only the search words.

### 4. Update check

On start the app asks the release endpoint whether a newer version exists. This
is a plain GET; it sends no identifiers beyond what any HTTP request carries
(your IP and user agent). It fails silently when you are offline.

To turn it off, remove the `checkForUpdates()` call in `js/main.js`, or block
the host at your firewall.

### 5. Licence activation

When you enter a licence key it is sent to the payment provider for validation,
along with a hashed device identifier so the key can be tied to your device
allowance. No transcript or media is included.

### 6. Optional Pro speaker labelling

Speaker diarization uses WhisperX and pyannote, which you install yourself.
Downloading the diarization model requires a free Hugging Face token. The audio
is processed locally; the token is used only to fetch the model.

---

## What is never collected

- No analytics, no telemetry, no crash reporting
- No account, no sign-up
- No media upload, ever
- Nothing is sent when you export

The "Report a problem" button opens a **pre-filled issue in your browser** with
the app version, your OS and the last few engine log lines. You see it and can
edit or cancel it before anything is submitted.

---

## Where your data lives

| What | Where |
|---|---|
| Settings, API keys | browser local storage in the app's own profile |
| Speech models | `Subsper/models` in your user application-data folder |
| Projects (`.subsper`) | wherever you save them |
| Engine log | your temp folder |
| Temporary audio | your temp folder, deleted after each run |

To wipe everything: delete the app, the `Subsper` folder in your application
data, and — for the Premiere extension — the `com.whisper.studio` folder in the
Adobe CEP extensions directory.

---

*Questions: ▶ support@example.com*
