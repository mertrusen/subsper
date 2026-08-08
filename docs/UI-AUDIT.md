# UI audit & information architecture

Input for the interface rewrite. Part one is what exists today and what is
wrong with it; part two proposes what to build instead.

Measured, not eyeballed — `dev/test/ui-audit.py` produces the mechanical
findings and runs in CI, so they stay fixed once fixed.

---

## 1 · What exists today

### Navigation — two systems stacked on each other

This is the structural problem everything else hangs off.

**System A — the card grid** (`ui-v2.js`). A home screen of 19 tool cards in 5
categories. Opening a card calls `ui2Open(key)`, which switches to the tool's
tab, then **hides every sibling element in that panel** so only the tool's own
controls show (`applyView`). A tool's settings are physically *moved* out of the
settings sub-panel into a collapsed box on the tool's page (`buildAdv`).

**System B — the tab bar** (`index.html`). Four main tabs (Subtitles · Edit ·
Audio · Setup), each with sub-tabs (Work / Settings). Eight panels total.

Both are live at once. System A hides the tab bar and drives System B by
calling `switchMainTab` / `switchSubTab` underneath. So there are two mental
models of "where am I", two sets of state to keep in sync, and any layout
change has to be reasoned about twice.

`buildAdv` moving DOM nodes is the sharp edge: a setting can only be in one
place at a time, so it is *either* on the tool page *or* in Settings, depending
on what you opened first.

| | |
|---|---|
| Panels | 8 (`panel-tx-work`, `-tx-settings`, `-ed-work`, `-ed-settings`, `-au-work`, `-au-settings`, `-su-main`, `-setup`) |
| Tool cards | 19 across 5 categories |
| Settings controls in HTML | 44 |
| Settings keys persisted | 49 |
| Overlays | AI panel, Find/Replace, Sync, Clean menu, Export menu, Onboarding |

### The 19 tools

| Category | Tool | Available in |
|---|---|---|
| Subtitles | Subtitles (transcribe + edit) | both |
| Subtitles | AI Tools | both |
| Editing | Cut Silences `beta` | both |
| Editing | Remove Repeats `new` | both |
| Editing | Cut Filler Words `beta` | both |
| Editing | Auto Zoom `beta` | **Premiere only** |
| Editing | Podcast Multicam `new` | **Premiere only** |
| Editing | Cut by Markers `new` | **Premiere only** |
| Editing | Vertical Resize `new` | **Premiere only** |
| Audio | Music Ducking `new` | **Premiere only** |
| Audio | Beep Profanity | both |
| Audio | Enhance Audio | both |
| Content | Chapters `new` | both |
| Content | Viral Clips `new` | both |
| Content | Speech Pace `new` | both |
| Content | Social Pack `new` | both |
| Content | B-Roll `new` | both |
| General | Settings | both |
| General | Help | both |

Eleven of nineteen carry a `new` or `beta` badge. Badges that never expire stop
meaning anything.

### Features that exist but are hard to find

Real functionality, buried:

- **Burn-in MP4 export** — desktop only, three levels deep in the Export
  dropdown. Arguably the single most valuable output, and the hardest to reach.
- **9:16 vertical clip** — same.
- **`.subsper` project save/load** — in the Export menu's "Project" group.
- **Word-by-word SRT / karaoke** — Export menu.
- **Bilingual SRT** *(new)* — only appears after running Translate.
- **Settings profiles** *(new)* — bottom of Settings.
- **Model manager** (list, delete, download) — Setup sub-tab.
- **Find & Replace** — an icon in the actions bar.
- **Timeline caption pull** (read captions already on the Premiere timeline) —
  a button on the Edit panel.
- **Batch transcribe** — a compact secondary row on desktop, a card in the
  extension.
- **Keyboard shortcuts** (`Cmd/Ctrl+Z`, `Alt+←/→`, `Space`) — mentioned once in
  onboarding, never again.

### Mechanical findings

From `dev/test/ui-audit.py`:

| Severity | Finding |
|---|---|
| medium | **9 locale tables nobody can select** — `ar az de es fr kk pt ru uz`, ~442 entries, each 16% complete. The language picker offers only English and Türkçe. Dead weight in a 5,100-line file. |
| info | **5 of 19 tools are Premiere-only** and simply vanish from the desktop home grid with no explanation. |
| info | **`export-grp-video` is empty in the Premiere panel** — the slot exists in the shared HTML but only `desktop-app.js` fills it. |
| fixed | `lang-seg` — leftovers from a language switcher replaced by a `<select>`, removed. |
| clean | English and Turkish are 100% complete. No dead handlers, no duplicate ids, no tool card opening an empty page. |

### What is genuinely good

Worth keeping through the rewrite:

- The **card grid with categories** is a good launcher. The problem is what sits
  underneath it, not the grid.
- **Per-tool view isolation** — showing one tool's controls and nothing else — is
  the right instinct; the implementation (hiding siblings, moving nodes) is what
  needs replacing.
- **Contextual actions**: buttons that only appear when they can do something
  (translated-SRT after Translate).
- **Turkish-first**, not translated-as-an-afterthought.
- **Tooltips on everything** via `data-i18n-tip`.
- **Undo/redo** across every mutating action.

---

## 2 · What to build instead

### The shape of the work

An editor's actual session is linear:

```
  get a transcript → fix the text → style it → put it somewhere
```

Everything else — cut silences, beep profanity, enhance audio, chapters, viral
clips — is a **side errand** launched from that spine, not a peer of it.

Today's UI treats all nineteen tools as peers on a grid, so the spine is
invisible and the errands are over-promoted. Invert that.

### Proposed structure

```
┌─ Source ──────── pick a file, or read the Premiere timeline
│
├─ EDITOR ──────── the home base. Transcript · waveform · video.
│                  Everything about the words happens here.
│    ├ Text        split, merge, retime, find/replace, clean-up
│    ├ Style       preview, presets, position, fonts
│    └ Tools ▸     the side errands, opened as a side panel over the editor
│
├─ Deliver ─────── one page showing every destination at once
│
└─ Settings ────── one page. Engine · Formatting · Clean-up · AI · Account
```

**Four destinations instead of eight panels and a grid.**

#### Editor — the one screen that matters

Today the transcript, the waveform and the video preview are spread across
panels. They belong together, because editing a subtitle means looking at all
three. This is where 80% of the session happens and it should never require
navigating away.

- Transcript list (already fast — 800 segments render in ~10 ms after the
  delegation rewrite)
- Waveform strip with draggable segment edges (exists, keep)
- Video preview with the styled subtitle overlay (exists, keep)
- One toolbar: Clean-up · Find · AI · Sync

#### Tools as a side panel, not a destination

The fourteen side errands open **over** the editor, keeping the transcript
visible. You almost always want to see what a tool did to your text.

Group them by what they change, which is what a user actually reasons about:

| Group | Tools |
|---|---|
| Changes the **text** | Clean-up, Filler words, Profanity, Dictionary, Spelling & punctuation |
| Changes the **timeline** | Cut silences, Remove repeats, Cut by markers, Auto zoom, Multicam, Vertical resize |
| Changes the **audio** | Enhance, Beep, Music ducking |
| Produces **something new** | Chapters, Viral clips, Social pack, B-roll, Speech pace |

Premiere-only tools should be **visible but disabled** in the desktop app, with
one line saying why — "needs a Premiere timeline". Silently disappearing makes
the two products feel like different apps and makes the Premiere extension's
value invisible to desktop users who might upgrade.

#### Deliver — one page, not a dropdown

Every output on one screen, grouped by where it goes:

| Destination | Outputs |
|---|---|
| **Files** | SRT · VTT · ASS · TXT · word-by-word SRT · **bilingual SRT** |
| **Video** | **Burn-in MP4** · 9:16 vertical clip |
| **Premiere** | Caption track · styled MOGRT graphics · beep track |
| **Project** | `.subsper` session file |

Burn-in stops being a hidden menu item and becomes the visibly primary output
it deserves to be. Rows unavailable on the current platform stay listed and
greyed with a reason, rather than vanishing.

#### Settings — one page, five groups

49 keys is a lot. Consolidate rather than scatter:

| Group | Contents |
|---|---|
| Engine | model, language, threads, hardware acceleration, diarization |
| Formatting | chars/line, lines, CPS, max duration, auto-split, gap fill |
| Clean-up | dictionary, fillers, profanity + mode, allowed punctuation, auto clean-up |
| AI | provider, keys, model — with the privacy notice already added |
| Account | licence, device id, profiles, updates |

Two changes that matter more than the grouping:

- **Search.** A settings page with 49 entries needs a filter box more than it
  needs perfect categories.
- **Stop moving DOM nodes.** Settings live in Settings. A tool page that needs a
  setting renders its own control bound to the same value — two views of one
  state, not one node relocated.

### Screens the product does not have and should

| Screen | Why |
|---|---|
| **Recent projects** | Every session starts by finding the same file again. |
| **Batch queue** | Batch transcribe exists but runs invisibly. A queue with per-file progress and per-file errors makes it sellable. |
| **Keyboard shortcuts** | They exist and are good. They are mentioned once, during onboarding, and never again. |
| **Engine status / diagnostics** | Which model, where the engine came from, last update check, log tail. Halves support load. |
| **Empty state on the editor** | Right now an empty transcript is a hint line. It should be the entry point: drop a file, read the timeline, load an SRT. |

### Decisions to make before drawing anything

1. **Do the desktop app and the extension keep sharing one UI?** They share
   `main.js` verbatim today and that has kept them in step. But the Premiere
   panel is a ~420px column and the desktop app is a full window — one layout
   cannot be right for both. Suggestion: keep sharing all logic, let the two
   own their layout.
2. **What happens to the 9 dead locale tables?** Ship them properly or delete
   them. Half-translated is worse than English-only.
3. **Do the badges mean anything?** Eleven of nineteen tools are `new` or
   `beta`. Either give badges an expiry or drop them.
4. **What is the free tier?** The licence gate currently wraps
   `startTranscription`, `exportAs`, `sendToPremiere` — that is all-or-nothing.
   If there is to be a free tier, the UI has to show which tools are paid
   *before* the user invests a transcription in them.

---

## Running the audit

```bash
python3 dev/test/ui-audit.py          # mechanical findings, also runs in CI
dev/test/dom-harness.sh               # segment list interactions in a real browser
```
