/* Whisper Studio – main.js */

// ── Node.js (CEP --enable-nodejs) ─────────────────────────────────────────
const _req      = window.require || (window.cep_node && window.cep_node.require);
const fs        = _req("fs");
const path      = _req("path");
const os        = _req("os");
const { spawn } = _req("child_process");

// ── CEP ───────────────────────────────────────────────────────────────────
const csInterface = new CSInterface();

// ── State ─────────────────────────────────────────────────────────────────
let segments = [], seqInTime = 0, isRunning = false, selectedIndex = -1, toastTimer = null;
let lastLanguage = "";
// The segment currently highlighted as playing, so the follow loop can update
// two nodes instead of walking the whole list every tick.
let _playingNode = null;

// ── Settings (persisted to localStorage) ──────────────────────────────────
const DEFAULT_SETTINGS = {
    engine:          "cpp",       // bundled whisper.cpp — zero setup. Pro: whisperx/mlx/openai (Python)
    diarize:         false,
    autoSplit:       true,
    maxCharsPerLine: 42,
    maxLines:        2,
    maxCps:          17,
    maxDur:          7.0,
    gapFill:         false,
    gapMax:          2.0,
    stylePreset:     "clean",
    karaoke:         false,
    karaokeHi:       "FFE000",   // highlight (spoken word) colour for karaoke .ass
    silenceThreshold: -30,
    silenceMinDur:    0.6,
    silencePad:       0.05,       // seconds kept around speech when ripple-cutting
    customStyle:      null,
    bilingualOrder:   "source-first", // source-first | translation-first
    uiLang:           "en",       // interface language: en | tr
    theme:            "dark",     // dark | light | auto
    // ── Transcript clean-up ──
    punctAllowed:    ".,?!:;\"'()[]{}-", // which punctuation to keep
    customDict:      "",          // one "wrong=right" rule per line
    promptWords:     "",          // comma-separated context words sent as initial_prompt
    autoCleanup:     false,       // apply dictionary + fillers automatically after transcribe
    fillerWords:     "",          // extra fillers (comma/newline separated); blank = built-in only
    fillerOn:        true,        // include built-in filler list
    profanityList:   "",          // extra profanity words
    profanityMode:   "remove",    // remove | asterisk
    // ── AI & API ──
    aiProvider:      "gemini",    // gemini | openai | anthropic | custom
    geminiApiKey:    "",          // Google Gemini API Key
    openaiApiKey:    "",
    anthropicApiKey: "",
    customApiUrl:    "",          // OpenAI-compatible base URL (e.g. Groq)
    customApiKey:    "",
    geminiModel:     "gemini-3.5-flash", // Default Gemini model
    // ── Audio enhancement ──
    audioDenoise:    true,
    audioNormalize:  true,
    // ── Edit automation ──
    zoomAmount:      8,           // % push-in per clip
    zoomStyle:       "in",        // in (smooth slow push-in, YouTuber-style) | alternate
    threads:         0,           // whisper.cpp threads (0 = auto: use all CPU cores)
    hwAccel:         "cpu",       // cpu (default — most compatible) | auto = use GPU (Windows Vulkan)
    whisperModel:    "turbo",     // persisted Whisper model choice
    spokenLang:      "auto",      // persisted spoken-language choice
    hfToken:         "",          // HuggingFace token (Speaker Labels / diarization)
    beepShift:       0,           // ms — shift beep earlier(-) / later(+)
    beepPad:         40,          // ms — extra beep before & after the word
    beepDuck:        0,           // % — original voice level under the beep (0 = mute)
    profStem:        true,        // match suffixed forms too (kan → kanın), beep only the root part
    beepMode:        "beep",      // beep = 1kHz tone | mute = just silence the word (no tone)
    followPlayhead:  true,        // highlight the active segment while playing
};

// Built-in filler words (Turkish + English). Phrases first so they match before single words.
const BUILTIN_FILLERS = [
    "you know", "i mean", "sort of", "kind of",
    "ee", "eee", "ııı", "ıı", "ı ı", "şey", "yani", "hani", "işte", "falan",
    "aa", "ee", "mmm", "hmm", "ııh", "ee ", "um", "uh", "uhm", "erm", "er", "like",
];

// Built-in profanity (kept mild/partial; users extend in Settings). Matched word-boundary, case-insensitive.
const BUILTIN_PROFANITY = [
    "amk", "aq", "oç", "piç", "siktir", "orospu", "yarrak", "göt", "amına", "amcık", "sik", "pezevenk",
    "fuck", "shit", "bitch", "asshole", "bastard", "dick", "cunt", "motherfucker",
];

const DEFAULT_CUSTOM_STYLE = {
    font: "Arial", size: 54, primary: "FFFFFF", outline: "000000",
    outlineW: 3, shadow: 1, bold: false, align: 2, box: false, boxColor: "000000", boxAlpha: 96
};

let settings = loadSettings();

// ── Subtitle style presets ─────────────────────────────────────────────────
const STYLE_PRESETS = {
    clean:       { label: "Clean White",   font: "Arial",   size: 54, primary: "FFFFFF", outline: "000000", outlineW: 3, shadow: 1, bold: false, align: 2, box: false, boxColor: "000000", boxAlpha: 96 },
    bold_yellow: { label: "Bold Yellow",   font: "Arial",   size: 60, primary: "FFE000", outline: "000000", outlineW: 4, shadow: 1, bold: true,  align: 2, box: false, boxColor: "000000", boxAlpha: 96 },
    tiktok:      { label: "Boxed (TikTok)",font: "Arial",   size: 62, primary: "FFFFFF", outline: "000000", outlineW: 0, shadow: 0, bold: true,  align: 2, box: true,  boxColor: "000000", boxAlpha: 40 },
    cinematic:   { label: "Cinematic",     font: "Georgia", size: 48, primary: "F5F5DC", outline: "000000", outlineW: 2, shadow: 2, bold: false, align: 2, box: false, boxColor: "000000", boxAlpha: 96 },
    outline:     { label: "Heavy Outline", font: "Arial",   size: 56, primary: "FFFFFF", outline: "000000", outlineW: 5, shadow: 0, bold: true,  align: 2, box: false, boxColor: "000000", boxAlpha: 96 },
    top:         { label: "Top White",     font: "Arial",   size: 52, primary: "FFFFFF", outline: "000000", outlineW: 3, shadow: 1, bold: false, align: 8, box: false, boxColor: "000000", boxAlpha: 96 },
    custom:      { label: "Custom",        font: "Arial",   size: 54, primary: "FFFFFF", outline: "000000", outlineW: 3, shadow: 1, bold: false, align: 2, box: false, boxColor: "000000", boxAlpha: 96 },
};

function getActivePreset() {
    if (settings.stylePreset === "custom") {
        return { ...DEFAULT_CUSTOM_STYLE, ...(settings.customStyle || {}), label: "Custom" };
    }
    return STYLE_PRESETS[settings.stylePreset] || STYLE_PRESETS.clean;
}

function loadSettings() {
    let s;
    try { s = Object.assign({}, DEFAULT_SETTINGS, JSON.parse(localStorage.getItem("ws_settings") || "{}")); }
    catch { s = Object.assign({}, DEFAULT_SETTINGS); }
    // One-time migration: the bundled engine is the product default on both
    // apps — it needs no setup and is the only one that reports real progress.
    // Installs from before this default kept whatever Pro engine they had, so
    // move them over once. A deliberate pick made afterwards is respected.
    if (!s.engineDefaultV2) {
        s.engine = "cpp";
        s.engineDefaultV2 = true;
        try { localStorage.setItem("ws_settings", JSON.stringify(s)); } catch (e) {}
    }
    return s;
}
function saveSettings() {
    try { localStorage.setItem("ws_settings", JSON.stringify(settings)); } catch {}
}
function onSettingChange(key, value) {
    settings[key] = value;
    saveSettings();
    if (key === "autoSplit") {
        const sub = document.getElementById("autosplit-sub");
        if (sub) sub.style.display = value ? "block" : "none";
    }
    // Keep the AI panel's "no key yet" hint in sync with the key fields
    if (/ApiKey$|^aiProvider$/.test(key) && typeof updateAiKeyHint === "function") {
        try { updateAiKeyHint(); } catch (e) {}
    }
}

// ── Internationalization (EN / TR) ─────────────────────────────────────────
const I18N = {
  en: {
    // header / tabs
    tagline: "AI Subtitles", status_ready: "Ready — set In/Out points and click Transcribe",
    tab_transcribe: "Subtitles", tab_silence: "Silence", tab_setup: "Settings",
    sub_work_tx: "Edit", sub_settings: "Settings", sub_detect: "Detect", sub_install: "Setup",
    // transcribe controls
    lbl_model: "Model", lbl_language: "Language", opt_auto: "Auto detect",
    btn_transcribe: "Transcribe", btn_loadsrt: "Load SRT",
    btn_play: "Play", btn_pause: "Pause",
    btn_enhance: "Enhance Audio — denoise + normalize",
    empty_p: "Click Transcribe to subtitle your whole timeline — or set In/Out (I/O) first for just a range.",
    empty_hint: "Click a word to split there · double-click text to edit.",
    // find / replace
    find_ph: "Find…", replace_ph: "Replace with… (optional)",
    btn_close: "Close", btn_replaceall: "Replace All", btn_cancel: "Cancel",
    // actions
    act_clear: "Clear", act_send: "Send to Premiere",
    clean_title: "Clean up…", clean_dict: "Apply Dictionary", clean_filler: "Remove Fillers",
    clean_prof: "Censor Profanity", clean_punct: "Filter Punctuation", clean_all: "Clean All",
    clean_proof: "Spelling & Punctuation",
    export_title: "Export as…", export_srt: "SubRip", export_vtt: "WebVTT",
    export_ass: "Advanced SSA", export_txt: "Plain text",
    // settings sections
    sec_engine: "Transcription Engine", sec_cleanup: "Transcript Clean-up",
    sec_audio: "Audio Enhancement", sec_quality: "Subtitle Quality",
    sec_style: "Subtitle Style", sec_karaoke: "Karaoke", sec_timing: "Subtitle Timing",
    sec_interface: "Interface", lbl_uilang: "Language", sec_modellang: "Model & Language",
    lbl_theme: "Appearance", theme_dark: "Dark", theme_light: "Light", theme_auto: "Auto",
    tip_theme: "Switch appearance — Dark / Light / Auto (follow system)",
    // settings items
    nm_engine: "Engine", ds_engine: "Built-in works instantly with no setup. Pro engines need Python (optional).",
    opt_eng_cpp: "Subsper Built-in — no setup needed ★", opt_eng_whisperx: "Pro: WhisperX — speaker labels (needs Python)",
    opt_eng_mlx: "Pro: mlx-whisper — Apple Silicon (needs Python)", opt_eng_openai: "Pro: openai-whisper (needs Python)",
    pro_unavailable: "Pro engines need Python + WhisperX (optional). Built-in is selected.",
    nm_threads: "CPU Threads", ds_threads: "Threads for the built-in engine. 0 = use all cores.",
    tip_threads: "How many CPU threads the built-in engine uses. Auto (0) uses all cores — fastest.",
    nm_hwaccel: "Hardware Acceleration", ds_hwaccel: "GPU is faster on Windows (Vulkan). Switch to CPU only if the GPU causes errors.",
    opt_hw_auto: "Auto — try GPU (Windows, experimental)", opt_hw_cpu: "CPU — most compatible (recommended) ★",
    tip_hwaccel: "Auto uses the GPU on Windows (Vulkan) for speed. Pick CPU only if transcription errors or crashes.",
    nm_diar: "Speaker Labels (Pro)", ds_diar: "Tags who is speaking. Needs the WhisperX Pro engine + a free HuggingFace token.",
    hint_hf: "Free token: huggingface.co → Settings → Access Tokens. Also accept the pyannote model terms once.",
    sec_beep: "Beep Profanity",
    nm_beepshift: "Beep timing shift", ds_beepshift: "Beep starts too early/late? Shift it. Negative = earlier, positive = later.",
    nm_beeppad: "Beep padding", ds_beeppad: "Extra beep before AND after the word, so the edges are covered.",
    nm_beepduck: "Original audio during beep", ds_beepduck: "How loud the original voice stays under the beep. 0% = fully muted.",
    nm_profstem: "Catch suffixed forms", ds_profstem: "A filtered word is caught inside inflections too (kan → kanın); only the root part gets beeped/censored.",
    nm_beepmode: "Censor sound", ds_beepmode: "Cover the word with a 1 kHz beep, or just mute it silently.",
    opt_beep: "Beep (1 kHz)", opt_mute: "Mute (silent)",
    nm_autocleanup: "Auto clean-up", ds_autocleanup: "Apply dictionary & remove fillers when transcription finishes",
    lbl_dict: "Custom dictionary", hint_dict: "Fixes names, brands & mis-hearings. Format: wrong=right (whole word, case-insensitive).",
    lbl_punct_filter: "Allowed Punctuation", hint_punct_filter: "Only these punctuation marks will be kept. Delete all to remove all punctuation.",
    lbl_prompt_words: "Context words (AI prompt)", hint_prompt_words: "Difficult words/names that the AI might mis-hear. These are sent as a prompt to improve accuracy. Comma-separated.",
    sync_title: "Sync with Correct Text", sync_ph: "Paste the fully corrected text here. This will replace words in subtitles while keeping the timing intact.",
    sync_hint: "Word alignment algorithm will modify the current segments.", tip_sync: "Sync with correct text", btn_sync: "Preview changes",
    sec_api: "AI & API", nm_gemini_api: "Gemini API Key", ds_gemini_api: "Get a free key from Google AI Studio to use AI tools.",
    lbl_ai_tools: "AI Studio", tip_ai: "AI Video Tools",
    ai_summary: "Summary & Title", ai_shorts: "Extract Shorts", ai_broll: "B-Roll Ideas",
    ai_tags: "Tags / SEO", ai_translate: "Translate → EN", ai_grammar: "Fix Grammar", ai_apply: "Apply to Subtitles",
    ai_sub_tools: "Improve subtitles", ai_content_tools: "Content ideas",
    ai_key_hint: "No API key yet — click here to add one in Settings (free from Google AI Studio).",
    tip_ai_provider: "Which AI service answers. The model list follows your choice.",
    tip_ai_grammar: "Fixes spelling & grammar line by line, then lets you apply it back",
    tip_ai_translate: "Translates every line, keeping the timing — apply back or export as SRT",
    grp_files: "Subtitle file", grp_video: "Video", grp_premiere: "Premiere", grp_project: "Project",
    ai_ph: "Generated insights will appear here...",
    nm_filler: "Filler words", ds_filler: "Include the built-in list (ee, ıı, şey, um, uh…)",
    lbl_extrafiller: "Extra fillers to remove",
    nm_prof: "Profanity filter", ds_prof: "How to handle matched words",
    lbl_extraprof: "Extra words to censor", hint_cleanrun: "Run any of these from the clean-up menu on the Subtitles tab.",
    nm_denoise: "Denoise", ds_denoise: "High-pass + FFT noise reduction (removes hiss/hum)",
    nm_normalize: "Loudness normalize", ds_normalize: "EBU R128 to −16 LUFS — consistent, social-ready volume",
    hint_enhance: "Run 🎚 Enhance Audio on the Subtitles tab. The cleaned WAV is imported to a “Whisper Audio” bin.",
    nm_autoformat: "Auto-format subtitles", ds_autoformat: "Split long / over-fast subtitles to broadcast standards",
    lbl_cpl: "Max characters per line", lbl_lines: "Max lines",
    lbl_cps: "Max reading speed (chars/sec)", lbl_maxdur: "Max subtitle duration",
    hint_split: "Subtitles longer than this (or too fast to read) are split at word boundaries.",
    lbl_textcolor: "Text color", lbl_outlinecolor: "Outline color", lbl_size: "Size",
    lbl_outlinew: "Outline width", lbl_bold: "Bold", lbl_box: "Box bg",
    opt_bottom: "Bottom", opt_top: "Top", opt_center: "Center",
    hint_style: "Applies to .ass exports. SRT / Premiere captions carry no styling.",
    nm_karaoke: "Word-by-word highlight", ds_karaoke: "Each word lights up as spoken. Exports as karaoke .ass (needs word timing).",
    lbl_hicolor: "Highlight colour", hint_karaoke: "Open the .ass in CapCut, VLC or Premiere. Spoken words switch to the highlight colour.",
    nm_continuous: "Continuous subtitles", ds_continuous: "Extend each subtitle to the next, filling short gaps",
    lbl_maxgap: "Max gap to fill", hint_gap: "Gaps larger than this stay separate.",
    // silence
    sil_intro: "Analyzes the In/Out audio. Mark places markers; Cut ripple-deletes silent gaps and shifts clips left. Set In/Out first.",
    btn_mark: "Detect & Mark Silences", btn_cut: "Cut Silences (ripple delete)",
    hint_cut: "Cut is experimental — best on simple single-camera timelines. Undo with Ctrl/Cmd+Z.",
    sec_detect: "Detection Settings",
    lbl_silthr: "Silence threshold", lbl_sildur: "Min silence length", lbl_silpad: "Cut padding (keep around speech)",
    hint_sil: "Lower dB = only deeper silences count. Raise length to skip brief pauses. Padding leaves breath when cutting.",
    sil_status: "Detect silences in your In/Out selection",
    // setup
    sec_syscheck: "System Check (optional / Pro)", sec_models: "Whisper Models", sec_install: "Install Notes",
    setup_optional: "✓ Subsper's built-in engine works out of the box — no setup needed. Everything below is OPTIONAL — install Python + WhisperX only if you want speaker labels.",
    nm_builtin: "Subsper Built-in engine", ds_builtin_ok: "✓ Ready — bundled whisper.cpp + ffmpeg, no setup", ds_builtin_dl: "Bundled — the model downloads on first transcription",
    py_optional: "Not detected — that's fine. Install Python only for optional Pro features (speaker labels, etc.).",
    opt_alt_note: "Optional alternative engine — the Built-in engine already covers this. No need to install.",
    btn_recheck: "Re-check", btn_reload: "Reload Extension",
    // tooltips
    tip_tab_transcribe: "Auto-generate and edit subtitles from your video",
    tip_tab_silence: "Find, mark or cut silent gaps",
    tip_tab_setup: "System check — are Python, ffmpeg and Whisper installed?",
    tip_sub_tx_work: "Transcription & segment editing screen",
    tip_sub_tx_settings: "Engine, auto-format, style, karaoke and clean-up settings",
    tip_sub_sl_work: "Detect, mark or ripple-cut silences",
    tip_sub_sl_settings: "Threshold (dB), minimum length and cut padding",
    tip_model: "Whisper model: turbo = fast & accurate (recommended), large = best but slower, small/base = fast but less accurate",
    tip_lang: "Spoken language. 'Auto detect' finds it — but picking it gives more accurate results",
    tip_transcribe: "Transcribes the In/Out range — or the WHOLE timeline if no In/Out is set",
    tip_loadsrt: "Load an existing .srt subtitle file and edit it here",
    tip_play: "Play / pause in Premiere. Clicking a segment also jumps there and plays",
    tip_enhance: "Cleans the In/Out audio: reduces noise + balances loudness (−16 LUFS). Imports the clean WAV to the project",
    tip_case: "Case-sensitive search",
    tip_findprev: "Previous match (Shift+Enter)", tip_findnext: "Next match (Enter)",
    tip_replaceinput: "Text to replace the match with. Leave empty to delete the word",
    tip_replaceall: "Replace all matches",
    tip_segcount: "Total number of segments (subtitle lines)",
    tip_find: "Find & replace text",
    tip_clean: "Clean-up menu: dictionary, fillers, profanity filter",
    tip_clean_dict: "Apply your wrong=right rules from Settings",
    tip_clean_filler: "Remove filler words (ee, ıı, şey, um, uh…)",
    tip_clean_prof: "Censor profanity (asterisk or remove)",
    lbl_followplayhead: "Follow along while playing",
    ds_followplayhead: "Scrolls the list to the line being spoken. Turn off to watch the video without the text jumping.",
    ds_bi_order: "Which language sits on top when you export a bilingual subtitle file.",
    prof_title: "Profiles", prof_save: "Save", prof_delete: "Delete",
    prof_name_ph: "Profile name (e.g. Client A — vertical)",
    prof_hint: "Saves style, reading speed, word lists, model and language under a name. API keys and your licence are never included.",
    prof_need_name: "Give the profile a name first",
    prof_saved: "Profile saved: %s", prof_loaded: "Profile loaded: %s",
    prof_deleted: "Profile deleted: %s", prof_missing: "That profile no longer exists",
    prof_none: "No profiles yet",
    bi_export: "Bilingual SRT", bi_saved: "Bilingual SRT saved to Desktop",
    bi_need_translate: "Run Translate first — the bilingual file needs both languages",
    bi_order: "Bilingual line order", bi_src_first: "Original on top", bi_dst_first: "Translation on top",
    hint_ai_privacy: "Everything else in Subsper runs offline. These features are the exception: they send your subtitle TEXT (never your audio or video) to the provider you pick below, using your own API key. Leave them alone and nothing is sent. For spelling and punctuation there is an offline pass in the Clean-up menu.",
    tip_clean_proof: "Offline spell + punctuation pass — no AI, no internet. Cmd/Ctrl+Z undoes it",
    tip_clean_punct: "Apply the Allowed-Punctuation setting (clear it to strip all punctuation)",
    tip_clean_all: "Apply dictionary + fillers + profanity at once",
    tip_export: "Export subtitles to a file",
    tip_export_srt: "Most common subtitle format. CapCut, YouTube, Premiere all open it",
    tip_export_vtt: "Web / HTML5 video subtitle format",
    tip_export_ass: "Styled / karaoke subtitle. Carries colour, font, box, word highlight",
    tip_export_txt: "Plain text without timestamps (transcript)",
    tip_clear: "Delete all segments and start over",
    tip_send: "Send the subtitle to the Premiere timeline as a caption track",
    tip_engine: "Which AI engine transcribes. WhisperX = word-level timing + speaker labels (needed for karaoke). mlx = fastest on Apple Silicon. openai = most compatible.",
    tip_diar: "Labels who is speaking (Speaker 1, 2…). WhisperX only. Needs a free HuggingFace token.",
    tip_autocleanup: "After transcribing, applies dictionary rules and removes filler words automatically",
    tip_filler: "Use the built-in filler list (ee, ıı, şey, yani, um, uh…)",
    tip_profmode: "How to hide profanity: first letter + asterisks (s***) or remove (—)",
    tip_denoise: "Reduces background noise/hum (high-pass + FFT denoise)",
    tip_normalize: "Balances loudness to −16 LUFS — consistent, social/broadcast-ready",
    tip_autoformat: "Auto-splits long/fast subtitles to broadcast standards (per limits below)",
    tip_cpl: "Max characters on one line. Standard: 37–42. More is hard to read",
    tip_lines2: "Max lines shown per subtitle. Standard: 2",
    tip_cps: "Max characters per second (reading speed). Faster than this gets split. Standard: 15–17",
    tip_maxdur: "Max seconds one subtitle stays on screen. Longer ones split at word boundaries",
    tip_stylepreview: "Live preview of the selected style (used in .ass export)",
    tip_stylechips: "Preset subtitle styles. 'Custom' lets you set your own colour/font",
    tip_hicolor: "Highlight colour of the spoken word (unspoken words stay white)",
    tip_karaoke: "Instagram/TikTok style: each word changes colour as spoken. Exports as .ass. Needs word timing (WhisperX/Whisper)",
    tip_continuous: "Extends each subtitle until the next begins — no flicker in short gaps",
    tip_maxgap: "Gaps longer than this are NOT filled — subtitles stay separate",
    tip_mark: "Finds silent gaps and adds orange markers — nothing is deleted, just marked",
    tip_cut: "Ripple-deletes silent gaps and pulls clips left. Experimental — undo with Ctrl/Cmd+Z",
    tip_silthr: "Which level counts as 'silence'. Low (e.g. −45) catches only deep silences; high (e.g. −20) also counts soft pauses",
    tip_sildur: "Minimum silence length to count. Higher skips short breaths/pauses",
    tip_silpad: "Small margin kept around speech when cutting — so word starts/ends aren't clipped",
    tip_maxgap2: "Gaps longer than this aren't filled — subtitles stay separate. Short gaps are merged",
    tip_recheck: "Re-scan the system — press after installing something missing",
    tip_reload: "Reload the panel — applies code updates (without restarting Premiere)",
    tip_uilang: "Interface & tooltip language",
    tip_seek: "Jump here and play", tip_edit: "Edit text (double-click also works)",
    tip_split: "Split this segment in half", tip_del: "Delete this segment",
    // new tabs
    tab_edit: "Edit", tab_audio: "Audio", sub_actions: "Tools",
    tip_tab_edit: "Automated editing — cut silences, fillers, shorten pauses, auto-zoom",
    tip_tab_audio: "Audio tools — clean up, normalize, beep profanity",
    tip_sub_ed_work: "Run the editing tools", tip_sub_au_work: "Run the audio tools",
    ed_intro: "Automated editing for the In/Out selection. Set In/Out points on your timeline first.",
    au_intro: "Audio tools for the In/Out selection. Set In/Out points on your timeline first.",
    sec_silence: "Silence", sec_enhance: "Enhance",
    // auto zoom
    sec_zoom: "Auto Zoom", nm_zoom: "Auto Zoom",
    ds_zoom: "Adds a subtle motion (slow push-in) to each clip in the selection for extra energy.",
    btn_zoom: "Apply Auto Zoom", lbl_zoomamt: "Zoom amount", lbl_zoomstyle: "Zoom style",
    opt_zoom_alt: "Alternate in / out", opt_zoom_in: "Always push-in", opt_zoom_subtle: "Subtle (gentle)",
    hint_zoom: "Adds Motion → Scale keyframes to clips in the In/Out range. Experimental — undo with Ctrl/Cmd+Z.",
    tip_zoom: "Adds a slow zoom (Motion keyframes) to each clip in the In/Out range for a dynamic, pro feel",
    tip_zoomamt: "How far each clip zooms over its length (e.g. 8% = 100%→108%)",
    tip_zoomstyle: "Alternate = clips zoom in then out; Always push-in = every clip pushes in",
  },
  tr: {
    tagline: "Yapay Zekâ Altyazı", status_ready: "Hazır — Transcribe'a bas (In/Out istersen aralık seçer)",
    tab_transcribe: "Altyazı", tab_silence: "Sessizlik", tab_setup: "Ayarlar",
    sub_work_tx: "Düzenle", sub_settings: "Ayarlar", sub_detect: "Tespit", sub_install: "Kurulum",
    lbl_model: "Model", lbl_language: "Dil", opt_auto: "Otomatik algıla",
    btn_transcribe: "In/Out Aralığını Yazıya Dök", btn_loadsrt: "SRT Yükle",
    btn_play: "Oynat", btn_pause: "Duraklat",
    btn_enhance: "Sesi İyileştir — gürültü azalt + dengele",
    empty_p: "Transcribe'a bas — tüm timeline yazıya dökülür. Sadece bir aralık istersen önce In/Out (I/O) koy.",
    empty_hint: "Bölmek için kelimeye tıkla (o kelime alttaki satırın başı olur) · düzenlemek için metne çift tıkla.",
    find_ph: "Ara…", replace_ph: "Şununla değiştir… (opsiyonel)",
    btn_close: "Kapat", btn_replaceall: "Tümünü Değiştir", btn_cancel: "İptal",
    act_clear: "Temizle", act_send: "Premiere'e Gönder",
    clean_title: "Temizlik…", clean_dict: "Sözlüğü Uygula", clean_filler: "Dolguları Kaldır",
    clean_prof: "Küfür Sansürle", clean_punct: "Noktalama Filtrele", clean_all: "Hepsini Temizle",
    clean_proof: "Yazım & Noktalama",
    export_title: "Şu formatta aktar…", export_srt: "SubRip", export_vtt: "WebVTT",
    export_ass: "Advanced SSA", export_txt: "Düz metin",
    sec_engine: "Transkripsiyon Motoru", sec_cleanup: "Metin Temizliği",
    sec_audio: "Ses İyileştirme", sec_quality: "Altyazı Kalitesi",
    sec_style: "Altyazı Stili", sec_karaoke: "Karaoke", sec_timing: "Altyazı Zamanlaması",
    sec_interface: "Arayüz", lbl_uilang: "Dil", sec_modellang: "Model & Dil",
    lbl_theme: "Görünüm", theme_dark: "Koyu", theme_light: "Açık", theme_auto: "Otomatik",
    tip_theme: "Görünümü değiştir — Koyu / Açık / Otomatik (sistemi takip et)",
    nm_engine: "Motor", ds_engine: "Yerleşik motor kurulum gerektirmez, anında çalışır. Pro motorlar Python ister (opsiyonel).",
    opt_eng_cpp: "Subsper Yerleşik — kurulum gerekmez ★", opt_eng_whisperx: "Pro: WhisperX — konuşmacı etiketi (Python gerekir)",
    opt_eng_mlx: "Pro: mlx-whisper — Apple Silicon (Python gerekir)", opt_eng_openai: "Pro: openai-whisper (Python gerekir)",
    pro_unavailable: "Pro motorlar Python + WhisperX ister (opsiyonel). Yerleşik motor seçildi.",
    nm_threads: "CPU Çekirdeği", ds_threads: "Yerleşik motor için iş parçacığı sayısı. 0 = tüm çekirdekleri kullan.",
    tip_threads: "Yerleşik motorun kaç CPU çekirdeği kullanacağı. Auto (0) hepsini kullanır — en hızlısı.",
    nm_hwaccel: "Donanım Hızlandırma", ds_hwaccel: "GPU Windows'ta daha hızlı (Vulkan). Sadece GPU hata verirse CPU'ya geç.",
    opt_hw_auto: "Otomatik — GPU dene (Windows, deneysel)", opt_hw_cpu: "CPU — en uyumlu (önerilen) ★",
    tip_hwaccel: "Otomatik, hız için Windows'ta GPU'yu (Vulkan) kullanır. Transkript hata verir/çökerse Sadece CPU seç.",
    nm_diar: "Konuşmacı Etiketleri (Pro)", ds_diar: "Kim konuşuyor etiketler. WhisperX Pro motoru + ücretsiz HuggingFace token gerekir.",
    hint_hf: "Ücretsiz token: huggingface.co → Settings → Access Tokens. Bir kez de pyannote model şartlarını kabul et.",
    sec_beep: "Küfür Bipleme",
    nm_beepshift: "Bip zamanlama kaydırma", ds_beepshift: "Bip erken/geç mi başlıyor? Kaydır. Eksi = daha erken, artı = daha geç.",
    nm_beeppad: "Bip payı", ds_beeppad: "Kelimenin öncesine VE sonrasına eklenen ekstra bip — kenarlar açıkta kalmasın.",
    nm_beepduck: "Bip sırasında orijinal ses", ds_beepduck: "Bipin altında orijinal ses ne kadar duyulsun. %0 = tamamen sessiz.",
    nm_profstem: "Ekli halleri de yakala", ds_profstem: "Filtredeki kelime ek almış haliyle de yakalanır (kan → kanın); sadece kök kısmı biplenir/sansürlenir.",
    nm_beepmode: "Sansür sesi", ds_beepmode: "Kelimeyi 1 kHz bip ile kapat ya da sessizce sustur.",
    opt_beep: "Bip (1 kHz)", opt_mute: "Sustur (sessiz)",
    nm_autocleanup: "Otomatik temizlik", ds_autocleanup: "İş bitince sözlüğü uygular ve dolgu kelimeleri siler",
    lbl_dict: "Özel sözlük", hint_dict: "İsim/marka/yanlış duymaları düzeltir. Format: yanlış=doğru (tam kelime, büyük-küçük fark etmez).",
    lbl_punct_filter: "İzin Verilen Noktalama", hint_punct_filter: "Sadece bu işaretler korunur (örn. sadece soru işareti için '?' yazın). Hepsini silerseniz tüm noktalamalar kalkar.",
    lbl_prompt_words: "Bağlam kelimeleri (AI prompt)", hint_prompt_words: "Yapay zekanın yanlış duyabileceği zor kelimeler/isimler. Doğruluğu artırmak için prompt olarak gönderilir. Virgülle ayırın.",
    sync_title: "Doğru Metin ile Eşleştir", sync_ph: "Tamamen düzeltilmiş doğru metni buraya yapıştırın. Zamanlamaları bozmadan altyazıdaki kelimeleri değiştirecektir.",
    sync_hint: "Kelime eşleştirme algoritması mevcut segmentleri düzenler.", tip_sync: "Doğru metin ile eşleştir", btn_sync: "Önizle",
    sec_api: "Yapay Zeka & API", nm_gemini_api: "Gemini API Anahtarı", ds_gemini_api: "Google AI Studio'dan ücretsiz alacağınız anahtarla çalışır.",
    lbl_ai_tools: "AI Studio", tip_ai: "Yapay Zeka Araçları",
    ai_summary: "Özet & Başlık", ai_shorts: "Shorts Çıkar", ai_broll: "B-Roll Fikirleri",
    ai_tags: "Etiket / SEO", ai_translate: "Çevir → EN", ai_grammar: "Dilbilgisi Düzelt", ai_apply: "Altyazıya Uygula",
    ai_sub_tools: "Altyazıyı iyileştir", ai_content_tools: "İçerik fikirleri",
    ai_key_hint: "Henüz API anahtarı yok — eklemek için tıkla (Google AI Studio'dan ücretsiz).",
    tip_ai_provider: "Hangi yapay zekâ cevaplasın. Model listesi seçimine göre değişir.",
    tip_ai_grammar: "Satır satır yazım ve dilbilgisini düzeltir, sonra geri uygularsın",
    tip_ai_translate: "Her satırı zamanlamayı koruyarak çevirir — geri uygula veya SRT al",
    grp_files: "Altyazı dosyası", grp_video: "Video", grp_premiere: "Premiere", grp_project: "Proje",
    ai_ph: "Üretilen fikirler burada görünecek...",
    nm_filler: "Dolgu kelimeler", ds_filler: "Yerleşik listeyi kullan (ee, ıı, şey, um, uh…)",
    lbl_extrafiller: "Kaldırılacak ekstra dolgular",
    nm_prof: "Küfür filtresi", ds_prof: "Eşleşen kelimeler nasıl gizlensin",
    lbl_extraprof: "Sansürlenecek ekstra kelimeler", hint_cleanrun: "Bunları Altyazı sekmesindeki temizlik menüsünden çalıştır.",
    nm_denoise: "Gürültü azalt", ds_denoise: "High-pass + FFT gürültü azaltma (uğultu/tıslama temizler)",
    nm_normalize: "Ses seviyesi dengele", ds_normalize: "EBU R128 ile −16 LUFS — tutarlı, sosyal medyaya hazır",
    hint_enhance: "Altyazı sekmesindeki 🎚 Enhance Audio'ya bas. Temiz WAV “Whisper Audio” bin'ine eklenir.",
    nm_autoformat: "Altyazıyı otomatik biçimle", ds_autoformat: "Uzun / çok hızlı altyazıları yayın standardına böler",
    lbl_cpl: "Satır başına maks. karakter", lbl_lines: "Maks. satır",
    lbl_cps: "Maks. okuma hızı (kar./sn)", lbl_maxdur: "Maks. altyazı süresi",
    hint_split: "Bundan uzun (veya çok hızlı) altyazılar kelime sınırından bölünür.",
    lbl_textcolor: "Yazı rengi", lbl_outlinecolor: "Kenar rengi", lbl_size: "Boyut",
    lbl_outlinew: "Kenar kalınlığı", lbl_bold: "Kalın", lbl_box: "Kutu zemin",
    opt_bottom: "Alt", opt_top: "Üst", opt_center: "Orta",
    hint_style: ".ass dışa aktarıma uygulanır. SRT / Premiere altyazısı stil taşımaz.",
    nm_karaoke: "Kelime kelime vurgu", ds_karaoke: "Her kelime söylendikçe yanar. Karaoke .ass olarak çıkar (kelime zamanı gerekir).",
    lbl_hicolor: "Vurgu rengi", hint_karaoke: ".ass'i CapCut, VLC veya Premiere'de aç. Söylenen kelimeler vurgu rengine geçer.",
    nm_continuous: "Sürekli altyazı", ds_continuous: "Her altyazıyı bir sonrakine kadar uzatır, kısa boşlukları doldurur",
    lbl_maxgap: "Doldurulacak maks. boşluk", hint_gap: "Bundan uzun boşluklar ayrı kalır.",
    sil_intro: "In/Out sesini analiz eder. Mark marker koyar; Cut sessiz boşlukları keser ve klipleri sola çeker. Önce In/Out koy.",
    btn_mark: "Sessizlikleri Bul & İşaretle", btn_cut: "Sessizlikleri Kes (ripple)",
    hint_cut: "Kesme deneysel — basit tek-kamera timeline'larda en iyi. Ctrl/Cmd+Z ile geri al.",
    sec_detect: "Tespit Ayarları",
    lbl_silthr: "Sessizlik eşiği", lbl_sildur: "Min. sessizlik süresi", lbl_silpad: "Kesim payı (konuşma etrafı)",
    hint_sil: "Düşük dB = sadece derin sessizlikler. Süreyi artırınca kısa duraklamalar atlanır. Pay, keserken nefes bırakır.",
    sil_status: "In/Out seçimindeki sessizlikleri tespit et",
    sec_syscheck: "Sistem Kontrolü (opsiyonel / Pro)", sec_models: "Whisper Modelleri", sec_install: "Kurulum Notları",
    setup_optional: "✓ Subsper'in yerleşik motoru kutudan çıktığı gibi çalışır — kurulum gerekmez. Aşağıdaki her şey OPSİYONELDİR — yalnızca konuşmacı etiketleri istiyorsan Python + WhisperX kur.",
    nm_builtin: "Subsper Yerleşik motor", ds_builtin_ok: "✓ Hazır — gömülü whisper.cpp + ffmpeg, kurulum yok", ds_builtin_dl: "Gömülü — model ilk transcribe'da iner",
    py_optional: "Algılanmadı — sorun değil. Python'ı yalnızca opsiyonel Pro özellikler (konuşmacı etiketleri vb.) için kur.",
    opt_alt_note: "Opsiyonel alternatif motor — Yerleşik motor bunu zaten karşılıyor. Kurmana gerek yok.",
    btn_recheck: "Yeniden Tara", btn_reload: "Eklentiyi Yenile",
    tip_tab_transcribe: "Videodan otomatik altyazı oluştur ve düzenle",
    tip_tab_silence: "Sessiz boşlukları bul, işaretle veya kes",
    tip_tab_setup: "Sistem kontrolü — Python, ffmpeg ve Whisper kurulu mu?",
    tip_sub_tx_work: "Yazıya dökme ve segment düzenleme ekranı",
    tip_sub_tx_settings: "Motor, otomatik biçimleme, stil, karaoke ve temizlik ayarları",
    tip_sub_sl_work: "Sessizlikleri tespit et, işaretle veya ripple-delete ile kes",
    tip_sub_sl_settings: "Eşik (dB), minimum süre ve kesim payı ayarları",
    tip_model: "Whisper modeli: turbo = hızlı ve doğru (önerilen), large = en doğru ama yavaş, small/base = hızlı ama daha az isabetli",
    tip_lang: "Konuşmanın dili. 'Otomatik algıla' dili bulur — ama biliyorsan seçmek daha doğru sonuç verir",
    tip_transcribe: "Timeline'da I (giriş) ve O (çıkış) ile işaretlenen aralığın sesini yazıya döker",
    tip_loadsrt: "Hazır bir .srt altyazı dosyasını yükle ve buradan düzenle",
    tip_play: "Premiere'de oynat / duraklat. Bir segmente tıklayınca da o ana gider ve oynar",
    tip_enhance: "In/Out sesini temizler: gürültü azaltır + seviyeyi dengeler (−16 LUFS). Temiz WAV'ı projeye ekler",
    tip_case: "Büyük/küçük harf duyarlı arama",
    tip_findprev: "Önceki eşleşmeye git (Shift+Enter)", tip_findnext: "Sonraki eşleşmeye git (Enter)",
    tip_replaceinput: "Bulunan kelimenin yerine yazılacak metin. Boş bırakırsan kelimeyi siler",
    tip_replaceall: "Bulunan tüm eşleşmeleri değiştir",
    tip_segcount: "Toplam segment (altyazı satırı) sayısı",
    tip_find: "Metin içinde ara ve değiştir",
    tip_clean: "Temizlik menüsü: sözlük, dolgu kelimeler, küfür filtresi",
    tip_clean_dict: "Ayarlardaki yanlış=doğru kurallarını uygula",
    tip_clean_filler: "Dolgu kelimeleri sil (ee, ıı, şey, um, uh…)",
    tip_clean_prof: "Küfürleri sansürle (yıldız veya kaldır)",
    lbl_followplayhead: "Oynatırken satırı takip et",
    ds_followplayhead: "Konuşulan satıra kaydırır. Videoyu metin zıplamadan izlemek için kapat.",
    ds_bi_order: "Çift dilli altyazı dosyasında hangi dil üstte olsun.",
    prof_title: "Profiller", prof_save: "Kaydet", prof_delete: "Sil",
    prof_name_ph: "Profil adı (ör. Müşteri A — dikey)",
    prof_hint: "Stil, okuma hızı, kelime listeleri, model ve dili bir isim altında saklar. API anahtarların ve lisansın asla dahil edilmez.",
    prof_need_name: "Önce profile bir isim ver",
    prof_saved: "Profil kaydedildi: %s", prof_loaded: "Profil yüklendi: %s",
    prof_deleted: "Profil silindi: %s", prof_missing: "Bu profil artık yok",
    prof_none: "Henüz profil yok",
    bi_export: "Çift dilli SRT", bi_saved: "Çift dilli SRT masaüstüne kaydedildi",
    bi_need_translate: "Önce Çevir'i çalıştır — çift dilli dosya iki dili de ister",
    bi_order: "Çift dilli satır sırası", bi_src_first: "Orijinal üstte", bi_dst_first: "Çeviri üstte",
    hint_ai_privacy: "Subsper'da her şey çevrimdışı çalışır; istisna bunlar. Aşağıda seçtiğin sağlayıcıya kendi API anahtarınla altyazı METNİNİ gönderirler — sesin ya da videon asla gitmez. Dokunmazsan hiçbir şey gönderilmez. Yazım ve noktalama için Temizle menüsünde çevrimdışı bir seçenek var.",
    tip_clean_proof: "Çevrimdışı yazım + noktalama düzeltmesi — yapay zeka yok, internet yok. Cmd/Ctrl+Z ile geri alınır",
    tip_clean_punct: "İzin verilen noktalama ayarını uygula (boşaltırsan tüm noktalama silinir)",
    tip_clean_all: "Sözlük + dolgu + küfür temizliğini birden uygula",
    tip_export: "Altyazıyı dosyaya aktar",
    tip_export_srt: "En yaygın altyazı formatı. CapCut, YouTube, Premiere hepsi açar",
    tip_export_vtt: "Web / HTML5 video altyazı formatı",
    tip_export_ass: "Stilli / karaoke altyazı. Renk, font, kutu, kelime vurgusu taşır",
    tip_export_txt: "Zaman damgasız düz metin (transkript)",
    tip_clear: "Tüm segmentleri sil ve baştan başla",
    tip_send: "Altyazıyı Premiere zaman çizelgesine caption track olarak gönder",
    tip_engine: "Hangi yapay zekâ motoru yazıya döksün. WhisperX = kelime kelime zaman + konuşmacı (karaoke için gerekli). mlx = Apple Silicon'da en hızlı. openai = en uyumlu.",
    tip_diar: "Kim konuşuyor diye etiketler (Konuşmacı 1, 2…). Sadece WhisperX. Ücretsiz HuggingFace token gerektirir.",
    tip_autocleanup: "Transkripsiyon bitince sözlük kurallarını uygular ve dolgu kelimeleri otomatik siler",
    tip_filler: "Yerleşik dolgu kelime listesini kullan (ee, ıı, şey, yani, um, uh…)",
    tip_profmode: "Küfür nasıl gizlensin: ilk harf + yıldız (s***) ya da tamamen kaldır (—)",
    tip_denoise: "Arka plan gürültüsünü/uğultusunu azaltır (high-pass + FFT denoise)",
    tip_normalize: "Ses seviyesini −16 LUFS'a dengeler — tutarlı, sosyal medya/yayına hazır",
    tip_autoformat: "Uzun/hızlı altyazıları yayın standartlarına göre otomatik böler (aşağıdaki limitlere göre)",
    tip_cpl: "Bir satırda en fazla kaç karakter. Standart: 37–42. Daha fazlası okunmayı zorlaştırır",
    tip_lines2: "Bir altyazıda en fazla kaç satır. Standart: 2",
    tip_cps: "Saniyede en fazla karakter (okuma hızı). Bunu aşan bölünür. Standart: 15–17",
    tip_maxdur: "Tek altyazı en fazla kaç saniye ekranda kalsın. Aşanlar kelime sınırından bölünür",
    tip_stylepreview: "Seçili stilin canlı önizlemesi (.ass dışa aktarımda kullanılır)",
    tip_stylechips: "Hazır altyazı stilleri. 'Custom' ile kendi rengini/fontunu ayarla",
    tip_hicolor: "Söylenen kelimenin vurgu rengi (henüz söylenmeyenler beyaz kalır)",
    tip_karaoke: "Instagram/TikTok tarzı: her kelime söylendikçe renk değiştirir. .ass olarak çıkar. Kelime zamanı gerekir (WhisperX/Whisper)",
    tip_continuous: "Her altyazıyı bir sonraki başlayana kadar uzatır — kısa boşluklarda titremez",
    tip_maxgap: "Bu süreden uzun boşluklar doldurulmaz — altyazılar ayrı kalır",
    tip_mark: "Sessiz boşlukları bulup turuncu marker koyar — hiçbir şeyi silmez, sadece işaretler",
    tip_cut: "Sessiz boşlukları ripple-delete ile keser, klipleri sola çeker. Deneysel — Ctrl/Cmd+Z ile geri al",
    tip_silthr: "Hangi seviyenin altı 'sessizlik' sayılsın. Düşük (örn. −45) sadece derin sessizlikleri; yüksek (örn. −20) hafif duraklamaları da sayar",
    tip_sildur: "En az kaç saniyelik sessizlik sayılsın. Yüksek tutarsan kısa nefes/duraklamalar atlanır",
    tip_silpad: "Keserken konuşmanın başında/sonunda bırakılan küçük pay — kelime başı/sonu kesilmesin diye",
    tip_maxgap2: "Bu süreden uzun boşluklar doldurulmaz. Kısa boşluklar birleştirilir",
    tip_recheck: "Sistemi yeniden tara — eksik bir şey kurduktan sonra buna bas",
    tip_reload: "Paneli yeniden yükle — kod güncellemelerini devreye alır (Premiere'i kapatmadan)",
    tip_uilang: "Arayüz ve tooltip dili",
    tip_seek: "Bu ana git ve oynat", tip_edit: "Metni düzenle (çift tıklama da olur)",
    tip_split: "Bu segmenti ortadan ikiye böl", tip_del: "Bu segmenti sil",
    tab_edit: "Düzen", tab_audio: "Ses", sub_actions: "İşlemler",
    tip_tab_edit: "Otomatik kurgu — sessizlik/dolgu kes, duraklama kısalt, oto-zoom",
    tip_tab_audio: "Ses araçları — temizle, dengele, küfür bip'le",
    tip_sub_ed_work: "Kurgu araçlarını çalıştır", tip_sub_au_work: "Ses araçlarını çalıştır",
    ed_intro: "In/Out seçimi için otomatik kurgu. Önce timeline'da In/Out noktalarını koy.",
    au_intro: "In/Out seçimi için ses araçları. Önce timeline'da In/Out noktalarını koy.",
    sec_silence: "Sessizlik", sec_enhance: "İyileştir",
    sec_zoom: "Oto Zoom", nm_zoom: "Oto Zoom",
    ds_zoom: "Seçimdeki her klibe hafif bir hareket (yavaş zoom) ekler, video enerjik görünür.",
    btn_zoom: "Oto Zoom Uygula", lbl_zoomamt: "Zoom miktarı", lbl_zoomstyle: "Zoom stili",
    opt_zoom_alt: "Dönüşümlü (içeri/dışarı)", opt_zoom_in: "Hep içeri", opt_zoom_subtle: "Hafif (nazik)",
    hint_zoom: "In/Out aralığındaki kliplere Motion → Scale keyframe'i ekler. Deneysel — Ctrl/Cmd+Z ile geri al.",
    tip_zoom: "In/Out aralığındaki her klibe yavaş zoom (Motion keyframe) ekler — dinamik, profesyonel his",
    tip_zoomamt: "Her klip boyunca ne kadar zoom yapsın (örn. %8 = 100%→108%)",
    tip_zoomstyle: "Dönüşümlü = klipler içeri sonra dışarı; Hep içeri = her klip içeri zoom",
  },
};

function t(key) {
    const lang = I18N[settings.uiLang] ? settings.uiLang : "en";
    return (I18N[lang] && I18N[lang][key]) || I18N.en[key] || key;
}

// Apply the active language to all [data-i18n], [data-i18n-tip], [data-i18n-ph] elements
function applyLanguage() {
    document.querySelectorAll("[data-i18n]").forEach(el => {
        const v = t(el.getAttribute("data-i18n"));
        if (v) el.textContent = v;
    });
    document.querySelectorAll("[data-i18n-tip]").forEach(el => {
        el.setAttribute("data-tip", t(el.getAttribute("data-i18n-tip")));
    });
    document.querySelectorAll("[data-i18n-ph]").forEach(el => {
        el.setAttribute("placeholder", t(el.getAttribute("data-i18n-ph")));
    });
    document.documentElement.lang = I18N[settings.uiLang] ? settings.uiLang : "en";
    document.documentElement.dir = (settings.uiLang === "ar") ? "rtl" : "ltr";
}

function setLanguage(lang) {
    settings.uiLang = I18N[lang] ? lang : "en";
    saveSettings();
    applyLanguage();
    renderSegments();
    if (selectedIndex >= 0) selectSegment(selectedIndex);
    // refresh play button label in the active language
    const pp = $("playpause-btn");
    if (pp) pp.innerHTML = (typeof _isPlaying !== "undefined" && _isPlaying)
        ? icon("pause") + "<span>" + t("btn_pause") + "</span>"
        : icon("play")  + "<span>" + t("btn_play")  + "</span>";
    const langSel = $("set-uilang"); if (langSel) langSel.value = settings.uiLang;
}

// ── Icon system (clean line icons, no emoji) ───────────────────────────────
// Lucide-style stroke icons. Use inline via icon("name") or declaratively with
// <span class="ic" data-icon="name"></span> + applyIcons().
const ICONS = {
    captions:  '<rect x="3" y="5" width="18" height="14" rx="3"/><line x1="7" y1="11" x2="13" y2="11"/><line x1="7" y1="15" x2="16" y2="15"/>',
    scissors:  '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/>',
    volume:    '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>',
    settings:  '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
    mic:       '<path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>',
    folder:    '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
    play:      '<polygon points="6 4 20 12 6 20 6 4"/>',
    pause:     '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
    search:    '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
    pilcrow:   '<path d="M13 4v16"/><path d="M17 4v16"/><path d="M19 4H9.5a4.5 4.5 0 0 0 0 9H13"/>',
    sparkles:  '<path d="M12 3l1.9 4.6L18.5 9.5 13.9 11.4 12 16l-1.9-4.6L5.5 9.5l4.6-1.9L12 3z"/><path d="M19 13l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/>',
    download:  '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
    send:      '<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>',
    zap:       '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
    bookmark:  '<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>',
    trash:     '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
    pencil:    '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    close:     '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
    wand:      '<path d="M15 4V2"/><path d="M15 16v-2"/><path d="M8 9h2"/><path d="M20 9h2"/><path d="M17.8 11.8L19 13"/><path d="M15 9h0"/><path d="M17.8 6.2L19 5"/><path d="M3 21l9-9"/><path d="M12.2 6.2L11 5"/>',
    refresh:   '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',
    reload:    '<polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>',
    check:     '<polyline points="20 6 9 17 4 12"/>',
    alert:     '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
    globe:     '<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
    sliders:   '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>',
    sun:       '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
    moon:      '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
    auto:      '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor" stroke="none"/>',
};

function icon(name) {
    const p = ICONS[name]; if (!p) return "";
    return `<svg class="svg-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
}

function applyIcons(root) {
    (root || document).querySelectorAll("[data-icon]").forEach(el => {
        const name = el.getAttribute("data-icon");
        if (name && ICONS[name]) el.innerHTML = icon(name);
    });
}

// ── Theme (dark / light / auto) ────────────────────────────────────────────
function resolveTheme() {
    if (settings.theme === "light") return "light";
    if (settings.theme === "dark")  return "dark";
    try { return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark"; }
    catch (e) { return "dark"; }
}
function applyTheme() {
    document.documentElement.setAttribute("data-theme", resolveTheme());
    const tb = $("theme-btn");
    if (tb) tb.innerHTML = icon(settings.theme === "auto" ? "auto" : (resolveTheme() === "light" ? "sun" : "moon"));
    const sel = $("set-theme"); if (sel) sel.value = settings.theme;
}
function setTheme(v) {
    settings.theme = (["dark", "light", "auto"].indexOf(v) >= 0) ? v : "dark";
    saveSettings();
    applyTheme();
}
function cycleTheme() {
    const order = ["dark", "light", "auto"];
    setTheme(order[(order.indexOf(settings.theme) + 1) % 3]);
    showToast(t("theme_" + settings.theme), "info", 1400);
}

// ── DOM helpers ───────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

const statusBar      = $("status-bar");
const progressBar    = $("progress-bar");
const segmentsWrap   = $("segments-wrap");
const actionsBar     = $("actions-bar");
const segCountEl     = $("seg-count");
const transcribeBtn  = $("transcribe-btn");
const sendBtn        = $("send-btn");
const toastEl        = $("toast");
const setupIndicator = $("setup-indicator");
const setupBadge     = $("setup-badge");

// ── Python discovery (cross-platform, cached) ─────────────────────────────
// Returns a FULL path to a python executable whenever possible. A full path is
// immune to PATH/launcher resolution problems that break a bare `spawn("py")`
// inside a packaged GUI app (the cause of "Could not run Python" on Windows
// even when `py` works in the terminal).
const IS_WIN = (typeof process !== "undefined" && process.platform === "win32");
let _pythonCache = null;

// Fast, filesystem-only Windows scan (covers classic Programs\Python\Python3xx
// AND the newer %LOCALAPPDATA%\Python\pythoncore-3.xx-64 layout). readdir/exists
// are ~instant, so this never freezes the UI.
function _scanWinPython() {
    const la = process.env.LOCALAPPDATA || "";
    const roots = [];
    if (la) { roots.push(la + "\\Python", la + "\\Programs\\Python"); }
    if (process.env.PROGRAMFILES) roots.push(process.env.PROGRAMFILES);
    if (process.env["PROGRAMFILES(X86)"]) roots.push(process.env["PROGRAMFILES(X86)"]);
    roots.push("C:\\");
    for (const r of roots) {
        let names;
        try { names = fs.readdirSync(r); } catch (e) { continue; }
        names.sort().reverse();   // prefer the highest version folder
        for (const name of names) {
            if (!/^(python|pythoncore)/i.test(name)) continue;
            const exe = r + "\\" + name + "\\python.exe";
            try { if (fs.existsSync(exe)) return exe; } catch (e) {}
        }
    }
    return null;
}

// SYNCHRONOUS, NON-BLOCKING lookup — filesystem only, no shell/execSync (a
// blocking shell call here froze the UI → "Not Responding" on Windows).
function findPython() {
    if (_pythonCache) return _pythonCache;
    if (IS_WIN) {
        const found = _scanWinPython();
        if (found) { _pythonCache = found; return found; }
        return "py";   // fallback (uncached); resolvePythonAsync may set a real path
    }
    const candidates = [
        "/Library/Frameworks/Python.framework/Versions/3.13/bin/python3",
        "/Library/Frameworks/Python.framework/Versions/3.12/bin/python3",
        "/Library/Frameworks/Python.framework/Versions/3.11/bin/python3",
        "/opt/homebrew/bin/python3",
        "/usr/local/bin/python3",
        "/usr/bin/python3",
    ];
    for (const p of candidates) {
        try { if (fs.existsSync(p)) { _pythonCache = p; return p; } } catch (e) {}
    }
    return "python3";
}

// ASYNC backstop — resolves the real interpreter path via the launcher WITHOUT
// blocking the UI (async exec). Run once at startup; refines _pythonCache for
// non-standard installs the filesystem scan can't see.
function resolvePythonAsync() {
    return new Promise(resolve => {
        if (_pythonCache && (_pythonCache.indexOf("/") >= 0 || _pythonCache.indexOf("\\") >= 0)) { resolve(); return; }
        
        if (!IS_WIN) {
            const candidates = [
                "/Library/Frameworks/Python.framework/Versions/3.14/bin/python3",
                "/Library/Frameworks/Python.framework/Versions/3.13/bin/python3",
                "/Library/Frameworks/Python.framework/Versions/3.12/bin/python3",
                "/Library/Frameworks/Python.framework/Versions/3.11/bin/python3",
                "/opt/homebrew/bin/python3",
                "/usr/local/bin/python3"
            ];
            for (const p of candidates) {
                try { if (fs.existsSync(p)) { _pythonCache = p; return resolve(); } } catch (e) {}
            }
        }

        let cp;
        try { cp = _req("child_process"); } catch (e) { resolve(); return; }
        const launchers = IS_WIN ? ["py -3", "py", "python", "python3"] : ["python3", "python"];
        let i = 0;
        const tryNext = () => {
            if (i >= launchers.length) { resolve(); return; }
            const launcher = launchers[i++];
            try {
                cp.exec(`${launcher} -c "import sys;print(sys.executable)"`,
                    { timeout: 15000, windowsHide: true },
                    (err, stdout) => {
                        const p = (stdout || "").trim();
                        if (!err && p) { try { if (fs.existsSync(p)) { _pythonCache = p; return resolve(); } } catch (e) {} }
                        tryNext();
                    });
            } catch (e) { tryNext(); }
        };
        tryNext();
    });
}

function extDir()     { return csInterface.getSystemPath(SystemPath.EXTENSION); }
function scriptsDir() { return path.join(extDir(), "scripts"); }

// Bundled zero-setup engine (whisper.cpp). Loaded lazily, cached. Returns null
// if unavailable so callers can fall back to the Python engine.
let _WCPP, _WCPP_ERR = "";
function wcpp() {
    if (_WCPP === undefined) {
        try {
            _WCPP = _req(path.join(extDir(), "js", "whispercpp.js"));
            try {
                _WCPP.setLogger({ file: path.join(path.dirname(_WCPP.modelsDir()), "subsper.log") });
                _WCPP.dbg("=== Subsper extension start " + new Date().toISOString() + " | " + process.platform + " ===");
            } catch (e) {}
        }
        catch (e) { console.error("[Subsper] whispercpp load failed:", e); _WCPP = null; _WCPP_ERR = (e && e.message) || String(e); }
    }
    return _WCPP;
}

// ── Run Python script ─────────────────────────────────────────────────────
// Augment PATH so spawned tools (python/ffmpeg) are found. On macOS, GUI apps
// launch without Homebrew dirs in PATH, so prepend them (':' separator). On
// Windows we must NOT touch PATH — its separator is ';' and the real PATH
// already has Python/ffmpeg; prepending POSIX paths would CORRUPT it (this was
// the root cause of "Could not run Python" on Windows).
function spawnEnv() {
    // Force Python to emit UTF-8 on stdout — otherwise on Windows it uses the
    // locale codepage (e.g. cp1254) and Turkish/Unicode text comes back as  .
    const utf8 = { PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" };
    if (settings && settings.hfToken) { utf8.HF_TOKEN = settings.hfToken; utf8.HUGGING_FACE_HUB_TOKEN = settings.hfToken; }
    if (IS_WIN) {
        // The Electron/CEP process captures PATH at launch, so an ffmpeg
        // installed AFTER we started isn't found until restart ("not installed"
        // even though it works). Prepend the common install dirs so a fresh
        // winget/choco/manual ffmpeg is picked up immediately.
        const la = process.env.LOCALAPPDATA || "";
        const pf = process.env.PROGRAMFILES || "C:\\Program Files";
        const extra = [
            la && (la + "\\Microsoft\\WinGet\\Links"),
            "C:\\ProgramData\\chocolatey\\bin",
            pf + "\\ffmpeg\\bin",
            "C:\\ffmpeg\\bin",
        ].filter(Boolean);
        const cur = process.env.PATH || "";
        const missing = extra.filter(p => cur.toLowerCase().indexOf(p.toLowerCase()) === -1);
        const path2 = missing.length ? (missing.join(";") + ";" + cur) : cur;
        return Object.assign({}, process.env, utf8, { PATH: path2 });
    }
    const extra = "/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/local/sbin";
    const cur   = process.env.PATH || "";
    return Object.assign({}, process.env, utf8, {
        PATH: cur.includes("/opt/homebrew") ? cur : extra + ":" + cur
    });
}

// macOS Rosetta: when this app runs translated (x64) on Apple Silicon, a child
// Python would also launch x64 and FAIL to import arm64-installed packages
// (torch etc.) — the exact reason "punctuation installed but won't run". Wrap
// python with `arch -arm64` so it runs natively and matches the packages that
// installPackage/ensurePyPackage installed. Cached.
let _rosetta;
function isRosetta() {
    if (_rosetta === undefined) {
        _rosetta = false;
        try {
            if (process.platform === "darwin")
                _rosetta = require("child_process")
                    .execSync("sysctl -n sysctl.proc_translated 2>/dev/null", { encoding: "utf8" })
                    .trim() === "1";
        } catch (e) { _rosetta = false; }
    }
    return _rosetta;
}
function archWrap(cmd, args) {
    if (process.platform === "darwin" && /python/.test(cmd) && isRosetta())
        return { cmd: "arch", args: ["-arm64", cmd, ...args] };
    return { cmd, args };
}

function runPython(scriptName, args, onStderr) {
    return new Promise(resolve => {
        const py     = findPython();
        const script = path.join(scriptsDir(), scriptName);
        const w      = archWrap(py, [script, ...args]);
        const proc   = spawn(w.cmd, w.args, { env: spawnEnv() });
        const STDERR_CAP = 32000;
        let stdout = "", stderr = "";
        // setEncoding("utf8") decodes correctly even when a multi-byte char is
        // split across chunks (raw .toString() per chunk can corrupt them).
        proc.stdout.setEncoding("utf8");
        proc.stderr.setEncoding("utf8");
        proc.stdout.on("data", d => { stdout += d; });
        proc.stderr.on("data", d => {
            const chunk = d;
            if (onStderr) onStderr(chunk);
            stderr += chunk;
            if (stderr.length > STDERR_CAP) stderr = stderr.slice(-STDERR_CAP);
        });
        proc.on("close", code => {
            try   { resolve(JSON.parse(stdout.trim())); }
            catch { resolve({ success: false, error: stderr.trim() || `Script exited with code ${code}` }); }
        });
        proc.on("error", err =>
            resolve({ success: false, error: `Could not start Python: ${err.message}\nMake sure Python 3 is installed (python.org).` })
        );
    });
}

function runCmd(cmd, args) {
    const w = archWrap(cmd, args);
    cmd = w.cmd; args = w.args;
    return new Promise(resolve => {
        const proc = spawn(cmd, args, { env: spawnEnv() });
        let out = "", err = "";
        proc.stdout.on("data", d => { out += d.toString(); });
        proc.stderr.on("data", d => { err += d.toString(); });
        proc.on("close", code => resolve({ code, out, err }));
        proc.on("error", e    => resolve({ code: 1, out: "", err: e.message }));
    });
}

// Auto-install a Python package on first feature use (like the model downloads
// itself). Returns true on success. --user so no sudo needed. runCmd handles the
// Rosetta arch wrap so the install matches the interpreter that imports it.
async function ensurePyPackage(pipName) {
    const py = findPython();
    if (!py) return false;
    const res = await runCmd(py, ["-m", "pip", "install", "--user", pipName]);
    return res.code === 0;
}

// ── ExtendScript ──────────────────────────────────────────────────────────
function loadHostJSX() {
    return new Promise(resolve => {
        const jsxPath = path.join(extDir(), "jsx", "host.jsx");
        // Read the host source with Node and inject it straight into the
        // ExtendScript engine. This redefines every function on each call and
        // is IMMUNE to (a) the ScriptPath "load once per engine" cache and
        // (b) $.evalFile path quirks on macOS that silently keep stale code.
        try {
            const src = fs.readFileSync(jsxPath, "utf8");
            csInterface.evalScript(src, () => resolve());
        } catch (e) {
            // Fallback: evalFile by path if the read ever fails
            const p = jsxPath.replace(/\\/g, "/");
            csInterface.evalScript(`$.evalFile("${p}")`, () => resolve());
        }
    });
}

function evalScript(script) {
    return new Promise(resolve => {
        csInterface.evalScript(script, result => {
            try   { resolve(JSON.parse(result)); }
            catch { resolve({ success: false, error: "ExtendScript error: " + result }); }
        });
    });
}

// ── UI helpers ────────────────────────────────────────────────────────────
function setStatus(msg, type = "info") {
    statusBar.textContent = msg;
    statusBar.className   = `status-bar ${type}`;
}

function showProgress(on) {
    progressBar.className = on ? "progress-bar run" : "progress-bar";
}

function setSilenceStatus(msg, type = "info") {
    const el = $("silence-status-bar");
    if (!el) return;
    el.textContent = msg;
    el.className   = `status-bar ${type}`;
}

function showSilenceProgress(on) {
    const el = $("silence-progress-bar");
    if (!el) return;
    el.className = on ? "progress-bar run" : "progress-bar";
}

// Edit tab shares the silence status bar (both live in panel-ed-work)
function setEditStatus(msg, type)   { setSilenceStatus(msg, type); }
function showEditProgress(on)        { showSilenceProgress(on); }

// Audio tab status
function setAudioStatus(msg, type = "info") {
    const el = $("audio-status-bar");
    if (!el) return;
    el.textContent = msg;
    el.className   = `status-bar ${type}`;
}
function showAudioProgress(on) {
    const el = $("audio-progress-bar");
    if (!el) return;
    el.className = on ? "progress-bar run" : "progress-bar";
}

function showToast(msg, type = "info", ms = 3500) {
    toastEl.textContent = msg;
    toastEl.className   = `toast show ${type}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.className = "toast"; }, ms);
}

function copyText(txt) {
    if (navigator.clipboard) {
        navigator.clipboard.writeText(txt).then(() => showToast("Copied!", "success", 1500));
    }
}

// Reveal a file in Finder / Explorer / file manager — cross-platform. The old
// code used macOS-only `open -R`, which throws (unhandled) on Windows/Linux.
function revealInFolder(p) {
    if (!p) return;
    try {
        let cmd, args;
        if (process.platform === "win32")      { cmd = "explorer"; args = ["/select,", p]; }
        else if (process.platform === "darwin") { cmd = "open";     args = ["-R", p]; }
        else                                     { cmd = "xdg-open"; args = [path.dirname(p)]; }
        const child = spawn(cmd, args);
        // explorer.exe returns exit code 1 even on success — ignore. Just swallow
        // spawn errors so a missing file-manager never crashes the panel.
        child.on("error", () => {});
    } catch (e) {}
}

// ── Two-level navigation ──────────────────────────────────────────────────
// Main tabs with work/settings sub-tabs (prefixes), plus the prefix-less Setup.
const MAIN_TABS = ["transcribe", "edit", "audio", "setup"];
const TAB_PREFIX = { transcribe: "tx", edit: "ed", audio: "au", setup: "su" };

let currentMainTab = "transcribe";
let currentSubTab  = { transcribe: "work", edit: "work", audio: "work", setup: "main" };

const ALL_PANELS = ["tx-work", "tx-settings", "ed-work", "ed-settings", "au-work", "au-settings", "su-main", "setup"];

function showCurrentPanel() {
    ALL_PANELS.forEach(p => { const el = $(`panel-${p}`); if (el) el.style.display = "none"; });
    let target;
    if (currentMainTab === "setup") target = currentSubTab.setup === "install" ? "panel-setup" : "panel-su-main";
    else {
        const prefix = TAB_PREFIX[currentMainTab];
        const sub = currentSubTab[currentMainTab] === "settings" ? "settings" : "work";
        target = `panel-${prefix}-${sub}`;
    }
    const el = $(target); if (el) el.style.display = "flex";
}

function switchMainTab(name) {
    currentMainTab = name;
    MAIN_TABS.forEach(t => { const tab = $(`tab-${t}`); if (tab) tab.classList.toggle("active", t === name); });
    ["transcribe", "edit", "audio", "setup"].forEach(t => {
        const bar = $(`sub-tabs-${t}`);
        if (bar) bar.style.display = name === t ? "flex" : "none";
    });
    showCurrentPanel();
    if (name === "setup") {
        if (currentSubTab.setup === "install") runDiagnostics();
        else try { initSettingsUI(); } catch (e) {}
    }
    if (name === "edit"  && currentSubTab.edit  === "settings") initEditSettingsUI();
    if (name === "audio" && currentSubTab.audio === "settings") initAudioSettingsUI();
    if (name === "transcribe" && currentSubTab.transcribe === "settings") initSettingsUI();
}

function switchSubTab(mainTab, sub) {
    currentSubTab[mainTab] = sub;
    const prefix = TAB_PREFIX[mainTab];
    const subs = mainTab === "setup" ? ["main", "install"] : ["work", "settings"];
    subs.forEach(s => {
        const btn = $(`sub-tab-${prefix}-${s}`);
        if (btn) btn.classList.toggle("active", s === sub);
    });
    showCurrentPanel();
    if (sub === "settings") {
        if (mainTab === "transcribe") initSettingsUI();
        if (mainTab === "edit")       initEditSettingsUI();
        if (mainTab === "audio")      initAudioSettingsUI();
    }
    if (mainTab === "setup") {
        if (sub === "install") runDiagnostics();
        else initSettingsUI();   // Interface + AI fields live here now
    }
}

// Keep compatibility for error handlers that call switchTab("setup")
function switchTab(name) { switchMainTab(name); }

// ── Edit (cut automation) settings init ───────────────────────────────────
function initEditSettingsUI() {
    const set = (id, v) => { const e = $(id); if (e) e.value = v; };
    const txt = (id, v) => { const e = $(id); if (e) e.textContent = v; };
    set("set-silthr", settings.silenceThreshold);
    txt("silthr-val", settings.silenceThreshold + " dB");
    set("set-sildur", settings.silenceMinDur);
    txt("sildur-val", settings.silenceMinDur.toFixed(1) + "s");
    set("set-silpad", settings.silencePad);
    txt("silpad-val", (+settings.silencePad).toFixed(2) + "s");
    set("set-zoomamt", settings.zoomAmount);
    txt("zoomamt-val", settings.zoomAmount + "%");
    set("set-zoomstyle", settings.zoomStyle);
}

// ── Audio settings init ───────────────────────────────────────────────────
function initAudioSettingsUI() {
    const chk = (id, v) => { const e = $(id); if (e) e.checked = !!v; };
    const set = (id, v) => { const e = $(id); if (e) e.value = v; };
    const txt = (id, v) => { const e = $(id); if (e) e.textContent = v; };
    chk("set-audio-denoise", settings.audioDenoise);
    chk("set-audio-normalize", settings.audioNormalize);
    set("set-beepshift", settings.beepShift || 0); txt("beepshift-val", (settings.beepShift || 0) + " ms");
    set("set-beeppad",   settings.beepPad ?? 40); txt("beeppad-val", (settings.beepPad ?? 40) + " ms");
    set("set-beepduck",  settings.beepDuck || 0); txt("beepduck-val", (settings.beepDuck || 0) + "%");
    set("set-beepmode", settings.beepMode || "beep");
}

// ── Settings tab ──────────────────────────────────────────────────────────
function initSettingsUI() {
    const set = (id, v) => { const el = $(id); if (el) el.value = v; };
    const chk = (id, v) => { const el = $(id); if (el) el.checked = !!v; };
    const txt = (id, v) => { const el = $(id); if (el) el.textContent = v; };

    set("set-uilang", settings.uiLang);
    set("set-theme", settings.theme);
    set("set-engine", settings.engine);
    chk("set-diarize", settings.diarize);

    // Threads
    set("set-threads", settings.threads);
    txt("threads-val", settings.threads == 0 ? "Auto" : settings.threads);
    set("set-hwaccel", settings.hwAccel || "auto");
    set("set-hf-token", settings.hfToken || "");

    // Transcript clean-up
    set("set-punct-allowed", settings.punctAllowed !== undefined ? settings.punctAllowed : ".,?!:;\"'()[]{}-");
    set("set-dict", settings.customDict);
    set("set-prompt-words", settings.promptWords || "");
    updateDictCount();
    chk("set-autocleanup", settings.autoCleanup);
    chk("set-followplayhead", settings.followPlayhead !== false);
    set("set-bilingual-order", settings.bilingualOrder || "source-first");
    chk("set-filleron", settings.fillerOn);
    set("set-fillers", settings.fillerWords);
    // NOTE: HTML ids are set-profanity / set-profmode (a set-prof-list /
    // set-prof-mode mismatch here meant these never restored on reopen).
    set("set-profanity", settings.profanityList);
    set("set-profmode", settings.profanityMode);
    chk("set-prof-stem", settings.profStem !== false);

    // Model & Language now live in Settings and persist across sessions.
    set("model-select", settings.whisperModel || "turbo");
    set("lang-select",  settings.spokenLang   || "auto");

    // AI & API
    set("set-ai-provider", settings.aiProvider || "gemini");
    set("set-gemini-key", settings.geminiApiKey || "");
    set("set-openai-key", settings.openaiApiKey || "");
    set("set-anthropic-key", settings.anthropicApiKey || "");
    set("set-custom-url", settings.customApiUrl || "");
    set("set-custom-key", settings.customApiKey || "");
    if (typeof rebuildAiModelSelect === "function") rebuildAiModelSelect();
    if (typeof updateAiProviderUI === "function") updateAiProviderUI(settings.aiProvider || "gemini");

    chk("set-karaoke", settings.karaoke);
    const kHi = $("set-karaoke-hi"); if (kHi) kHi.value = "#" + (settings.karaokeHi || "FFE000");
    const kSub = $("karaoke-sub"); if (kSub) kSub.style.display = settings.karaoke ? "block" : "none";

    chk("set-autosplit", settings.autoSplit);
    const autoSub = $("autosplit-sub"); if (autoSub) autoSub.style.display = settings.autoSplit ? "block" : "none";
    set("set-cpl",   settings.maxCharsPerLine); txt("cpl-val",   settings.maxCharsPerLine);
    set("set-lines", settings.maxLines);        txt("lines-val", settings.maxLines);
    set("set-cps",   settings.maxCps);          txt("cps-val",   settings.maxCps);
    set("set-maxdur", settings.maxDur);         txt("maxdur-val", (+settings.maxDur).toFixed(1) + "s");

    chk("set-gap-fill", settings.gapFill);
    const gapSub = $("gap-fill-sub");
    if (gapSub) gapSub.style.display = settings.gapFill ? "block" : "none";
    set("set-gap-max", settings.gapMax);        txt("gap-fill-val", (+settings.gapMax).toFixed(1) + "s");

    renderStyleChips();
    updateStylePreview();
    if (settings.karaoke) startKaraokePreview(); else stopKaraokePreview();
}

// ── Style presets ─────────────────────────────────────────────────────────
function renderStyleChips() {
    const wrap = $("style-chips");
    if (!wrap) return;
    wrap.innerHTML = "";
    Object.keys(STYLE_PRESETS).forEach(key => {
        const p = STYLE_PRESETS[key];
        const chip = document.createElement("button");
        chip.className = "style-chip" + (settings.stylePreset === key ? " active" : "");
        chip.textContent = p.label;
        chip.onclick = () => {
            settings.stylePreset = key;
            saveSettings();
            renderStyleChips();
            updateStylePreview();
        };
        wrap.appendChild(chip);
    });
    const form = $("custom-style-form");
    if (form) {
        form.style.display = settings.stylePreset === "custom" ? "block" : "none";
        if (settings.stylePreset === "custom") populateCustomForm();
    }
}

function populateCustomForm() {
    const cs = { ...DEFAULT_CUSTOM_STYLE, ...(settings.customStyle || {}) };
    const el = (id, v) => { const e = $(id); if (e) e.value = v; };
    el("cust-primary", "#" + cs.primary);
    el("cust-outline", "#" + cs.outline);
    el("cust-size", cs.size);
    el("cust-ow", cs.outlineW);
    el("cust-align", cs.align);
    const txt = id => $(id);
    if (txt("cust-size-val"))  txt("cust-size-val").textContent  = cs.size;
    if (txt("cust-ow-val"))    txt("cust-ow-val").textContent    = cs.outlineW;
    const boldEl = $("cust-bold");  if (boldEl)  boldEl.checked  = cs.bold;
    const boxEl  = $("cust-box");   if (boxEl)   boxEl.checked   = cs.box;
}

function updateCustomStyle(key, value) {
    if (!settings.customStyle) settings.customStyle = { ...DEFAULT_CUSTOM_STYLE };
    settings.customStyle[key] = value;
    saveSettings();
    updateStylePreview();
}

function updateStylePreview() {
    const box = $("style-preview");
    const txt = $("style-preview-text");
    if (!box || !txt) return;
    const p = getActivePreset();

    box.style.alignItems = p.align === 8 ? "flex-start" : (p.align === 5 ? "center" : "flex-end");
    txt.style.fontFamily = p.font + ", sans-serif";
    txt.style.fontWeight = p.bold ? "800" : "500";
    txt.style.color      = "#" + p.primary;
    txt.style.fontSize   = Math.round(p.size / 3) + "px";

    const oc = "#" + p.outline;
    const w  = Math.max(1, Math.round(p.outlineW / 2));
    if (p.outlineW > 0) {
        txt.style.textShadow =
            `-${w}px -${w}px 0 ${oc}, ${w}px -${w}px 0 ${oc}, -${w}px ${w}px 0 ${oc}, ${w}px ${w}px 0 ${oc}` +
            (p.shadow ? `, 2px 2px 3px rgba(0,0,0,.7)` : "");
    } else {
        txt.style.textShadow = p.shadow ? "2px 2px 3px rgba(0,0,0,.7)" : "none";
    }

    if (p.box) {
        const opacity = (1 - p.boxAlpha / 255).toFixed(2);
        txt.style.background  = `rgba(0,0,0,${opacity})`;
        txt.style.padding     = "2px 7px";
        txt.style.borderRadius = "3px";
    } else {
        txt.style.background = "transparent";
        txt.style.padding    = "0";
    }
}

// ── Karaoke (Instagram/TikTok style word highlight) ───────────────────────
let _karaokeTimer = null;
function onKaraokeToggle(checked) {
    settings.karaoke = checked;
    saveSettings();
    const sub = $("karaoke-sub");
    if (sub) sub.style.display = checked ? "block" : "none";
    if (checked) startKaraokePreview(); else stopKaraokePreview();
}
function onKaraokeColor(hex) {
    settings.karaokeHi = hex.slice(1).toUpperCase();
    saveSettings();
    startKaraokePreview();
}
function stopKaraokePreview() {
    if (_karaokeTimer) { clearInterval(_karaokeTimer); _karaokeTimer = null; }
}
function startKaraokePreview() {
    const box = $("karaoke-preview");
    if (!box) return;
    stopKaraokePreview();
    const words = ["Kelime", "kelime", "vurgulu", "altyazı", "akışı"];
    box.innerHTML = words.map(w => `<span class="kw">${w}</span>`).join(" ");
    const hi = "#" + (settings.karaokeHi || "FFE000");
    const spans = box.querySelectorAll(".kw");
    let i = 0;
    const tick = () => {
        spans.forEach((s, si) => { s.style.color = si <= i ? hi : "#fff"; });
        i = (i + 1) % (words.length + 2);   // +2 = brief all-on pause before looping
    };
    tick();
    _karaokeTimer = setInterval(tick, 380);
}

function onGapFillChange() {
    settings.gapFill = $("set-gap-fill").checked;
    const sub = $("gap-fill-sub");
    if (sub) sub.style.display = settings.gapFill ? "block" : "none";
    saveSettings();
}

function onGapMaxChange(val) {
    settings.gapMax = parseFloat(val);
    const el = $("gap-fill-val"); if (el) el.textContent = settings.gapMax.toFixed(1) + "s";
    saveSettings();
}

function applyGapFill(segs, maxGap) {
    if (!segs || segs.length < 2) return segs;
    const result = segs.map(s => ({ ...s }));
    for (let i = 0; i < result.length - 1; i++) {
        const gap = result[i + 1].seqStart - result[i].seqEnd;
        if (gap > 0 && gap <= maxGap) {
            result[i].seqEnd = result[i + 1].seqStart;
            result[i].end    = result[i].start + (result[i].seqEnd - result[i].seqStart);
        }
    }
    return result;
}

// ── Smart subtitle splitting ──────────────────────────────────────────────
function applySmartSplit(segs, opt) {
    const maxChars = Math.max(10, opt.maxCharsPerLine * opt.maxLines);
    const out = [];
    for (const seg of segs) {
        const pieces = splitSegment(seg, opt, maxChars);
        for (const p of pieces) out.push(p);
    }
    out.forEach((s, i) => { s.id = i; });
    return out;
}

function splitSegment(seg, opt, maxChars) {
    const text = (seg.text || "").trim();
    const dur  = Math.max(0.001, seg.end - seg.start);
    const cps  = text.length / dur;
    const needs = dur > opt.maxDur || text.length > maxChars || cps > opt.maxCps;
    if (!needs || text.length <= 1) return [seg];

    const words = (seg.words && seg.words.length) ? seg.words : null;
    return words ? splitByWords(seg, words, opt, maxChars)
                 : splitByText(seg, text, opt, maxChars);
}

function splitByWords(seg, words, opt, maxChars) {
    // Guard: skip word objects without valid start/end timestamps
    const valid = words.filter(w => w != null && w.start != null && w.end != null);
    if (!valid.length) return splitByText(seg, (seg.text || "").trim(), opt, maxChars);

    const chunks = [];
    let cur = [];
    for (const w of valid) {
        const tentative = cur.concat([w]);
        const txt   = tentative.map(x => x.word || "").join(" ").trim();
        const start = tentative[0].start;
        const dur   = w.end - start;
        if (cur.length > 0 && (txt.length > maxChars || dur > opt.maxDur)) {
            chunks.push(cur);
            cur = [w];
        } else {
            cur.push(w);
        }
    }
    if (cur.length) chunks.push(cur);
    if (!chunks.length) return [seg];

    return chunks.map(ws => ({
        id:      seg.id,
        start:   ws[0].start,
        end:     ws[ws.length - 1].end,
        text:    ws.map(x => x.word || "").join(" ").replace(/\s+/g, " ").trim(),
        words:   ws,
        speaker: seg.speaker || null,
    }));
}

function splitByText(seg, text, opt, maxChars) {
    const byChars = Math.ceil(text.length / maxChars);
    const byDur   = Math.ceil((seg.end - seg.start) / opt.maxDur);
    const n       = Math.max(2, byChars, byDur);

    const words = text.split(/\s+/);
    const per   = Math.ceil(words.length / n);
    const groups = [];
    for (let i = 0; i < words.length; i += per) groups.push(words.slice(i, i + per));

    const total = seg.end - seg.start;
    const totalChars = text.length || 1;
    let cursor = seg.start;
    return groups.map(g => {
        const t = g.join(" ");
        const frac = t.length / totalChars;
        const start = cursor;
        const end = Math.min(seg.end, start + total * frac);
        cursor = end;
        return { id: seg.id, start, end, text: t, words: [], speaker: seg.speaker || null };
    });
}

// ── Silence detection ─────────────────────────────────────────────────────
// Extract the In/Out (or whole-timeline) audio to a WAV. Prefers the bundled
// engine (no Python); falls back to extract_audio.py only if the engine is absent.
async function extractTimelineWav(seqInfo) {
    const tmp = path.join(os.tmpdir(), `subsper_sil_${Date.now()}.wav`);
    const W = wcpp();
    if (W) {
        await W.extractClipsToWav(extDir(),
            { clips: seqInfo.clips, duration: seqInfo.duration }, tmp, { env: spawnEnv() });
        return tmp;
    }
    const clipsArg = JSON.stringify({ clips: seqInfo.clips, duration: seqInfo.duration });
    const ex = await runPython("extract_audio.py", [clipsArg, tmp]);
    if (!ex.success) throw new Error(ex.error || "Audio extraction failed.");
    return tmp;
}
// Detect silent gaps on a WAV. Prefers bundled ffmpeg; falls back to Python.
async function detectSilencesOnWav(wav) {
    const W = wcpp();
    if (W) return await W.detectSilence(extDir(), wav,
        settings.silenceThreshold, settings.silenceMinDur, { env: spawnEnv() });
    const res = await runPython("detect_silence.py",
        [wav, String(settings.silenceThreshold), String(settings.silenceMinDur)]);
    if (!res.success) throw new Error(res.error || "Silence detection failed.");
    return res.silences || [];
}

async function detectSilences() {
    const btn = $("silence-btn");
    if (btn) { btn.disabled = true; }
    setSilenceStatus("Reading timeline…", "info");
    showSilenceProgress(true);

    try {
        await loadHostJSX();
        const seqInfo = await evalScript("getSequenceInfo()");
        if (!seqInfo.success) {
            setSilenceStatus(seqInfo.error || "Error reading timeline", "error");
            showToast(seqInfo.error || "Error reading timeline", "error");
            return;
        }
        if (!seqInfo.clips || seqInfo.clips.length === 0) {
            setSilenceStatus("No audio clips on the timeline. Add a clip first.", "warning");
            return;
        }

        setSilenceStatus(`Analyzing ${seqInfo.duration.toFixed(1)}s for silences…`, "info");
        const tmpAudio = await extractTimelineWav(seqInfo);
        const silences = await detectSilencesOnWav(tmpAudio);
        try { if (fs.existsSync(tmpAudio)) fs.unlinkSync(tmpAudio); } catch {}

        if (silences.length === 0) {
            setSilenceStatus("No silences found. Try raising the threshold (e.g. -25 dB).", "warning");
            showToast("No silences found", "info");
            return;
        }

        const marks = silences.map(s => ({
            start: seqInfo.inTime + s.start,
            end:   seqInfo.inTime + s.end,
            dur:   s.dur,
        }));

        await evalScript("clearSilenceMarkers()");
        const addRes = await evalScript(`addSilenceMarkers('${JSON.stringify(marks).replace(/'/g, "\\'")}')`);

        if (addRes && addRes.success) {
            setSilenceStatus(`✓ Marked ${addRes.added} silence(s) on the timeline`, "success");
            showToast(`${addRes.added} silences marked on timeline`, "success");
        } else {
            const msg = (addRes && addRes.error) || "Could not add markers.";
            setSilenceStatus(msg, "error");
            showToast(msg, "error");
        }
    } catch (e) {
        setSilenceStatus(e.message, "error");
        showToast(e.message, "error", 5000);
    } finally {
        showSilenceProgress(false);
        if (btn) btn.disabled = false;
    }
}

// Shared: extract In/Out audio → return detected silence ranges in TIMELINE seconds
async function findSilenceRanges() {
    await loadHostJSX();
    const seqInfo = await evalScript("getSequenceInfo()");
    if (!seqInfo.success) throw new Error(seqInfo.error || "Error reading timeline");
    if (!seqInfo.clips || seqInfo.clips.length === 0) throw new Error("No audio clips on the timeline. Add a clip first.");

    const tmpAudio = await extractTimelineWav(seqInfo);
    const silences = await detectSilencesOnWav(tmpAudio);
    try { if (fs.existsSync(tmpAudio)) fs.unlinkSync(tmpAudio); } catch {}

    const ranges = silences.map(s => ({
        start: seqInfo.inTime + s.start,
        end:   seqInfo.inTime + s.end,
        dur:   s.dur,
    }));
    return { seqInfo, ranges };
}

// ── Silence auto-cut (ripple delete) ──────────────────────────────────────
// Experimental: razors at each silent boundary and ripple-deletes the gap on
// every track. Undo with Cmd/Ctrl+Z if a complex timeline desyncs.
async function cutSilences() {
    const btn = $("silence-cut-btn");
    if (btn) btn.disabled = true;
    setSilenceStatus("Analyzing audio for silences to cut…", "info");
    showSilenceProgress(true);
    try {
        const { ranges } = await findSilenceRanges();
        if (ranges.length === 0) {
            setSilenceStatus("No silences found to cut. Try raising the threshold.", "warning");
            showToast("No silences found", "info");
            return;
        }

        // Keep a little breathing room around speech: shrink each cut by padding
        const pad = Math.max(0, parseFloat(settings.silencePad) || 0);
        const cutRanges = ranges
            .map(r => ({ start: r.start + pad, end: r.end - pad }))
            .filter(r => r.end - r.start > 0.08);   // ignore tiny leftovers

        if (cutRanges.length === 0) {
            setSilenceStatus("Silences too short to cut after padding. Lower the padding in Settings.", "warning");
            return;
        }

        // Preview modal: user sees every gap and can uncheck the ones to keep.
        setSilenceStatus(`${cutRanges.length} silent gap(s) found — review & apply`, "info");
        showRangePreview("Cut silences (ripple delete)", cutRanges, async (chosen) => {
            const total = chosen.reduce((a, r) => a + (r.end - r.start), 0);
            setSilenceStatus(`Cutting ${chosen.length} gap(s)…`, "info");
            showSilenceProgress(true);
            try {
                await evalScript("clearSilenceMarkers()");   // remove old markers if any
                const arg = JSON.stringify(chosen).replace(/'/g, "\\'");
                const r = await evalScript(`rippleDeleteRanges('${arg}')`);
                if (r && r.success && r.removed > 0) {
                    setSilenceStatus(`✓ Cut ${r.removed} item(s) across ~${total.toFixed(1)}s`, "success");
                    showToast(`Silences cut (${r.removed} segments removed)`, "success");
                } else {
                    // Fall back to markers so the user still gets value
                    const marks = ranges.map(r2 => ({ start: r2.start, end: r2.end, dur: r2.dur }));
                    await evalScript(`addSilenceMarkers('${JSON.stringify(marks).replace(/'/g, "\\'")}')`);
                    const why = (r && r.error) ? (" — " + r.error) : "";
                    setSilenceStatus("Couldn't ripple-cut on this timeline — marked instead" + why, "warning");
                    showToast("Ripple-cut failed; added markers instead. Send me the diagnostic.", "warning", 6000);
                    if (r && r.diag) console.log("[Whisper] ripple diag:", r.diag);
                }
            } finally { showSilenceProgress(false); }
        });
    } catch (e) {
        setSilenceStatus(e.message, "error");
        showToast(e.message, "error", 5000);
    } finally {
        showSilenceProgress(false);
        if (btn) btn.disabled = false;
    }
}

// ── Audio enhancement (denoise + loudness normalize) ──────────────────────
async function enhanceAudio() {
    const btn = $("enhance-btn");
    if (btn) btn.disabled = true;
    setAudioStatus("Reading timeline for audio enhancement…", "info");
    showAudioProgress(true);
    try {
        await loadHostJSX();
        const seqInfo = await evalScript("getSequenceInfo()");
        if (!seqInfo.success) { setAudioStatus(seqInfo.error || "Error reading timeline", "error"); return; }
        if (!seqInfo.clips || seqInfo.clips.length === 0) {
            setAudioStatus("No audio clips on the timeline. Add a clip first.", "warning");
            return;
        }

        setAudioStatus(`Extracting ${seqInfo.duration.toFixed(1)}s of audio…`, "info");
        const tmpRaw = await extractTimelineWav(seqInfo);

        const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
        const outWav = path.join(os.homedir(), "Desktop", `enhanced_audio_${stamp}.wav`);

        setAudioStatus("Enhancing audio (denoise + loudness normalize)…", "info");
        const W = wcpp();
        try {
            if (W) {
                await W.enhanceMedia(extDir(), tmpRaw, outWav,
                    settings.audioDenoise, settings.audioNormalize, { env: spawnEnv() });
            } else {
                const enh = await runPython("enhance_audio.py",
                    [tmpRaw, outWav, settings.audioDenoise ? "1" : "0", settings.audioNormalize ? "1" : "0"]);
                if (!enh.success) throw new Error(enh.error || "Audio enhancement failed.");
            }
        } catch (enhErr) {
            try { if (fs.existsSync(tmpRaw)) fs.unlinkSync(tmpRaw); } catch {}
            setAudioStatus(enhErr.message || "Audio enhancement failed.", "error");
            return;
        }
        try { if (fs.existsSync(tmpRaw)) fs.unlinkSync(tmpRaw); } catch {}

        const imp = await evalScript(`importAudioToProject('${outWav.replace(/'/g, "\\'")}')`);
        if (imp && imp.success) {
            setAudioStatus(`✓ Enhanced audio imported to project bin "${imp.bin || "Whisper Audio"}"`, "success");
            showToast("Enhanced audio added to project — drag it onto a track", "success", 5000);
        } else {
            setAudioStatus(`✓ Enhanced audio saved → ${outWav}`, "success");
            showToast("Enhanced WAV saved to Desktop", "success");
            revealInFolder(outWav);
        }
    } catch (e) {
        setAudioStatus(e.message, "error");
    } finally {
        showAudioProgress(false);
        if (btn) btn.disabled = false;
    }
}

// ── Auto Zoom (dynamic push-in) — Edit tab ────────────────────────────────
async function applyAutoZoom() {
    const btn = $("zoom-btn");
    if (btn) btn.disabled = true;
    setEditStatus("Applying Auto Zoom…", "info");
    showEditProgress(true);
    try {
        const opt = JSON.stringify({ amount: settings.zoomAmount, style: settings.zoomStyle });
        const r = await evalScript(`applyAutoZoom('${opt.replace(/'/g, "\\'")}')`);
        if (r && r.success && r.count > 0) {
            setEditStatus(`✓ Auto Zoom applied to ${r.count} clip(s)`, "success");
            showToast(`Auto Zoom added to ${r.count} clip(s)`, "success");
        } else {
            const err = (r && r.error) || "No clips to zoom in the In/Out range.";
            setEditStatus(err, (r && r.count === 0) ? "warning" : "error");
            if (r && r.diag && r.diag.length) {
                console.log("[Whisper] zoom diag:", r.diag);
                showToast("Auto Zoom note: " + r.diag[0] + " (send me this)", "warning", 7000);
            } else showToast(err, "warning");
        }
    } catch (e) {
        setEditStatus(e.message, "error");
    } finally {
        showEditProgress(false);
        if (btn) btn.disabled = false;
    }
}

// ── Transcript clean-up (dictionary · fillers · profanity) ────────────────
function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

// JavaScript's \b is ASCII-only, so /\bşey\b/ NEVER matches: a space and "ş"
// are both non-word characters, so there is no boundary between them. Every
// Turkish word starting or ending in ç/ğ/ı/ö/ş/ü was therefore invisible to the
// dictionary, the filler remover and the profanity filter — "şey", the most
// common Turkish filler of all, was silently skipped. Match on an explicit
// letter class with lookarounds instead.
const WORD_CHARS = "0-9A-Za-z_çğıöşüâîûÇĞIİÖŞÜÂÎÛ";

/* Whole-word matcher that understands Turkish letters. `trailing` is appended
 * OUTSIDE the closing lookaround (it is zero-width), for patterns that also
 * want to swallow the space or comma after the word. */
function wordRe(body, trailing, flags) {
    return new RegExp(`(?<![${WORD_CHARS}])(?:${body})(?![${WORD_CHARS}])${trailing || ""}`,
                      flags || "gi");
}

// Turkish needs locale-aware casing: plain toUpperCase turns "i" into "I"
// instead of "İ".
function upperIn(s, lang) { return lang === "tr" ? s.toLocaleUpperCase("tr") : s.toUpperCase(); }

/* Carry the matched word's capitalisation over to its replacement, so a
 * sentence-initial "Şarz" becomes "Şarj" and not "şarj". */
function matchCase(match, repl, lang) {
    const c = match.charAt(0);
    return c !== c.toLowerCase() ? upperIn(c, lang) + repl.slice(1) : repl;
}

/* Turkish softens a final k/p/t/ç to ğ/b/d/c before a vowel suffix, so a stem
 * list alone never matches the inflected form: "yarrak" does not appear
 * anywhere inside "yarrağı". Accept either consonant at the stem's end. */
function stemAlt(word) {
    const soft = { "k": "ğ", "p": "b", "t": "d", "ç": "c" };
    const last = word.slice(-1).toLowerCase();
    if (!soft[last]) return escRe(word);
    return escRe(word.slice(0, -1)) + "[" + escRe(last) + escRe(soft[last]) + "]";
}

// Tidy double spaces and stray spaces before punctuation after a removal
function tidyText(t) {
    return (t || "")
        .replace(/\s{2,}/g, " ")
        .replace(/\s+([,.!?;:])/g, "$1")
        .replace(/^[\s,]+/, "")
        .trim();
}

// Parse the custom dictionary textarea: "wrong=right" or "wrong => right" per line
function parseDictRules(str) {
    const rules = [];
    (str || "").split(/\r?\n/).forEach(line => {
        const m = line.split(/\s*=>?\s*/);   // splits on "=" or "=>"
        if (m.length >= 2) {
            const from = m[0].trim();
            const to   = m.slice(1).join("=").trim();
            if (from) rules.push({ from, to });
        }
    });
    return rules;
}

function updateDictCount() {
    const el = $("dict-rule-count");
    const errEl = $("dict-errors");
    if (!el) return;
    const raw = (settings.customDict || "").trim();
    if (!raw) { el.textContent = ""; if (errEl) errEl.textContent = ""; return; }
    const lines = raw.split(/\r?\n/).filter(l => l.trim());
    const rules = parseDictRules(raw);
    const invalid = lines.length - rules.length;
    el.textContent = rules.length + " rule" + (rules.length !== 1 ? "s" : "") + " active";
    if (errEl) errEl.textContent = invalid > 0 ? invalid + " invalid line" + (invalid !== 1 ? "s" : "") + " (missing =)" : "";
}

function applyPunctuationFilter(opts) {
    opts = opts || {};
    if (settings.punctAllowed === undefined || settings.punctAllowed === null) return 0;
    const allowed = settings.punctAllowed;
    const allPunct = ".,?!:;\"'()[]{}-";
    let stripRegexStr = "";
    for (const char of allPunct) {
        if (!allowed.includes(char)) stripRegexStr += escRe(char);
    }
    if (!stripRegexStr) return 0;
    const regex = new RegExp(`[${stripRegexStr}]`, "g");
    
    let changed = 0;
    segments.forEach(s => {
        if (!s.text) return;
        const old = s.text;
        // removing punctuation might leave double spaces, let's fix them
        s.text = s.text.replace(regex, "").replace(/\s{2,}/g, " ").trim();
        if (s.text !== old) changed++;
    });
    if (changed > 0 && !opts.silent) {
        renderSegments();
        if (selectedIndex >= 0) selectSegment(selectedIndex);
    }
    return changed;
}

function applyDictionary(opts) {
    opts = opts || {};
    const rules = parseDictRules(settings.customDict);
    if (!rules.length) { if (!opts.silent) showToast("No dictionary rules yet (add them in Settings)", "info", 2500); return 0; }
    let count = 0;
    const lang = proofLang();
    for (const seg of segments) {
        let t = seg.text || "";
        for (const r of rules) {
            const re = wordRe(escRe(r.from));
            t = t.replace(re, m => { count++; return matchCase(m, r.to, lang); });
        }
        seg.text = t;
    }
    if (!opts.silent) { renderSegments(); reselect(); showToast(`Dictionary applied — ${count} fix(es)`, "success"); }
    return count;
}

function getFillerList() {
    let list = settings.fillerOn ? BUILTIN_FILLERS.slice() : [];
    (settings.fillerWords || "").split(/[,\n]/).forEach(w => { w = w.trim(); if (w) list.push(w); });
    // longest first so phrases match before their sub-words
    return list.filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => b.length - a.length);
}

function removeFillers(opts) {
    opts = opts || {};
    const list = getFillerList();
    if (!list.length) { if (!opts.silent) showToast("No filler words configured", "info", 2500); return 0; }
    const re = wordRe(list.map(escRe).join("|"), "[\\s,]*");
    let count = 0;
    for (const seg of segments) {
        let t = (seg.text || "");
        t = t.replace(re, () => { count++; return ""; });
        seg.text = capFirst(tidyText(t));
    }
    if (!opts.silent) { renderSegments(); reselect(); showToast(`Removed ${count} filler word(s)`, "success"); }
    return count;
}

function censorProfanity(opts) {
    opts = opts || {};
    let list = BUILTIN_PROFANITY.slice();
    (settings.profanityList || "").split(/[,\n]/).forEach(w => { w = w.trim(); if (w) list.push(w); });
    list = list.filter((v, i, a) => a.indexOf(v) === i);
    if (!list.length) { if (!opts.silent) showToast("No profanity words configured", "info", 2500); return 0; }
    // profStem: also match inflected forms — root + up to 6 letters of suffix
    // (siktirin, götünü…). stemAlt additionally accepts the softened final
    // consonant, without which "yarrağı" and "amcığı" walked straight past the
    // filter. The suffix must be consumed, not just tolerated: the closing
    // lookaround is what stops "göt" matching inside "götü" and leaving a
    // dangling "ü" behind.
    const stem = settings.profStem !== false;
    // The alternation must be grouped before the suffix, or the suffix would
    // only apply to the last word in the list.
    // 8, not 6: Turkish agglutinates, and very common forms like "siktiğimin"
    // carry a seven-letter tail. Under-censoring is the worse failure here —
    // the user trusts the filter and publishes — and anyone who finds it too
    // eager can turn stemming off.
    const body = "(?:" + list.map(w => (stem ? stemAlt(w) : escRe(w))).join("|") + ")"
               + (stem ? "[a-zçğıöşüâîû]{0,8}" : "");
    const re = wordRe(body);
    let count = 0;
    const mode = settings.profanityMode || "asterisk";
    const censorWord = (m) => {
        const n = m.length;
        if (mode === "remove") return "—";
        if (mode === "first")  return "*" + m.slice(1);                       // *öt
        if (mode === "middle" && n >= 3) return m[0] + "*".repeat(n - 2) + m[n - 1]; // g*t
        return m[0] + "*".repeat(Math.max(1, n - 1));                          // s*** (default)
    };
    for (const seg of segments) {
        seg.text = (seg.text || "").replace(re, m => { count++; return censorWord(m); });
    }
    if (!opts.silent) { renderSegments(); reselect(); showToast(`Censored ${count} word(s)`, "success"); }
    return count;
}

// ── Offline proofreader — spelling + punctuation, no AI ───────────────────
// Deterministic rule pass that works with the network off, unlike the AI
// grammar action. Only unambiguous fixes belong here; anything that needs the
// meaning weighed (Turkish "de/da" and "ki", proper nouns, mishearings) stays
// with the AI pass.

const PROOF_TYPOS_TR = {
    "herkez": "herkes", "herkezin": "herkesin", "herkeze": "herkese", "herkezi": "herkesi",
    "her kes": "herkes", "hiç bir": "hiçbir", "bir kaç": "birkaç", "bir çok": "birçok",
    "her hangi": "herhangi", "pekçok": "pek çok", "herşey": "her şey", "birşey": "bir şey",
    "yada": "ya da", "yalnış": "yanlış", "yalnışlık": "yanlışlık", "yanlız": "yalnız",
    "deyil": "değil", "şarz": "şarj", "süpriz": "sürpriz", "orjinal": "orijinal",
    "klavuz": "kılavuz", "pantalon": "pantolon", "eşortman": "eşofman", "mütiş": "müthiş",
    "kirbit": "kibrit", "traş": "tıraş", "ünvan": "unvan", "makina": "makine",
};

const PROOF_TYPOS_EN = {
    "teh": "the", "adn": "and", "recieve": "receive", "seperate": "separate",
    "definately": "definitely", "occured": "occurred", "untill": "until",
    "alot": "a lot", "wich": "which", "thier": "their", "becuase": "because",
    "accomodate": "accommodate", "neccessary": "necessary", "goverment": "government",
    "publically": "publicly",
};

function proofLang() {
    const l = String(lastLanguage || "").toLowerCase();
    if (l.startsWith("tr")) return "tr";
    if (l && !l.startsWith("auto")) return "en";
    const sample = segments.slice(0, 60).map(s => s.text || "").join(" ");
    return /[çğışöüÇĞİŞÖÜ]/.test(sample) ? "tr" : "en";
}

function proofPunct(t) {
    return t
        .replace(/\s+/g, " ")                       // collapse runs of whitespace
        .replace(/\s+([,.!?;:…])/g, "$1")           // no space BEFORE punctuation
        .replace(/([!?])\1+/g, "$1")                // !!! → !
        .replace(/,{2,}/g, ",")                     // ,, → ,
        .replace(/\.{4,}/g, "...")                  // .... → ...
        .replace(/([,;:])(?=[^\s\d])/g, "$1 ")      // space AFTER , ; : — but not in 1,5 / 10:30
        .replace(/([.!?…])(?=\p{L})/gu, "$1 ")      // "Dr.Ahmet" → "Dr. Ahmet"; digits stay (3.14)
        .replace(/\(\s+/g, "(").replace(/\s+\)/g, ")")
        .trim();
}

function proofCaps(t, lang, startsSentence) {
    t = t.replace(/([.!?…]\s+)(\p{Ll})/gu, (m, p, c) => p + upperIn(c, lang));
    if (startsSentence) t = t.replace(/^(\p{Ll})/u, c => upperIn(c, lang));
    if (lang === "en") t = t.replace(wordRe("i", "", "g"), "I");
    return t;
}

function applyProofread(opts) {
    opts = opts || {};
    const lang  = proofLang();
    const typos = lang === "tr" ? PROOF_TYPOS_TR : PROOF_TYPOS_EN;
    const rules = Object.keys(typos).map(k => ({ re: wordRe(escRe(k)), to: typos[k] }));

    let spell = 0, punct = 0, caps = 0, touched = 0;
    segments.forEach((seg, i) => {
        const before = seg.text || "";
        if (!before.trim()) return;
        let t = before;

        for (const r of rules) t = t.replace(r.re, m => { spell++; return matchCase(m, r.to, lang); });

        const afterSpell = t;
        t = proofPunct(t);
        if (t !== afterSpell) punct++;

        // A segment only opens a sentence when the previous one closed one —
        // mid-sentence continuations keep their lowercase start. The previous
        // segment has already been corrected by this same pass.
        const prev = i > 0 ? (segments[i - 1].text || "").trim() : "";
        const afterPunct = t;
        t = proofCaps(t, lang, i === 0 || /[.!?…]$/.test(prev));
        if (t !== afterPunct) caps++;

        if (t !== before) { seg.text = t; touched++; }
    });

    if (!opts.silent) {
        renderSegments(); reselect();
        const isTr = settings.uiLang === "tr";
        if (!touched) showToast(isTr ? "Yazım ve noktalama zaten temiz" : "Spelling & punctuation already clean", "info", 2500);
        else {
            const msg = isTr
                ? `${spell} yazım · ${punct} noktalama · ${caps} büyük harf (${touched} satır)`
                : `${spell} spelling · ${punct} punctuation · ${caps} capitalisation (${touched} line(s))`;
            setStatus(msg, "success");
            showToast(msg + (isTr ? " — geri almak için Cmd/Ctrl+Z" : " — Cmd/Ctrl+Z to undo"), "success", 5000);
        }
    }
    return spell + punct + caps;
}

function cleanAll() {
    $("clean-menu").style.display = "none";
    if (segments.length === 0) { showToast("Nothing to clean yet", "info", 2000); return; }
    const d = applyDictionary({ silent: true });
    const f = removeFillers({ silent: true });
    const p = censorProfanity({ silent: true });
    const s = applyProofread({ silent: true });
    renderSegments(); reselect();
    setStatus(`Cleaned — ${d} dictionary · ${f} fillers · ${p} censored · ${s} proofread`, "success");
    showToast(`Clean-up done (${d}+${f}+${p}+${s})`, "success");
}

function reselect() { if (selectedIndex >= 0) selectSegment(selectedIndex); }
function capFirst(t) { return t ? t.charAt(0).toUpperCase() + t.slice(1) : t; }

function toggleCleanMenu() {
    const m = $("clean-menu");
    m.style.display = (m.style.display === "none" || !m.style.display) ? "block" : "none";
}
function cleanMenuAction(which) {
    $("clean-menu").style.display = "none";
    if (segments.length === 0) { showToast("Nothing to clean yet", "info", 2000); return; }
    if (which === "dict")  applyDictionary();
    if (which === "filler") removeFillers();
    if (which === "prof")  censorProfanity();
    if (which === "proof") applyProofread();
    if (which === "punct") {
        const n = applyPunctuationFilter();
        showToast(n > 0 ? `Punctuation filtered (${n} line(s))` : "No punctuation to change", n > 0 ? "success" : "info", 3000);
    }
    if (which === "all")   cleanAll();
}

// ── Find & Replace ────────────────────────────────────────────────────────
// Find works standalone (highlight + jump between matches). Replace is optional.
function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

let activeFindRegex   = null;   // set while a find query is active → drives highlighting
let findMatchSegs     = [];     // segment indices that contain a match
let findPos           = -1;     // pointer into findMatchSegs

function buildFindRegex() {
    const input = $("find-input");
    const find = input ? input.value : "";
    if (!find) return null;
    const caseEl = $("find-case");
    const flags = "g" + (caseEl && caseEl.checked ? "" : "i");
    return new RegExp(escapeRegExp(find), flags);
}

function toggleFindReplace() {
    const p = $("find-panel");
    const show = p.style.display === "none" || !p.style.display;
    if (show) {
        closeSyncPanel();
        p.style.display = "flex";
        $("find-input").focus();
        $("find-input").select();
        updateFindCount();
    } else {
        closeFindReplace();
    }
}

function closeFindReplace() {
    $("find-panel").style.display = "none";
    clearFindHighlight();
}

function toggleSyncPanel() {
    const sp = $("sync-panel");
    const show = sp.style.display === "none" || !sp.style.display;
    if (show) {
        closeFindReplace();
        sp.style.display = "flex";
        $("sync-input").focus();
    } else {
        closeSyncPanel();
    }
}

function closeSyncPanel() {
    if ($("sync-panel")) $("sync-panel").style.display = "none";
}

function toggleAiPanel() {
    const ap = $("ai-panel");
    const show = ap.style.display === "none" || !ap.style.display;
    if (show) {
        closeFindReplace();
        closeSyncPanel();
        ap.style.display = "flex";
    } else {
        closeAiPanel();
    }
}

function closeAiPanel() {
    if ($("ai-panel")) $("ai-panel").style.display = "none";
}

function fmtMMSS(sec) {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `[${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}]`;
}

function updateAiProviderUI(provider) {
    const ids = ["gemini", "openai", "anthropic", "custom"];
    ids.forEach(id => {
        const el = $("api-key-" + id);
        if (el) el.style.display = (id === provider) ? "block" : "none";
    });
}

// Sensible current default model per provider (July 2026). Used when the saved
// model doesn't belong to the selected provider (e.g. an OpenAI provider still
// carrying a "gemini-…" model would 404).
const DEFAULT_MODELS = {
    gemini:    "gemini-3.5-flash",
    openai:    "gpt-4o",
    anthropic: "claude-sonnet-4-5",
    custom:    "",
};
function modelForProvider(provider, chosen) {
    chosen = (chosen || "").trim();
    if (provider === "custom") return chosen;   // user types their own
    const looks = {
        gemini:    /^gemini/i,
        openai:    /^(gpt|o\d|text-|chatgpt)/i,
        anthropic: /^claude/i,
    }[provider];
    if (looks && looks.test(chosen)) return chosen;
    return DEFAULT_MODELS[provider] || chosen;
}

// Per-provider model choices — the AI-panel model list follows the provider,
// so a Gemini user never sees (or accidentally selects) a GPT model id.
const PROVIDER_MODELS = {
    gemini:    [["gemini-3.5-flash", "gemini-3.5-flash ★"], ["gemini-3.1-pro-preview", "gemini-3.1-pro"], ["gemini-3.1-flash-lite", "gemini-3.1-flash-lite"]],
    openai:    [["gpt-4o", "gpt-4o ★"], ["gpt-4o-mini", "gpt-4o-mini"]],
    anthropic: [["claude-sonnet-4-5", "claude-sonnet-4.5 ★"], ["claude-haiku-4-5", "claude-haiku-4.5"]],
    custom:    [["llama-3.3-70b-versatile", "llama-3.3-70b (Groq)"]],
};
function rebuildAiModelSelect() {
    const provider = settings.aiProvider || "gemini";
    const list = PROVIDER_MODELS[provider] || [];
    ["ai-panel-model", "set-gemini-model"].forEach(id => {
        const sel = $(id); if (!sel) return;
        sel.innerHTML = "";
        list.forEach(([v, label]) => {
            const o = document.createElement("option"); o.value = v; o.textContent = label; sel.appendChild(o);
        });
        const cur = (settings.geminiModel || "").trim();
        if (cur && !list.some(([v]) => v === cur)) {
            const o = document.createElement("option"); o.value = cur; o.textContent = cur; sel.appendChild(o);
        }
        const oc = document.createElement("option"); oc.value = "_custom"; oc.textContent = "Type custom…"; sel.appendChild(oc);
        sel.value = list.some(([v]) => v === cur) || (cur && sel.querySelector(`option[value="${cur}"]`)) ? cur : (list[0] ? list[0][0] : "_custom");
    });
}
function aiProviderChanged(v) {
    onSettingChange("aiProvider", v);
    const sp = $("set-ai-provider"); if (sp) sp.value = v;
    if (typeof updateAiProviderUI === "function") updateAiProviderUI(v);
    // switch to that provider's default model unless the saved one already fits
    settings.geminiModel = modelForProvider(v, settings.geminiModel);
    saveSettings();
    rebuildAiModelSelect();
    updateAiKeyHint();
}
function aiModelChanged(sel) {
    if (sel.value === "_custom") {
        sel.style.display = "none";
        const inp = $("ai-panel-custom-input");
        if (inp) { inp.style.display = "inline-block"; inp.focus(); }
        return;
    }
    onSettingChange("geminiModel", sel.value);
    rebuildAiModelSelect();
}
function aiCustomModelBlur(inp) {
    const m = (inp.value || "").trim();
    inp.style.display = "none";
    const sel = $("ai-panel-model"); if (sel) sel.style.display = "";
    if (m) { onSettingChange("geminiModel", m); }
    rebuildAiModelSelect();
    inp.value = "";
}
function updateAiKeyHint() {
    const hint = $("ai-key-hint"); if (!hint) return;
    const provider = settings.aiProvider || "gemini";
    const key = { gemini: settings.geminiApiKey, openai: settings.openaiApiKey,
                  anthropic: settings.anthropicApiKey, custom: settings.customApiKey }[provider] || "";
    hint.style.display = (key || provider === "custom") ? "none" : "flex";
}

async function askAi(type) {
    const provider = settings.aiProvider || "gemini";
    
    // Retrieve correct API key based on provider
    let key = "";
    if (provider === "gemini") key = settings.geminiApiKey || "";
    else if (provider === "openai") key = settings.openaiApiKey || "";
    else if (provider === "anthropic") key = settings.anthropicApiKey || "";
    else if (provider === "custom") key = settings.customApiKey || "";

    if (!key && provider !== "custom") {
        showError("Missing API Key", `Please enter your ${provider.toUpperCase()} API Key in the Settings panel under 'AI & API'.`);
        return;
    }
    
    if (segments.length === 0) {
        showToast("No transcription available to analyze.", "error");
        return;
    }
    
    // Build a NUMBERED transcript (1 line per segment) — so grammar/translate can
    // be mapped back 1:1 to segments by line number (no fragile word-diffing).
    let transcript = "";
    segments.forEach((seg, i) => {
        transcript += `${i + 1} [${fmtMMSS(seg.start)}] ${(seg.text || "").replace(/\s+/g, " ").trim()}\n`;
    });
    const lineCount = segments.length;

    const STRICT_RULE = "IMPORTANT: Return ONLY the raw requested data. Do not include conversational filler, introductions, or conclusions like 'Here is your analysis' or 'Great topic'.";
    const NUMBERED_RULE = `The transcript has ${lineCount} numbered lines (format: "N [MM:SS] text"). Return EXACTLY ${lineCount} lines, one per number, in the format "N. text" (the number, a period, then the text). Keep the SAME count and order — NEVER merge, split, reorder, add, or drop a line. Output ONLY these numbered lines, nothing else.`;
    
    let prompt = "";
    if (type === "summary") {
        prompt = `Analyze the following video transcript. Provide 3 catchy, SEO-friendly YouTube titles and a well-written description summary (2-3 paragraphs).\n\n${STRICT_RULE}\n\nTranscript:\n${transcript}`;
    } else if (type === "shorts") {
        prompt = `Analyze the following video transcript and identify the top 3 most engaging 30-60 second segments that would make viral YouTube Shorts. For each short, provide the start/end timecodes, a catchy title, and a brief explanation.\n\n${STRICT_RULE}\n\nTranscript:\n${transcript}`;
    } else if (type === "broll") {
        prompt = `Analyze the following video transcript. Suggest 5-10 strategic B-roll (stock footage) inserts to make the video more engaging. Provide the exact timecode for each insert and describe the visual clearly.\n\n${STRICT_RULE}\n\nTranscript:\n${transcript}`;
    } else if (type === "tags") {
        prompt = `Generate a comma-separated list of 15-20 highly searched YouTube tags and 3-5 relevant hashtags (#) for this video based on the transcript.\n\n${STRICT_RULE}\n\nTranscript:\n${transcript}`;
    } else if (type === "translate_en") {
        prompt = `Translate each subtitle line below into natural, fluent English. Localize idioms (don't translate word-for-word); keep each line a concise subtitle.\n\n${NUMBERED_RULE}\n\nTranscript:\n${transcript}`;
    } else if (type === "grammar") {
        const contextHint = (settings.promptWords && settings.promptWords.trim())
            ? ` Known correct terms / proper nouns to respect: ${settings.promptWords.trim()}.` : "";
        prompt = `You are a meticulous subtitle proofreader. For EACH line below, fix spelling, punctuation, capitalization and grammar; fix obvious speech-to-text mishearings using surrounding context; restore proper nouns, brand names and technical terms; make it read naturally and correctly. Do NOT translate, do NOT summarize or rephrase for style, do NOT add or remove content, and do NOT change the meaning. Keep each line about the same length (it is an on-screen subtitle). Reply in the SAME language as the line.${contextHint}\n\n${NUMBERED_RULE}\n\nTranscript:\n${transcript}`;
    }
    
    const outBox = $("ai-output");
    updateAiActions(null);   // hide contextual actions while thinking

    outBox.value = "Thinking...";
    const model = modelForProvider(provider, settings.geminiModel);
    const systemPrompt = "You are an expert video editor and YouTube strategist. Respond clearly using Markdown formatting. If the transcript is in Turkish, respond in Turkish unless asked to translate. If English, respond in English.";
    
    try {
        let text = "";
        
        if (provider === "gemini") {
            const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    systemInstruction: { parts: [{ text: systemPrompt }] }
                })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error?.message || "API Error");
            text = data.candidates?.[0]?.content?.parts?.[0]?.text || "No response generated.";
        } 
        else if (provider === "anthropic") {
            const res = await fetch("https://api.anthropic.com/v1/messages", {
                method: "POST",
                headers: { 
                    "Content-Type": "application/json", 
                    "x-api-key": key, 
                    "anthropic-version": "2023-06-01",
                    "anthropic-dangerously-allow-browser": "true" 
                },
                body: JSON.stringify({
                    model: model || "claude-sonnet-4-5",
                    max_tokens: 4096,
                    system: systemPrompt,
                    messages: [{ role: "user", content: prompt }]
                })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error?.message || "API Error");
            text = data.content?.[0]?.text || "No response generated.";
        }
        else {
            // OpenAI or Custom OpenAI-compatible
            const url = provider === "custom" && settings.customApiUrl ? settings.customApiUrl + "/chat/completions" : "https://api.openai.com/v1/chat/completions";
            const res = await fetch(url, {
                method: "POST",
                headers: { 
                    "Content-Type": "application/json", 
                    "Authorization": `Bearer ${key}`
                },
                body: JSON.stringify({
                    model: model || "gpt-4o",
                    messages: [
                        { role: "system", content: systemPrompt },
                        { role: "user", content: prompt }
                    ]
                })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error?.message || "API Error");
            text = data.choices?.[0]?.message?.content || "No response generated.";
        }
        
        outBox.value = text;
        updateAiActions(type);
    } catch (e) {
        console.error("AI Error:", e);
        outBox.value = "Error: " + e.message;
    }
}

// Show ONLY the follow-up actions that make sense for the last AI result:
// grammar/translate → Apply (+ SRT / send-to-Premiere for translate),
// shorts → hook-clip action. Everything else → no buttons (plain reading).
function updateAiActions(type) {
    const show = (id, on) => { const el = $(id); if (el) el.style.display = on ? "inline-flex" : "none"; };
    show("ai-apply-btn",   type === "grammar" || type === "translate_en");
    show("ai-srt-btn",     type === "translate_en");
    show("ai-bilingual-btn", type === "translate_en");
    show("ai-send-tr-btn", type === "translate_en");
    show("ai-clips-btn",   type === "shorts");
}

// Parse the AI's numbered output ("N. text") back onto segments 1:1. Robust —
// no word-diffing, so it can't dump everything into one segment.
function parseNumberedAi(text) {
    const map = {};        // segmentIndex(0-based) → corrected text
    (text || "").split(/\r?\n/).forEach(line => {
        const m = line.match(/^\s*(\d+)\s*[.)\]:|\-]\s*(.*)$/);
        if (!m) return;
        const n = parseInt(m[1], 10);
        if (!n || n < 1) return;
        let t = m[2].replace(/^\[\d{1,2}:\d{2}(:\d{2})?\]\s*/, "");   // strip a leftover [MM:SS]
        t = t.replace(/(\*\*|__|\*|_|`)/g, "").replace(/\s+/g, " ").trim();
        map[n - 1] = t;
    });
    return map;
}

function applyAiToSubtitles() {
    const text = $("ai-output").value;
    if (!text || text.includes("Error:") || text.startsWith("Thinking")) return;

    const map = parseNumberedAi(text);
    const keys = Object.keys(map);
    if (keys.length === 0) {
        // No numbered lines found → fall back to the old word-sync path.
        let plain = text.replace(/\[?\d{1,2}:\d{2}(:\d{2})?\]?/g, m => (m.includes("[") ? " " : m))
                        .replace(/(\*\*|__|\*|_)/g, "");
        $("sync-input").value = plain;
        doSyncText();
        return;
    }

    let changed = 0;
    keys.forEach(k => {
        const i = +k;
        if (segments[i] && map[k] && segments[i].text !== map[k]) { segments[i].text = map[k]; changed++; }
    });
    renderSegments();
    if (selectedIndex >= 0) selectSegment(selectedIndex);
    setStatus(`AI applied — ${changed} line(s) updated`, "success");
    showToast(`Applied to ${changed} subtitle line(s)`, "success");
}

function doSyncText() {
    if (segments.length === 0) return;
    const correctText = $("sync-input").value.trim();
    if (!correctText) return;
    
    setStatus("Syncing text with original timing...", "info");
    
    let Diff;
    try {
        Diff = require("diff");
    } catch (e) {
        showError("Missing dependency", "Please run 'npm install diff' in the app directory.");
        return;
    }

    const currentWords = [];
    const wordSegments = [];
    segments.forEach((seg, i) => {
        const words = (seg.text || "").split(/\s+/).filter(Boolean);
        words.forEach(w => {
            currentWords.push(w);
            wordSegments.push(i);
        });
    });

    const correctWords = correctText.split(/\s+/).filter(Boolean);
    const changes = Diff.diffArrays(currentWords, correctWords, { ignoreCase: true });

    const newSegText = new Array(segments.length).fill("");
    let oldIndex = 0;
    let lastValidSeg = 0;

    for (let i = 0; i < changes.length; i++) {
        const change = changes[i];
        if (change.removed) {
            if (i + 1 < changes.length && changes[i+1].added) {
                const addChange = changes[i+1];
                const targetSeg = oldIndex < wordSegments.length ? wordSegments[oldIndex] : lastValidSeg;
                for (const w of addChange.value) newSegText[targetSeg] += w + " ";
                i++;
            }
            oldIndex += change.count;
        } else if (change.added) {
            const targetSeg = lastValidSeg;
            for (const w of change.value) newSegText[targetSeg] += w + " ";
        } else {
            for (const w of change.value) {
                const targetSeg = wordSegments[oldIndex];
                newSegText[targetSeg] += w + " ";
                lastValidSeg = targetSeg;
                oldIndex++;
            }
        }
    }

    // Build a proposal of ONLY the changed lines and show a preview first —
    // nothing is applied until the user confirms.
    const proposal = [];
    segments.forEach((s, i) => {
        const nt = (newSegText[i] || "").replace(/\s+/g, " ").trim();
        if (nt && s.text !== nt) proposal.push({ i, oldText: s.text, newText: nt });
    });
    _syncProposal = proposal;
    showSyncPreview(proposal);
}

let _syncProposal = null;

function showSyncPreview(proposal) {
    const box = $("sync-preview");
    const list = $("sync-preview-list");
    if (!box || !list) {   // no preview UI → apply directly (fallback)
        applySyncProposal();
        return;
    }
    if (!proposal.length) {
        list.innerHTML = `<div class="sync-diff-empty">No changes — the text already matches.</div>`;
    } else {
        list.innerHTML = proposal.map(p => `
            <div class="sync-diff-row">
              <span class="sync-diff-i">#${p.i + 1}</span>
              <div class="sync-diff-texts">
                <div class="sync-diff-old">${escHtml(p.oldText)}</div>
                <div class="sync-diff-new">${escHtml(p.newText)}</div>
              </div>
            </div>`).join("");
    }
    const applyBtn = $("sync-apply-btn");
    if (applyBtn) applyBtn.textContent = proposal.length ? `Apply ${proposal.length} change(s)` : "Apply";
    box.style.display = "flex";
    if ($("sync-status")) $("sync-status").textContent = `${proposal.length} change(s) — review below, then Apply.`;
}

function applySyncProposal() {
    if (!_syncProposal) return;
    let n = 0;
    _syncProposal.forEach(p => { if (segments[p.i]) { segments[p.i].text = p.newText; n++; } });
    _syncProposal = null;
    if ($("sync-preview")) $("sync-preview").style.display = "none";
    renderSegments();
    if (selectedIndex >= 0) selectSegment(selectedIndex);
    setStatus(`Text synced — ${n} segment(s) updated.`, "success");
    showToast(`Applied (${n} updated)`, "success");
}

function cancelSyncPreview() {
    _syncProposal = null;
    if ($("sync-preview")) $("sync-preview").style.display = "none";
    if ($("sync-status")) $("sync-status").textContent = "Cancelled — nothing changed.";
}

function clearFindHighlight() {
    activeFindRegex = null;
    findMatchSegs = [];
    findPos = -1;
    renderSegments();
    if (selectedIndex >= 0) selectSegment(selectedIndex);
}

// Recompute match set + count as the user types
function updateFindCount() {
    const countEl = $("find-count");
    const re = buildFindRegex();
    activeFindRegex = re;
    findMatchSegs = [];
    findPos = -1;

    if (!re) {
        countEl.textContent = "—";
        countEl.classList.remove("zero");
        renderSegments();
        return;
    }
    let n = 0;
    segments.forEach((seg, idx) => {
        const m = (seg.text || "").match(re);
        if (m) { n += m.length; findMatchSegs.push(idx); }
    });
    countEl.textContent = n === 0 ? "no matches" : `${n} match${n !== 1 ? "es" : ""}`;
    countEl.classList.toggle("zero", n === 0);
    renderSegments();
}

// Jump to next / previous matching segment (find-only — no replace needed)
function findNext() {
    if (!findMatchSegs.length) { updateFindCount(); if (!findMatchSegs.length) { showToast("No matches", "info", 1500); return; } }
    findPos = (findPos + 1) % findMatchSegs.length;
    gotoFindMatch();
}
function findPrev() {
    if (!findMatchSegs.length) { updateFindCount(); if (!findMatchSegs.length) { showToast("No matches", "info", 1500); return; } }
    findPos = (findPos - 1 + findMatchSegs.length) % findMatchSegs.length;
    gotoFindMatch();
}
function gotoFindMatch() {
    const idx = findMatchSegs[findPos];
    if (idx == null) return;
    selectSegment(idx);
    const countEl = $("find-count");
    if (countEl) countEl.textContent = `${findPos + 1} / ${findMatchSegs.length}`;
}

function doReplaceAll() {
    const re = buildFindRegex();
    if (!re) { showToast("Type something to find first", "info", 2000); return; }
    const replEl = $("replace-input");
    const replacement = replEl ? replEl.value : "";

    let count = 0;
    for (const seg of segments) {
        const m = (seg.text || "").match(re);
        if (m) {
            count += m.length;
            seg.text = seg.text.replace(re, replacement);
        }
    }

    if (count === 0) { showToast("No matches found", "info", 2000); return; }

    clearFindHighlight();
    updateFindCount();
    showToast(`Replaced ${count} occurrence${count !== 1 ? "s" : ""}`, "success");
}

function reloadExtension() {
    window.location.href = 'index.html';
}

// ── SRT import ────────────────────────────────────────────────────────────
function importSRTFile() {
    const input = document.getElementById('srt-file-input');
    input.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const filePath = file.path || null;
        if (filePath) {
            try {
                const data = fs.readFileSync(filePath, 'utf8');
                _loadSRTData(data, file.name);
            } catch (err) {
                showToast('Could not read file: ' + err.message, 'error');
            }
        } else {
            const reader = new FileReader();
            reader.onload = (ev) => _loadSRTData(ev.target.result, file.name);
            reader.onerror = () => showToast('Could not read SRT file', 'error');
            reader.readAsText(file, 'utf-8');
        }
        input.value = '';
    };
    input.click();
}

function _loadSRTData(data, filename) {
    const parsed = parseSRT(data);
    if (!parsed.length) {
        showToast('No segments found in: ' + filename, 'error');
        return;
    }
    segments  = parsed;
    seqInTime = parsed[0].seqStart;
    renderSegments();
    updateSegCount();
    actionsBar.style.display = 'flex';
    sendBtn.disabled = false;
    setStatus(`Loaded ${parsed.length} segment(s) from ${filename}`, 'success');
    hideError();
    showToast(`${parsed.length} segments loaded from SRT`, 'success');
}

function srtTimeToSecs(t) {
    const clean = t.trim().replace(',', '.');
    const parts = clean.split(':');
    if (parts.length === 3) return +parts[0] * 3600 + +parts[1] * 60 + parseFloat(parts[2]);
    if (parts.length === 2) return +parts[0] * 60 + parseFloat(parts[1]);
    return parseFloat(clean);
}

function parseSRT(content) {
    const segs   = [];
    const blocks = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim().split(/\n\s*\n/);
    for (const block of blocks) {
        const lines = block.trim().split('\n');
        let tsIdx = lines.findIndex(l => l.includes('-->'));
        if (tsIdx === -1) continue;
        const m = lines[tsIdx].match(
            /(\d{1,2}:\d{2}:\d{2}[,.:]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[,.:]\d{1,3})/
        );
        if (!m) continue;
        const start = srtTimeToSecs(m[1]);
        const end   = srtTimeToSecs(m[2]);
        const text  = lines.slice(tsIdx + 1).join(' ').replace(/<[^>]+>/g, '').trim();
        if (!text) continue;
        segs.push({ id: segs.length, start, end, seqStart: start, seqEnd: end, text });
    }
    return segs;
}

// ── Play / pause ──────────────────────────────────────────────────────────
let _isPlaying = false;
let _playBusy  = false;

// Read the Premiere playhead in seconds (ticks-based, robust across builds).
function readPlayheadSecs() {
    return evalScript("(function(){try{var s=app.project.activeSequence;if(!s)return -1;var p=s.getPlayerPosition();if(!p)return -1;if(p.ticks!==undefined&&p.ticks!==null&&p.ticks!=='')return parseInt(p.ticks)/254016000000;if(typeof p.seconds==='number')return p.seconds;return -1;}catch(e){return -1;}})()")
        .then(r => { const v = (typeof r === "number") ? r : parseFloat(r); return isNaN(v) ? -1 : v; });
}

// STATELESS play/pause: instead of trusting a toggle flag (which desyncs the
// moment the user starts playback from Premiere itself), sample the playhead
// twice — moving → stop, still → play.
async function playPause() {
    if (_playBusy) return;
    _playBusy = true;
    const btn = $("playpause-btn");
    try {
        // Layer 1: ask QE directly (some builds expose player.isPlaying)
        let playing = null;
        const probe = await evalScript("wsIsPlayingProbe()");
        if (probe && probe.success && probe.known) playing = !!probe.playing;

        // Layer 2: playhead motion sampling
        if (playing === null) {
            const p1 = await readPlayheadSecs();
            await new Promise(r => setTimeout(r, 160));
            const p2 = await readPlayheadSecs();
            if (p1 >= 0 && p2 >= 0) playing = Math.abs(p2 - p1) > 0.0005;
        }

        // Layer 3: last resort — our own toggle flag
        if (playing === null) playing = _isPlaying;

        const res = await evalScript(playing ? "wsStop()" : "wsPlay()");
        if (!res || res.success === false) {
            const msg = (res && res.error) ? res.error : "Playback failed (QE unavailable?)";
            setStatus("Play/Pause failed: " + msg, "error");
            showToast("Play/Pause failed: " + msg, "error", 7000);
            return;
        }
        _isPlaying = !playing;
        if (btn) {
            btn.innerHTML = _isPlaying ? icon("pause") + "<span>" + t("btn_pause") + "</span>" : icon("play") + "<span>" + t("btn_play") + "</span>";
            btn.classList.toggle("playing", _isPlaying);
        }
    } finally { _playBusy = false; }
}

// ── Seek timeline + play ───────────────────────────────────────────────────
// Clicking a segment seeks AND starts playback.
async function seekToSegment(idx) {
    const seg = segments[idx];
    if (!seg) return;
    selectSegment(idx);
    await evalScript(`seekToTime(${seg.seqStart})`);
    // Start playing after seek — stateless wsPlay (seek always stops playback)
    const playRes = await evalScript("wsPlay()");
    _isPlaying = !!(playRes && playRes.success !== false);
    const btn = $("playpause-btn");
    if (btn) {
        btn.innerHTML = _isPlaying ? icon("pause") + "<span>" + t("btn_pause") + "</span>" : icon("play") + "<span>" + t("btn_play") + "</span>";
        btn.classList.toggle("playing", _isPlaying);
    }
}

function hideError() { $("error-panel").style.display = "none"; }

function showSRTSaved(srtPath) {
    const panel = $("srt-saved-panel");
    if (!panel) return;
    $("srt-saved-path").textContent = srtPath;
    panel.style.display = "block";
    $("srt-saved-reveal").onclick = () => revealInFolder(srtPath);
}

function hideSRTSaved() {
    const panel = $("srt-saved-panel");
    if (panel) panel.style.display = "none";
}

function showError(what, why, fixText, fixBtnLabel, fixAction) {
    $("error-panel").style.display = "block";
    $("error-what").textContent    = what;

    const whyEl = $("error-why"), fixEl = $("error-fix");
    if (why) {
        whyEl.style.display = "block";
        $("error-why-text").textContent = why;
    } else {
        whyEl.style.display = "none";
    }
    if (fixText) {
        fixEl.style.display = "block";
        $("error-fix-text").textContent = fixText;
        const btn = $("error-fix-btn");
        if (fixBtnLabel && fixAction) {
            btn.textContent   = fixBtnLabel;
            btn.style.display = "inline-block";
            btn.onclick       = fixAction;
        } else {
            btn.style.display = "none";
        }
    } else {
        fixEl.style.display = "none";
    }
}

function formatTime(secs) {
    const h  = Math.floor(secs / 3600);
    const m  = Math.floor((secs % 3600) / 60);
    const s  = Math.floor(secs % 60);
    const ms = Math.round((secs % 1) * 1000);
    return `${p2(h)}:${p2(m)}:${p2(s)},${p3(ms)}`;
}
const p2 = n => String(n).padStart(2, "0");
const p3 = n => String(n).padStart(3, "0");

// ── Error classifier ──────────────────────────────────────────────────────
function classifyError(raw) {
    if (!raw) return null;
    const e = raw.toLowerCase();

    if (e.includes("no active sequence")) return {
        what: "No active sequence found.",
        why:  "A sequence (timeline) must be open and active in Premiere.",
        fix:  "Open a sequence in the Timeline panel and try again.",
    };
    if (e.includes("timeline is empty")) return {
        what: "The timeline is empty.",
        why:  "There are no clips on the active sequence to transcribe.",
        fix:  "Add a video or audio clip to the timeline, then try again.",
    };
    if (e.includes("source media file not found")) return {
        what: "Source media file is offline.",
        why:  raw.split("\n").slice(0, 2).join(" "),
        fix:  "Re-link the offline clip in Premiere (right-click → Link Media), then try again.",
    };
    if (e.includes("ffmpeg not found at:") || (e.includes("ffmpeg") && e.includes("homebrew"))) return {
        what: "ffmpeg found but could not be executed.",
        why:  "Premiere launched without /opt/homebrew/bin in PATH.",
        fix:  "Reload the extension — it adds /opt/homebrew/bin to PATH automatically.",
        fixBtn: "Reload Extension",
        fixAct: () => reloadExtension(),
    };
    if (e.includes("ffmpeg") || (e.includes("no such file or directory") && !e.includes("media file"))) return {
        what: "Audio extraction failed — ffmpeg issue.",
        why:  raw.length < 300 ? raw : raw.slice(0, 300) + "…",
        fix:  "Make sure ffmpeg is installed:\n  brew install ffmpeg\nThen reload the extension.",
        fixBtn: "Go to Setup",
        fixAct: () => switchTab("setup"),
    };
    if (e.includes("could not start python") || e.includes("enoent")) return {
        what: "Python could not be started.",
        why:  "The extension requires Python 3 but it was not found.",
        fix:  "Install Python 3: https://python.org  or  brew install python3",
        fixBtn: "Go to Setup",
        fixAct: () => switchTab("setup"),
    };
    if (e.includes("whisperx") && (e.includes("not installed") || e.includes("no module"))) return {
        what: "WhisperX is not installed.",
        why:  "You selected the WhisperX engine but the package isn't available.",
        fix:  "Install it in Setup, or switch the engine in Settings to mlx/openai.",
        fixBtn: "Go to Setup",
        fixAct: () => switchTab("setup"),
    };
    if (e.includes("all engines failed")) return {
        what: "No transcription engine could run.",
        why:  raw,
        fix:  "Open Setup and install at least one engine (WhisperX, openai-whisper, or mlx-whisper).",
        fixBtn: "Go to Setup",
        fixAct: () => switchTab("setup"),
    };
    if (e.includes("no module named whisper") || e.includes("importerror")) return {
        what: "openai-whisper is not installed.",
        why:  "The transcription engine is missing.",
        fix:  "Run in Terminal:  pip3 install openai-whisper",
        fixBtn: "Install Now",
        fixAct: () => { switchTab("setup"); installPackage("openai-whisper", "whisper"); },
    };
    if (e.includes("no clips") || e.includes("extractions failed")) return {
        what: "Could not extract audio from the selected clips.",
        why:  raw,
        fix:  "Check that your In/Out points overlap a video/audio clip.",
    };
    return null;
}

// ── Transcription flow ────────────────────────────────────────────────────
async function startTranscription() {
    if (isRunning) return;
    isRunning = true;
    transcribeBtn.disabled   = true;
    sendBtn.disabled         = true;
    actionsBar.style.display = "none";
    hideError();

    const model    = $("model-select").value;
    const language = $("lang-select").value;

    try {
        setStatus("Reading timeline…", "info");
        showProgress(true);

        await loadHostJSX();   // always run the freshest host.jsx (defeats JSX cache)
        const seqInfo = await evalScript("getSequenceInfo()");
        if (!seqInfo.success) { handleError(seqInfo.error); return; }
        if (!seqInfo.clips || seqInfo.clips.length === 0) {
            handleError("No audio clips found on the timeline.\nAdd a video/audio clip, then try again.");
            return;
        }

        const scopeNote = seqInfo.wholeSequence ? "whole timeline" : "In/Out range";
        const tmpAudio = path.join(os.tmpdir(), `whisper_${Date.now()}.wav`);

        // Engine routing: bundled whisper.cpp (zero-setup) is the default. Python
        // (whisperx/mlx/openai) is used only when explicitly chosen or when
        // diarization (speaker labels) is on — the optional "Pro" path.
        const wantPython = settings.diarize ||
                           ["whisperx", "mlx", "openai"].indexOf(settings.engine) !== -1;
        const W = wantPython ? null : wcpp();
        // The silent Python fallback hid real problems (slow, no % progress,
        // "first run may download…" every time). If the BUILT-IN engine was
        // expected but failed to load, say so loudly instead.
        if (!wantPython && !W) {
            handleError("Built-in engine failed to load" + (_WCPP_ERR ? ":\n" + _WCPP_ERR : "") +
                "\nReinstall the app/extension, or pick a Pro engine in Settings.");
            return;
        }

        let txRes;
        if (W) {
            try {
                setStatus(`Extracting audio… (${seqInfo.duration.toFixed(1)}s — ${scopeNote})`, "info");
                await W.extractClipsToWav(extDir(),
                    { clips: seqInfo.clips, duration: seqInfo.duration }, tmpAudio, { env: spawnEnv() });
                if (!W.modelExists(model)) {
                    setStatus(`Downloading ${model} model… (one-time)`, "info");
                    await W.ensureModel(model, (frac, got, total, phase) =>
                        setStatus(phase ? "Reconnecting… (download resumes automatically)"
                                        : `Downloading ${model} model… ${Math.round(frac * 100)}%`, "info"));
                }
                setStatus(settings.uiLang === "tr" ? `Model yükleniyor (${model})…` : `Loading ${model} model…`, "info");
                const r = await W.transcribeWav({
                    appDir: extDir(), wavPath: tmpAudio, modelKey: model, language,
                    initialPrompt: settings.promptWords || "",
                    threads: settings.threads || 0,
                    forceCpu: settings.hwAccel === "cpu",
                    spawnOpts: { env: spawnEnv() },
                    onLog: s => {
                        if (s === "__ENGINE_STARTED__") { setStatus(settings.uiLang === "tr" ? "Transcribe başlıyor… 0%" : "Transcribing… 0%", "info"); return; }
                        const m = /progress\s*=\s*(\d+)\s*%/i.exec(s); if (m) setStatus(`Transcribing… ${m[1]}%`, "info");
                    },
                });
                txRes = { success: true, segments: r.segments, text: r.text, language: r.language, engine: "whisper.cpp", notes: [] };
            } catch (e) {
                let msg = (e && e.message) || String(e);
                try {
                    const lp = W.logPath && W.logPath(); const lg = W.recentLog && W.recentLog(22);
                    if (lp) msg += "\n\nFull log: " + lp;
                    if (lg) msg += "\n\n— last steps —\n" + lg;
                } catch (_) {}
                txRes = { success: false, error: msg };
            }
        } else {
            setStatus(`Extracting audio… (${seqInfo.duration.toFixed(1)}s — ${scopeNote})`, "info");
            const clipsArg = JSON.stringify({ clips: seqInfo.clips, duration: seqInfo.duration });
            const extractRes = await runPython("extract_audio.py", [clipsArg, tmpAudio]);
            if (!extractRes.success) { handleError(extractRes.error || "Audio extraction failed."); return; }

            const engLabel = { whisperx: "WhisperX", mlx: "mlx-whisper", openai: "openai-whisper", auto: "Whisper" }[settings.engine] || "Whisper";
            setStatus(`Transcribing with ${engLabel} (Pro/Python)…`, "info");
            txRes = await runPython("transcribe.py",
                [tmpAudio, model, language, settings.engine, settings.diarize ? "1" : "0", settings.promptWords || ""],
                stderr => {
                    if (stderr.includes("Downloading") || stderr.includes("download"))
                        setStatus("Downloading model… (one-time, please wait)", "info");
                });
        }

        try { if (fs.existsSync(tmpAudio)) fs.unlinkSync(tmpAudio); } catch {}

        if (!txRes.success) { handleError(txRes.error || "Transcription failed."); return; }

        lastLanguage = txRes.language || (language !== "auto" ? language : "");
        seqInTime = seqInfo.inTime;

        // Build working segments. Wrapped defensively: a malformed segment/word
        // from any engine (esp. WhisperX diarization/alignment) must never crash
        // the whole run — we fall back to raw, unsplit segments if anything throws.
        let segs;
        try {
            segs = (txRes.segments || [])
                .filter(seg => seg != null && seg.start != null && seg.end != null)
                .map((seg, i) => ({
                    id:    i,
                    start: Number(seg.start) || 0,
                    end:   Number(seg.end)   || 0,
                    text:  (seg.text == null ? "" : String(seg.text)),
                    words: (seg.words || []).filter(w => w != null && w.start != null && w.end != null),
                    speaker: seg.speaker || null,
                }));
            if (settings.autoSplit) segs = applySmartSplit(segs, settings);
        } catch (procErr) {
            console.error("[Whisper] segment processing failed, using raw segments:", procErr);
            segs = (txRes.segments || [])
                .filter(seg => seg != null && seg.start != null && seg.end != null)
                .map((seg, i) => ({
                    id: i, start: Number(seg.start) || 0, end: Number(seg.end) || 0,
                    text: (seg.text == null ? "" : String(seg.text)), words: [], speaker: seg.speaker || null,
                }));
        }

        segments = segs.map(seg => ({
            ...seg,
            seqStart: seqInfo.inTime + seg.start,
            seqEnd:   seqInfo.inTime + seg.end,
        }));

        applyPunctuationFilter({ silent: true });
        renderSegments();

        if (segments.length === 0) {
            setStatus("No speech detected. Try a different model or language.", "warning");
        } else {
            const lang = txRes.language ? ` · lang: ${txRes.language}` : "";
            const eng  = txRes.engine   ? ` · ${txRes.engine}`         : "";
            const note = (txRes.notes && txRes.notes.length) ? ` · ${txRes.notes[0]}` : "";
            setStatus(`Done — ${segments.length} segment(s)${lang}${eng}${note}`, "success");
            actionsBar.style.display = "flex";
            updateSegCount();

            // Diarization requested but produced no speakers → tell the user why
            if (settings.diarize && !segments.some(s => s.speaker)) {
                showToast("Speaker labels need a HuggingFace token (see Settings). Transcribed without them.", "info", 6000);
            }

            // Auto clean-up: dictionary + filler removal (profanity left manual)
            if (settings.autoCleanup) {
                const d = applyDictionary({ silent: true });
                const f = removeFillers({ silent: true });
                renderSegments(); reselect();
                if (d + f > 0) showToast(`Auto clean-up: ${d} dictionary · ${f} fillers`, "info", 4000);
            }
        }

    } catch (e) {
        console.error("[Whisper] transcription error:", e);
        handleError(e && e.message ? e.message : String(e));
    } finally {
        isRunning = false;
        showProgress(false);
        transcribeBtn.disabled = false;
        sendBtn.disabled       = segments.length === 0;
    }
}

function handleError(rawErr) {
    const info = classifyError(rawErr);
    setStatus(info ? info.what : (rawErr?.split("\n")[0] || "An error occurred."), "error");
    if (info) {
        showError(info.what, info.why || null, info.fix || null, info.fixBtn, info.fixAct);
    } else {
        showError(
            rawErr?.split("\n")[0] || "Unknown error",
            rawErr?.split("\n").slice(1).join("\n") || null,
            "Check the Setup tab for system status.",
            "Go to Setup",
            () => switchTab("setup")
        );
    }
}

// ── Segment rendering ─────────────────────────────────────────────────────
/* Rebuild the segment list.
 *
 * This used to create a node per segment, attach a click listener to each one,
 * and give every WORD its own inline onclick attribute. On a one-hour
 * transcript that is roughly a thousand segments and ten thousand handler
 * strings for the parser to chew through — rebuilt from scratch on every edit,
 * split, undo and clean-up (27 call sites). The panel visibly stalled.
 *
 * Now: one HTML string, one assignment, and a single delegated listener on the
 * container. Words carry data-w instead of an onclick. Off-screen segments are
 * skipped by the compositor via content-visibility (see .segment in style.css),
 * which gets most of the benefit of virtualisation without the scroll-position
 * and selection bugs that come with it.
 */
function renderSegments() {
    if (segments.length === 0) {
        segmentsWrap.innerHTML = `
          <div class="empty-state">
            <div class="icon">${icon("captions")}</div>
            <p>${escHtml(t("empty_p"))}</p>
            <p class="hint">${escHtml(t("empty_hint"))}</p>
          </div>`;
        return;
    }

    // Hoisted out of the loop: these were re-read and re-escaped per segment.
    const tipSeek  = escHtml(t("tip_seek"));
    const tipEdit  = escHtml(t("tip_edit"));
    const tipSplit = escHtml(t("tip_split"));
    const tipDel   = escHtml(t("tip_del"));
    const icPencil = icon("pencil"), icScissors = icon("scissors"), icClose = icon("close");

    const out = [];
    for (let idx = 0; idx < segments.length; idx++) {
        const seg = segments[idx];

        const speakerHtml = seg.speaker
            ? `<span class="seg-speaker" data-act="speaker" style="cursor:pointer" data-tip="Click to rename this speaker everywhere">${escHtml(String(seg.speaker).replace("SPEAKER_", "S"))}</span>`
            : "";

        let bodyHtml, matchCls = "";
        if (activeFindRegex) {
            // Find mode: highlight matches (no per-word split while searching)
            bodyHtml = highlightMatches(seg.text, activeFindRegex);
            if (findMatchSegs.includes(idx)) matchCls = " has-match";
        } else {
            const words = seg.text.split(" ");
            const parts = new Array(words.length);
            for (let wi = 0; wi < words.length; wi++) {
                parts[wi] = `<span class="seg-word" data-w="${wi}">${escHtml(words[wi])}</span>`;
            }
            bodyHtml = parts.join(" ");
        }

        out.push(
            `<div class="segment${matchCls}" data-idx="${idx}">` +
              `<div class="seg-header">` +
                `<span class="seg-index" data-act="seek" data-tip="${tipSeek}">${idx + 1}</span>` +
                `<span class="seg-time"  data-act="seek" data-tip="${tipSeek}">${formatTime(seg.seqStart)} → ${formatTime(seg.seqEnd)}</span>` +
                speakerHtml +
                `<div class="seg-actions">` +
                  `<button class="seg-btn" data-act="edit"   data-tip="${tipEdit}">${icPencil}</button>` +
                  `<button class="seg-btn" data-act="split"  data-tip="${tipSplit}">${icScissors}</button>` +
                  `<button class="seg-btn del" data-act="delete" data-tip="${tipDel}">${icClose}</button>` +
                `</div>` +
              `</div>` +
              `<div class="seg-text" id="seg-text-${idx}">${bodyHtml}</div>` +
            `</div>`);
    }
    segmentsWrap.innerHTML = out.join("");
    bindSegmentDelegation();
}

/* One listener for the whole list, attached once. Previously every segment got
 * its own, so a thousand segments meant a thousand listeners to install and
 * later garbage-collect on each rebuild. */
let _segDelegationBound = false;
function bindSegmentDelegation() {
    if (_segDelegationBound || !segmentsWrap) return;
    _segDelegationBound = true;

    segmentsWrap.addEventListener("click", (e) => {
        const target = e.target;
        if (!target || !target.closest) return;
        if (target.closest("textarea")) return;          // editing in place

        const segEl = target.closest(".segment");
        if (!segEl) return;
        const idx = +segEl.dataset.idx;

        const word = target.closest(".seg-word");
        if (word) { splitAtWord(idx, +word.dataset.w); return; }

        // closest(): a click lands on the ICON inside the button, and the icon
        // has no data-act of its own — that used to make Edit/Split/Delete
        // also seek.
        const act = target.closest("[data-act]");
        switch (act && act.dataset.act) {
            case "edit":    editSegment(idx); return;
            case "split":   splitSegmentHalf(idx); return;
            case "delete":  deleteSegment(idx); return;
            case "speaker": e.stopPropagation(); renameSpeaker(segments[idx].speaker); return;
            case "seek":    seekToSegment(idx); return;
        }
        seekToSegment(idx);
    });

    segmentsWrap.addEventListener("dblclick", (e) => {
        const segEl = e.target && e.target.closest && e.target.closest(".segment");
        if (segEl && e.target.closest(".seg-text")) editSegment(+segEl.dataset.idx);
    });
}

function escHtml(s) {
    return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

// Escape text, then wrap regex matches in <mark> for find highlighting
function highlightMatches(text, re) {
    text = text || "";
    re.lastIndex = 0;
    let out = "", last = 0, m;
    const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
    while ((m = g.exec(text)) !== null) {
        if (m.index > last) out += escHtml(text.slice(last, m.index));
        out += `<mark class="find-hit">${escHtml(m[0])}</mark>`;
        last = m.index + m[0].length;
        if (m[0].length === 0) g.lastIndex++;   // guard against zero-width loops
    }
    out += escHtml(text.slice(last));
    return out;
}

function selectSegment(idx) {
    // Clear only the one that was actually selected. querySelectorAll(".segment")
    // walked every node in the list on each call, and selectSegment runs after
    // every split, edit and undo.
    const prev = segmentsWrap && segmentsWrap.querySelector(".segment.selected");
    if (prev) prev.classList.remove("selected");
    selectedIndex = idx;
    const el = document.querySelector(`.segment[data-idx="${idx}"]`);
    if (!el) return;
    el.classList.add("selected");
    // "smooth" queues an animation; firing one per keystroke-level action made
    // the list fight the user's own scrolling. Only scroll when it is actually
    // out of view, and jump straight there.
    const box = segmentsWrap ? segmentsWrap.getBoundingClientRect() : null;
    const r = el.getBoundingClientRect();
    if (!box || r.top < box.top || r.bottom > box.bottom) {
        el.scrollIntoView({ block: "nearest" });
    }
}

function updateSegCount() {
    if (segCountEl) segCountEl.textContent = `${segments.length} segment${segments.length !== 1 ? "s" : ""}`;
}

function editSegment(idx) {
    const textEl = document.getElementById(`seg-text-${idx}`);
    if (!textEl || textEl.tagName === "TEXTAREA") return;
    const ta = document.createElement("textarea");
    ta.className = "seg-text-edit";
    ta.value     = segments[idx].text;
    ta.rows      = 2;
    textEl.replaceWith(ta);
    ta.id = `seg-text-${idx}`;
    ta.focus();
    const save = () => {
        // Keep subtitles single-line — collapse any stray line breaks/whitespace.
        segments[idx].text = ta.value.replace(/\s+/g, " ").trim();
        ta.closest(".segment")?.classList.remove("editing");
        renderSegments(); selectSegment(idx);
    };
    ta.addEventListener("blur", save);
    ta.addEventListener("keydown", e => {
        // Subtitles stay single-line — Enter always saves (never inserts a break).
        if (e.key === "Enter") { e.preventDefault(); save(); }
        if (e.key === "Escape") save();
    });
    ta.closest(".segment")?.classList.add("editing");
}

/* Where to cut so display-word `wi` starts the second half. Prefers whisper's
 * real per-word timestamps (cut in the silence between the two words); falls
 * back to proportional interpolation once the text has been edited and no
 * longer lines up with the word list one-to-one. */
function splitPoint(seg, words, wi) {
    const wt = (seg.words || []).filter(w => w && w.start != null && w.end != null);
    if (wt.length === words.length && wi > 0 && wi < wt.length) {
        return { t: (wt[wi - 1].end + wt[wi].start) / 2, a: wt.slice(0, wi), b: wt.slice(wi) };
    }
    return { t: seg.start + (seg.end - seg.start) * (wi / words.length), a: [], b: [] };
}

/* Cut one segment in two at media time `t`. Each half keeps only ITS OWN word
 * timings — the old `{...seg}` spread copied the whole word list into both,
 * so auto-format and karaoke/MOGRT rendering (which rebuild text from
 * seg.words) resurrected the text that had just been split away.
 * seqStart/seqEnd move by the same proportion, so the media→sequence offset
 * survives the cut. */
function cutSegment(seg, t, wordsA, wordsB, textA, textB) {
    const span = (seg.end - seg.start) || 1;
    const r    = Math.min(1, Math.max(0, (t - seg.start) / span));
    const seqT = seg.seqStart + (seg.seqEnd - seg.seqStart) * r;
    return [
        { ...seg, end: t,   seqEnd:   seqT, text: textA, words: wordsA },
        { ...seg, start: t, seqStart: seqT, text: textB, words: wordsB },
    ];
}

// UI action: split ONE segment in half (bound to the scissors button). NOTE the
// distinct name — an earlier `splitSegment(idx)` here shadowed the formatter's
// splitSegment(seg,opt,maxChars), silently breaking all auto-format (max chars /
// lines / CPS / duration) because applySmartSplit called this with wrong args.
function splitSegmentHalf(idx) {
    const seg   = segments[idx];
    const words = seg.text.split(" ");
    if (words.length < 2) { selectSegment(idx); return; }
    const half  = Math.max(1, Math.round(words.length / 2));
    const p     = splitPoint(seg, words, half);
    segments.splice(idx, 1, ...cutSegment(seg, p.t, p.a, p.b,
        words.slice(0, half).join(" "), words.slice(half).join(" ")));
    segments.forEach((s, i) => { s.id = i; });
    renderSegments(); updateSegCount(); selectSegment(idx);
}

function splitAtWord(idx, wi) {
    const seg   = segments[idx];
    const words = seg.text.split(" ");
    // Only wi === 0 is a genuine no-op (nothing sits before it). Splitting off
    // the LAST word is a real split, but the old `wi >= words.length - 1`
    // guard swallowed that click without a word of feedback — so the line
    // stayed long and Premiere just wrapped it onto a second line, which reads
    // exactly like someone hit Enter instead of cutting.
    if (wi <= 0 || wi >= words.length) { selectSegment(idx); return; }
    const p = splitPoint(seg, words, wi);
    segments.splice(idx, 1, ...cutSegment(seg, p.t, p.a, p.b,
        words.slice(0, wi).join(" "), words.slice(wi).join(" ")));
    segments.forEach((s, i) => { s.id = i; });
    renderSegments(); updateSegCount(); selectSegment(idx);
}

function deleteSegment(idx) {
    segments.splice(idx, 1);
    segments.forEach((s, i) => { s.id = i; });
    if (segments.length === 0) { renderSegments(); actionsBar.style.display = "none"; }
    else renderSegments();
    updateSegCount();
    sendBtn.disabled = segments.length === 0;
}

function clearAll() {
    if (!confirm("Clear all segments?")) return;
    segments = []; selectedIndex = -1;
    renderSegments(); actionsBar.style.display = "none";
    setStatus("Ready", "info"); hideError();
}

// ── SRT & Send ────────────────────────────────────────────────────────────
function wrapText(text, maxCharsPerLine, maxLines) {
    const words = (text || "").trim().split(/\s+/);
    if (words.length <= 1) return text;
    const lines = [];
    let cur = "";
    for (const w of words) {
        if (cur && (cur.length + 1 + w.length) > maxCharsPerLine && lines.length < maxLines - 1) {
            lines.push(cur);
            cur = w;
        } else {
            cur = cur ? cur + " " + w : w;
        }
    }
    if (cur) lines.push(cur);
    return lines.join("\n");
}

function segmentsToSRT(segsOverride) {
    const segs = segsOverride || segments;
    return segs.map((seg, i) => {
        const text = settings.autoSplit
            ? wrapText(seg.text, settings.maxCharsPerLine, settings.maxLines)
            : seg.text;
        return `${i+1}\n${formatTime(seg.seqStart)} --> ${formatTime(seg.seqEnd)}\n${text}\n`;
    }).join("\n");
}

// ── Multi-format export ───────────────────────────────────────────────────
function fmtVTT(secs) {
    return formatTime(secs).replace(",", ".");
}
function fmtASS(secs) {
    const h  = Math.floor(secs / 3600);
    const m  = Math.floor((secs % 3600) / 60);
    const s  = Math.floor(secs % 60);
    const cs = Math.round((secs % 1) * 100);
    return `${h}:${p2(m)}:${p2(s)}.${p2(cs)}`;
}

function _exportSegs() {
    return settings.gapFill ? applyGapFill(segments, settings.gapMax) : segments;
}
function _wrap(text) {
    return settings.autoSplit ? wrapText(text, settings.maxCharsPerLine, settings.maxLines) : text;
}

function segmentsToVTT() {
    const segs = _exportSegs();
    let out = "WEBVTT\n\n";
    out += segs.map((seg, i) =>
        `${i+1}\n${fmtVTT(seg.seqStart)} --> ${fmtVTT(seg.seqEnd)}\n${_wrap(seg.text)}\n`
    ).join("\n");
    return out;
}

function assColor(rrggbb, alpha) {
    const r = rrggbb.slice(0, 2), g = rrggbb.slice(2, 4), b = rrggbb.slice(4, 6);
    const a = (alpha | 0).toString(16).padStart(2, "0");
    return ("&H" + a + b + g + r).toUpperCase();
}

// SecondaryColour matters for karaoke: text shows Secondary before the \k sweep,
// Primary after. For karaoke we set Secondary = base text, Primary = highlight.
function buildASSStyle(p, karaoke) {
    const base      = assColor(p.primary, 0);
    const highlight = assColor(settings.karaokeHi || "FFE000", 0);
    const outline   = assColor(p.outline, 0);
    const back      = assColor(p.boxColor, p.box ? p.boxAlpha : 0);
    const border    = p.box ? 3 : 1;
    const marginV   = (p.align === 5) ? 0 : 50;
    const primaryCol   = karaoke ? highlight : base;
    const secondaryCol = karaoke ? base      : "&H000000FF";
    return `Style: Default,${p.font},${p.size},${primaryCol},${secondaryCol},${outline},${back},${p.bold ? -1 : 0},0,0,0,100,100,0,0,${border},${p.outlineW},${p.shadow},${p.align},60,60,${marginV},1`;
}

function escAssText(s) {
    return (s || "").replace(/[{}]/g, "").replace(/\r?\n/g, "\\N");
}

// Build a karaoke dialogue body: {\kf<cs>}word for each word, durations absorb
// inter-word gaps so the highlight stays in sync with the audio.
function karaokeBody(seg) {
    const words = (seg.words || []).filter(w => w && w.start != null && w.end != null && w.word);
    if (!words.length) return escAssText(seg.text);
    // Keyword emphasis for social captions: context words, ALL-CAPS words and
    // numbers pop bigger. Cheap heuristic, no AI call needed.
    const emph = new Set((settings.promptWords || "").split(/[,\n]/).map(w => w.trim().toLowerCase()).filter(Boolean));
    const isEmph = (word) => {
        const clean = word.replace(/[.,!?;:"'()]/g, "");
        if (!clean) return false;
        if (emph.has(clean.toLowerCase())) return true;
        if (/\d/.test(clean)) return true;
        if (clean.length >= 3 && clean === clean.toUpperCase() && /[A-Z\u00c7\u011e\u0130\u00d6\u015e\u00dc]/.test(clean)) return true;
        return false;
    };
    let prev = seg.start != null ? seg.start : words[0].start;
    let parts = [];
    for (const w of words) {
        const durCs = Math.max(1, Math.round((w.end - prev) * 100));
        const txt = escAssText(w.word);
        parts.push(`{\\kf${durCs}}` + (isEmph(w.word) ? `{\\fscx118\\fscy118}${txt}{\\fscx100\\fscy100}` : txt) + " ");
        prev = w.end;
    }
    return parts.join("").trim();
}

// Distinct text colours per speaker (diarization) — cycled in order of appearance.
const SPEAKER_COLORS = ["FFFFFF", "7DD3FC", "FDE68A", "86EFAC", "F9A8D4", "FCA5A5", "C4B5FD", "FDBA74"];

function segmentsToASS() {
    const preset   = getActivePreset();
    const karaoke  = !!settings.karaoke;
    const segs = _exportSegs();

    // Speaker styles: if diarization tagged speakers, each gets its own colour.
    const speakers = [];
    segs.forEach(s => { if (s.speaker && speakers.indexOf(s.speaker) === -1) speakers.push(s.speaker); });
    let styleLines = buildASSStyle(preset, karaoke);
    const styleFor = {};
    if (speakers.length > 1 && !karaoke) {
        styleLines = speakers.map((sp, i) => {
            const name = "Spk" + (i + 1);
            styleFor[sp] = name;
            const p2 = { ...preset, primary: SPEAKER_COLORS[i % SPEAKER_COLORS.length] };
            return buildASSStyle(p2, false).replace("Style: Default,", `Style: ${name},`);
        }).join("\n") + "\n" + buildASSStyle(preset, karaoke);
    }

    const header =
`[Script Info]
ScriptType: v4.00+
WrapStyle: 0
ScaledBorderAndShadow: yes
PlayResX: 1920
PlayResY: 1080

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
${styleLines}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
    const lines = segs.map(seg => {
        const text = karaoke ? karaokeBody(seg) : _wrap(seg.text).replace(/\n/g, "\\N");
        const style = (seg.speaker && styleFor[seg.speaker]) || "Default";
        const name  = seg.speaker ? seg.speaker.replace("SPEAKER_", "S") : "";
        return `Dialogue: 0,${fmtASS(seg.seqStart)},${fmtASS(seg.seqEnd)},${style},${name},0,0,0,,${text}`;
    }).join("\n");
    return header + lines + "\n";
}

function segmentsToTXT() {
    return _exportSegs().map(seg => seg.text.trim()).join("\n");
}

function toggleExportMenu() {
    const m = $("export-menu");
    m.style.display = (m.style.display === "none" || !m.style.display) ? "block" : "none";
}

function exportAs(fmt) {
    $("export-menu").style.display = "none";
    if (segments.length === 0) { showToast("Nothing to export yet", "info", 2000); return; }

    const builders = { srt: segmentsToSRT, vtt: segmentsToVTT, ass: segmentsToASS, txt: segmentsToTXT };
    const builder = builders[fmt];
    if (!builder) return;

    const content = builder();
    const stamp   = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const defName = `captions_${stamp}.${fmt}`;

    let outPath = null;
    try {
        if (window.cep && window.cep.fs && window.cep.fs.showSaveDialogEx) {
            const res = window.cep.fs.showSaveDialogEx("Export captions", "", [fmt], defName, fmt.toUpperCase());
            if (res && res.data) outPath = res.data;
            else if (res && res.err === 0 && typeof res === "string") outPath = res;
        }
    } catch (e) {}

    if (!outPath) {
        outPath = path.join(os.homedir(), "Desktop", defName);
    }

    try {
        fs.writeFileSync(outPath, content, "utf8");
        setStatus(`Exported ${fmt.toUpperCase()} → ${outPath}`, "success");
        showToast(`Saved ${fmt.toUpperCase()} file`, "success");
        revealInFolder(outPath);
    } catch (e) {
        showToast(`Export failed: ${e.message}`, "error", 5000);
    }
}

async function sendToPremiere() {
    if (segments.length === 0) return;
    if (settings.sendMode === "graphics" && typeof sendStyledGraphics === "function") { await sendStyledGraphics(); return; }
    sendBtn.disabled = true;
    setStatus("Sending captions to Premiere…", "info");
    showProgress(true);
    hideSRTSaved();

    const finalSegs = settings.gapFill ? applyGapFill(segments, settings.gapMax) : segments;
    const srt       = segmentsToSRT(finalSegs);
    const escaped = srt.replace(/\\/g,"\\\\").replace(/'/g,"\\'").replace(/\r?\n/g,"\\n");
    const result  = await evalScript(`importSRTToProject('${escaped}')`);

    showProgress(false);
    sendBtn.disabled = false;

    if (result.diag) console.log("[Whisper] caption diag:", result.diag);

    if (result.success) {
        if (result.autoAdded) {
            setStatus(result.message || "Captions added to timeline!", "success");
            showToast(result.message || "Captions added to timeline!", "success");
            hideError();
        } else {
            setStatus("SRT saved — couldn't auto-place on timeline", "warning");
            showSRTSaved(result.srtPath || "");
            if (result.diag) {
                showError(
                    "Captions imported to the project panel but not auto-placed on the timeline.",
                    "Diagnostic: " + result.diag.join("  •  "),
                    "Drag the SRT from the project panel onto a caption track."
                );
            }
        }
    } else {
        handleError(result.error || "Failed to export captions.");
    }
}


// ── Setup / Diagnostics ───────────────────────────────────────────────────
let diagData = null;

// Gate the optional "Pro" engines (Python) by what's actually installed, so the
// end user can never pick a broken option. Built-in (whisper.cpp) always works.
function applyEngineAvailability() {
    const sel = $("set-engine");
    if (!sel) return;
    const note = $("engine-pro-note");
    const ok = (k) => diagData && diagData[k] && diagData[k].status === "ok";
    const avail = { whisperx: ok("whisperx"), mlx: ok("mlx_whisper"), openai: ok("whisper") };

    ["whisperx", "mlx", "openai"].forEach(v => {
        const opt = sel.querySelector(`option[value="${v}"]`);
        if (opt) opt.disabled = !avail[v];
    });
    const diar = $("set-diarize");
    if (diar) {
        diar.disabled = !avail.whisperx;
        if (!avail.whisperx && diar.checked) { diar.checked = false; settings.diarize = false; saveSettings(); }
    }
    // If a Pro engine is selected but isn't installed, fall back to Built-in.
    if (["whisperx", "mlx", "openai"].indexOf(settings.engine) !== -1 && !avail[settings.engine]) {
        settings.engine = "cpp"; saveSettings();
    }
    sel.value = settings.engine;
    if (note) {
        const anyPro = avail.whisperx || avail.mlx || avail.openai;
        if (anyPro) { note.style.display = "none"; }
        else { note.textContent = t("pro_unavailable"); note.style.display = "block"; }
    }
}

async function runDiagnostics() {
    setupIndicator.className = "setup-indicator loading";
    $("checks-list").innerHTML = `<div class="check-loading">Checking…</div>`;
    $("models-list").innerHTML  = `<div class="check-loading">Loading…</div>`;

    const data = await runPython("check_setup.py", []);
    diagData = data;

    if (!data || data.error) {
        // No Python — that's fine. The built-in engine needs none. Show it as
        // ready and frame Python as an optional Pro prerequisite (no scary red).
        const bi = builtinEngineReady();
        $("checks-list").innerHTML = `<div class="check-item">
            <div class="check-icon check-${bi ? "ok" : "warn"}">${icon(bi ? "check" : "alert")}</div>
            <div class="check-body">
              <div class="check-name">${t("nm_builtin")}</div>
              <div class="check-detail ${bi ? "ok" : "warn"}">${bi ? t("ds_builtin_ok") : t("ds_builtin_dl")}</div>
            </div>
          </div>
          <div class="check-item">
            <div class="check-icon check-opt">${icon("close")}</div>
            <div class="check-body">
              <div class="check-name">Python</div>
              <div class="check-detail opt">${t("py_optional")}</div>
            </div>
          </div>`;
        $("models-list").innerHTML = "";
        applyEngineAvailability();
        setupIndicator.className = "setup-indicator ok";  // built-in works regardless
        setupBadge.style.display = "none";
        return;
    }

    renderChecks(data);
    renderModels(data.models);
    renderSetupNotes(data._os || "mac");
    applyEngineAvailability();

    setupIndicator.className = `setup-indicator ${data._ready ? "ok" : "warn"}`;
    setupBadge.style.display = data._ready ? "none" : "inline-flex";
}

function builtinEngineReady() {
    const W = wcpp();
    if (!W) return false;
    try { return fs.existsSync(W.whisperBin(extDir())) && fs.existsSync(W.ffmpegBin(extDir())); }
    catch (e) { return false; }
}

function renderChecks(data) {
    // CORE = built-in prerequisites + WhisperX (speaker labels) which keeps an
    // install button. Everything else (openai-whisper, mlx, punctuation) is not
    // needed — the Built-in engine already transcribes + punctuates — so it's hidden.
    const CORE  = ["python", "ffmpeg", "whisperx"];
    const EXTRA = [];   // openai-whisper / mlx hidden entirely — Built-in covers them

    const bi = builtinEngineReady();
    let html = `<div class="check-item">
      <div class="check-icon check-${bi ? "ok" : "warn"}">${icon(bi ? "check" : "alert")}</div>
      <div class="check-body">
        <div class="check-name">${t("nm_builtin")}</div>
        <div class="check-detail ${bi ? "ok" : "warn"}">${bi ? t("ds_builtin_ok") : t("ds_builtin_dl")}</div>
      </div>
    </div>`;

    const row = (key, allowFix) => {
        const c = data[key]; if (!c) return "";
        const st = c.status;             // ok | warn | missing | na
        const ok = st === "ok";
        const opt = c.optional;
        let ico, cls;
        if (st === "ok")        { ico = icon("check"); cls = "ok"; }
        else if (st === "warn") { ico = icon("alert"); cls = "warn"; }
        else if (!allowFix)     { ico = icon("close"); cls = "opt"; }   // extras: always muted
        else if (st === "na")   { ico = icon("close"); cls = "opt"; }
        else if (opt)           { ico = icon("close"); cls = "opt"; }
        else                    { ico = icon("close"); cls = "bad"; }
        const showFix = allowFix && (st === "missing" || (!ok && !opt && st !== "na")) && c.fix_cmd;
        // For an extra that's not installed, replace the noisy detail with a calm note.
        const detail = (!ok && !allowFix) ? t("opt_alt_note") : (c.detail || "");
        return `<div class="check-item">
          <div class="check-icon check-${cls}">${ico}</div>
          <div class="check-body">
            <div class="check-name">${c.label}</div>
            <div class="check-detail ${cls}">${detail}</div>
            ${showFix ? renderFixRow(key, c) : ""}
          </div>
        </div>`;
    };

    html += CORE.map(k => row(k, true)).join("");
    html += EXTRA.map(k => row(k, false)).join("");
    $("checks-list").innerHTML = `<div class="glist">${html}</div>`;
}

function renderFixRow(key, c) {
    if (c.fix_type === "pip") {
        return `<div class="check-cmd">
          <code>${c.fix_cmd}</code>
          <button class="btn-install" id="btn-install-${key}"
                  onclick="installPackage('${c.fix_pkg}','${key}')">
            ${c.fix_label}
          </button>
        </div>`;
    }
    return `<div class="check-cmd">
      <code>${c.fix_cmd}</code>
      <button class="btn-copy" onclick="copyAndMark(this,'${c.fix_cmd}')">Copy</button>
    </div>`;
}

function copyAndMark(btn, text) {
    if (navigator.clipboard) {
        navigator.clipboard.writeText(text).then(() => {
            btn.textContent = "✓"; btn.classList.add("copied");
            setTimeout(() => { btn.textContent = "Copy"; btn.classList.remove("copied"); }, 2000);
        });
    }
}

async function installPackage(pkg, key) {
    const btn = $(`btn-install-${key}`);
    if (btn) { btn.textContent = "Installing…"; btn.disabled = true; btn.classList.add("installing"); }

    const py  = findPython();
    let res = await runCmd(py, ["-m", "pip", "install", "--user", pkg]);
    
    // First verification
    let check = await runCmd(py, [path.join(extDir(), "scripts", "check_setup.py")]);
    let parsed = {};
    try { parsed = JSON.parse(check.out); } catch(e) {}

    // If pip succeeded but import still fails (e.g. wrong architecture cached, or corrupt), force clean and reinstall
    if (res.code === 0 && parsed[key] && parsed[key].status !== "ok") {
        if (btn) { btn.textContent = "Fixing Corrupted Files…"; }
        await runCmd(py, ["-c", "import site, shutil; site_dir = site.getusersitepackages(); shutil.rmtree(site_dir, ignore_errors=True)"]);
        res = await runCmd(py, ["-m", "pip", "install", "--user", "--no-cache-dir", pkg]);
        check = await runCmd(py, [path.join(extDir(), "scripts", "check_setup.py")]);
        try { parsed = JSON.parse(check.out); } catch(e) {}
    }

    if (res.code === 0 && parsed[key] && parsed[key].status === "ok") {
        if (btn) {
            btn.textContent = "Installed";
            btn.classList.remove("installing");
            btn.classList.add("installed");
        }
        await runDiagnostics();
    } else {
        if (btn) {
            btn.textContent = "Install Failed";
            btn.disabled = false;
            btn.classList.remove("installing");
        }
        alert("Failed to install " + pkg + ".\n\n" + res.err + "\n\nImport check output:\n" + check.out);
    }
}

function renderModels(models) {
    if (!models?.cached?.length) {
        $("models-list").innerHTML = `
          <div class="no-models">
            No models downloaded yet.<br>
            The first transcription will download the selected model automatically.<br>
            <span style="color:var(--text3)">turbo ≈ 1.5 GB (one-time download)</span>
          </div>`;
        return;
    }
    $("models-list").innerHTML = `<div class="glist">` + models.cached.map(m => `
      <div class="model-item">
        <div class="model-dot"></div>
        <div class="model-name">${m.label}</div>
        <div class="model-size">${m.size_mb} MB</div>
      </div>`).join("") + `</div>`;
}

// OS-aware install guidance (Windows vs macOS)
function renderSetupNotes(os) {
    const el = $("setup-notes");
    if (!el) return;
    const cp = cmd => `<a href="#" onclick="copyText('${cmd.replace(/'/g, "\\'")}'); return false;">${cmd}</a>`;
    if (os === "win") {
        el.innerHTML = `
          <p><strong>1. Python</strong> — install from <a href="#" onclick="copyText('https://www.python.org/downloads/'); return false;">python.org</a>
             and tick <strong>“Add Python to PATH”</strong> during setup.</p>
          <p><strong>2. ffmpeg</strong> — in Terminal (PowerShell): ${cp("winget install Gyan.FFmpeg")}</p>
          <p><strong>3. Engine</strong> — use the <strong>Install automatically</strong> buttons above, or run ${cp("pip install openai-whisper")}</p>
          <p>Then click <strong>Re-check</strong>.</p>`;
    } else {
        el.innerHTML = `
          <p>If <strong>Python</strong> is missing: ${cp("brew install python3")}</p>
          <p>If <strong>ffmpeg</strong> is missing: ${cp("brew install ffmpeg")}</p>
          <p>No Homebrew? ${cp('/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"')}</p>
          <p>Then click <strong>Re-check</strong>.</p>`;
    }
}

// ── Init ──────────────────────────────────────────────────────────────────
// ── Hover tooltips ─────────────────────────────────────────────────────────
// Any element with a [data-tip] attribute shows a styled tooltip on hover.
// The tooltip is appended to <body> with position:fixed so it is never clipped
// by the panel's overflow containers (a problem with CSS ::after tooltips here).
function initTooltips() {
    let tip = document.getElementById("ws-tooltip");
    if (!tip) {
        tip = document.createElement("div");
        tip.id = "ws-tooltip";
        tip.className = "ws-tooltip";
        document.body.appendChild(tip);
    }
    let timer = null, current = null;

    function place(target) {
        const r = target.getBoundingClientRect();
        // measure first
        tip.style.left = "0px"; tip.style.top = "0px";
        const tr = tip.getBoundingClientRect();
        let left = r.left + r.width / 2 - tr.width / 2;
        let top  = r.top - tr.height - 7;
        if (top < 4) top = r.bottom + 7;                       // flip below if no room
        left = Math.max(6, Math.min(left, window.innerWidth - tr.width - 6));
        tip.style.left = Math.round(left) + "px";
        tip.style.top  = Math.round(top) + "px";
    }
    function show(target) {
        const t = target.getAttribute("data-tip");
        if (!t) return;
        current = target;
        tip.textContent = t;
        tip.classList.add("show");
        place(target);
    }
    function hide() { current = null; clearTimeout(timer); tip.classList.remove("show"); }

    document.addEventListener("mouseover", e => {
        const t = e.target.closest && e.target.closest("[data-tip]");
        if (!t || t === current) return;
        clearTimeout(timer);
        timer = setTimeout(() => show(t), 300);
    });
    document.addEventListener("mouseout", e => {
        const t = e.target.closest && e.target.closest("[data-tip]");
        if (t) hide();
    });
    // Hide on any click/scroll so it never lingers
    document.addEventListener("click", hide, true);
    document.addEventListener("scroll", hide, true);
}

(function init() {
    loadHostJSX();

    // Restore persisted model & spoken language BEFORE any transcription —
    // startTranscription reads these selects directly from the DOM.
    const _ms = $("model-select"); if (_ms) _ms.value = settings.whisperModel || "turbo";
    const _ls = $("lang-select");  if (_ls) _ls.value = settings.spokenLang   || "auto";

    applyLanguage();
    applyIcons();
    applyTheme();   // apply after icons so theme-btn icon renders correctly
    renderSegments();
    initTooltips();
    // Track manual scrolling so the playhead-follow loop backs off for a few
    // seconds (don't yank the user down while they scroll up to edit).
    (function(){ const w = $("segments-wrap"); if (w) w.addEventListener("scroll", () => { window._lastUserScroll = Date.now(); }, { passive: true }); })();
    setStatus(t("status_ready"), "info");
    sendBtn.disabled         = true;
    setupIndicator.className = "setup-indicator loading";

    // Close the export / clean menus when clicking outside
    document.addEventListener("click", e => {
        if (!e.target.closest(".export-wrap")) {
            ["export-menu", "clean-menu"].forEach(id => {
                const menu = $(id);
                if (menu && menu.style.display === "block") menu.style.display = "none";
            });
        }
    });

    // Premiere extension only. IS_DESKTOP is defined by desktop-shim.js (desktop
    // only) — referencing it bare here threw a ReferenceError in the extension and
    // killed this whole init block, so the playhead-sync loop never started.
    const _isDesktop = (typeof window !== "undefined" && window.IS_DESKTOP === true);
    if (!_isDesktop) {
        // Space = play/pause in Premiere (unless typing in a field). CEP panels
        // only get keydown when the webview has DOM focus — so we grab focus when
        // the pointer enters or clicks the panel (fixes "Space does nothing until I
        // cmd-tab away and back"). We do NOT blur <select> on click (that closed
        // dropdowns on mouse-up).
        const _grabFocus = () => {
            const el = document.activeElement, tag = el && el.tagName;
            if (tag === "SELECT" || tag === "INPUT" || tag === "TEXTAREA") return;   // never steal from an open control
            try { window.focus(); } catch (e) {}
        };
        // documentElement only, NO capture: fires once when the pointer enters
        // the panel — not on every child (that killed open dropdowns).
        document.documentElement.addEventListener("mouseenter", _grabFocus, false);
        document.addEventListener("mousedown", (e) => {
            const el = e.target;
            const tag = el && el.tagName;
            if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (el && el.isContentEditable)) return;
            _grabFocus();
        }, true);
        document.addEventListener("keydown", (e) => {
            if (e.code !== "Space" && e.key !== " ") return;
            const el = document.activeElement, tag = el && el.tagName;
            if (tag === "INPUT" || tag === "TEXTAREA" || (el && el.isContentEditable)) return;
            e.preventDefault();
            e.stopPropagation();
            if (tag === "BUTTON" || tag === "SELECT") { try { el.blur(); } catch (x) {} }
            playPause();
        }, true);

        setInterval(async () => {
            if (!segments || segments.length === 0 || isRunning) return;
            // Robust playhead read: getPlayerPosition().seconds is undefined on
            // some Premiere builds → use ticks (254016000000 ticks/sec).
            const res = await evalScript("(function(){try{var s=app.project.activeSequence;if(!s)return -1;var p=s.getPlayerPosition();if(!p)return -1;if(p.ticks!==undefined&&p.ticks!==null&&p.ticks!=='')return parseInt(p.ticks)/254016000000;if(typeof p.seconds==='number')return p.seconds;return -1;}catch(e){return -1;}})()");
            const t = (typeof res === "number") ? res : parseFloat(res);
            if (isNaN(t) || t < 0) return;
            
            let activeIdx = -1;
            for (let i = 0; i < segments.length; i++) {
                if (t >= segments[i].seqStart && t <= segments[i].seqEnd) {
                    activeIdx = i; break;
                }
            }
            
            const wrap = $("segments-wrap");
            if (wrap && activeIdx >= 0) {
                // Touch only the two nodes that change. This used to
                // querySelectorAll(".segment") and walk every node three times
                // a second — a thousand segments meant 3,000 class checks per
                // second while the video played.
                const node = wrap.querySelector(`.segment[data-idx="${activeIdx}"]`);
                if (node !== _playingNode) {
                    if (_playingNode) _playingNode.classList.remove("playing");
                    if (node) node.classList.add("playing");
                    _playingNode = node;

                    const ae = document.activeElement, at = ae && ae.tagName;
                    const editing = at === "TEXTAREA" || at === "INPUT" || (ae && ae.isContentEditable);
                    const recentlyScrolled = (Date.now() - (window._lastUserScroll || 0)) < 5000;
                    // followPlayhead was declared in DEFAULT_SETTINGS and never
                    // read, so the panel always yanked the list down mid-play
                    // even for someone who just wanted to watch. Highlighting
                    // stays on either way — only the scrolling is opt-out.
                    if (node && settings.followPlayhead !== false && !editing && !recentlyScrolled) {
                        const wr = wrap.getBoundingClientRect(), nr = node.getBoundingClientRect();
                        if (nr.top < wr.top || nr.bottom > wr.bottom)
                            node.scrollIntoView({ behavior: "smooth", block: "nearest" });
                    }
                }
            } else if (_playingNode) {
                _playingNode.classList.remove("playing");
                _playingNode = null;
            }
        }, 300);
    }

    // Background startup check — resolve the precise python path first (async,
    // never blocks the UI), then run the diagnostic.
    resolvePythonAsync().then(() => runPython("check_setup.py", [])).then(data => {
        diagData = data;
        applyEngineAvailability();
        if (!data || !data._ready) {
            // Built-in engine works regardless — Setup is only for optional Pro.
            setupIndicator.className = "setup-indicator ok";
        } else {
            setupIndicator.className = "setup-indicator ok";
        }
    }).catch(() => {
        diagData = null;
        applyEngineAvailability();
        setupIndicator.className = "setup-indicator ok";
    });
})();

/* ═══════════════════════════════════════════════════════════════════════════
   v1.9 feature pack — shared by extension + desktop. Everything below is
   defensive: each feature initializes inside try/catch and NOTHING here may
   break core transcription. UI elements are injected dynamically so the HTML
   files (and the extension↔desktop footer sync) stay untouched.
   ═══════════════════════════════════════════════════════════════════════════ */

const APP_VERSION = "1.3.0";
const GH_REPO = "mertrusen/subsper";
const IS_DESKTOP_APP = (typeof window !== "undefined" && window.IS_DESKTOP === true);

// ── Undo / Redo ────────────────────────────────────────────────────────────
const _undoStack = [], _redoStack = [];
function pushUndo() {
    try {
        _undoStack.push(JSON.stringify(segments));
        if (_undoStack.length > 50) _undoStack.shift();
        _redoStack.length = 0;
    } catch (e) {}
}
function _restoreSnapshot(json) {
    segments = JSON.parse(json);
    renderSegments(); updateSegCount();
    if (typeof sendBtn !== "undefined" && sendBtn) sendBtn.disabled = segments.length === 0;
    if (typeof actionsBar !== "undefined" && actionsBar) actionsBar.style.display = segments.length ? "flex" : "none";
}
function undoSegments() {
    if (!_undoStack.length) { showToast("Nothing to undo", "info", 1500); return; }
    try { _redoStack.push(JSON.stringify(segments)); } catch (e) {}
    _restoreSnapshot(_undoStack.pop());
    showToast("Undo", "info", 1200);
}
function redoSegments() {
    if (!_redoStack.length) { showToast("Nothing to redo", "info", 1500); return; }
    try { _undoStack.push(JSON.stringify(segments)); } catch (e) {}
    _restoreSnapshot(_redoStack.pop());
    showToast("Redo", "info", 1200);
}

// ── Timing nudge (Alt+←/→ start, Alt+Shift+←/→ end, of selected segment) ──
function nudgeSelected(edge, delta) {
    const seg = segments[selectedIndex];
    if (!seg) { showToast("Select a segment first", "info", 2000); return; }
    pushUndo();
    if (edge === "start") {
        seg.seqStart = Math.max(0, Math.min(seg.seqEnd - 0.05, seg.seqStart + delta));
        seg.start += delta;
    } else {
        seg.seqEnd = Math.max(seg.seqStart + 0.05, seg.seqEnd + delta);
        seg.end += delta;
    }
    renderSegments(); selectSegment(selectedIndex);
    setStatus(`Timing: ${formatTime(seg.seqStart)} → ${formatTime(seg.seqEnd)}`, "info");
}

// ── Update check (GitHub Releases, both apps) ──────────────────────────────
function _semverNewer(remote, local) {
    const r = String(remote).replace(/^v/, "").split(".").map(Number);
    const l = String(local).replace(/^v/, "").split(".").map(Number);
    for (let i = 0; i < 3; i++) { if ((r[i]||0) > (l[i]||0)) return true; if ((r[i]||0) < (l[i]||0)) return false; }
    return false;
}
// ── Where releases, updates and support live ──────────────────────────────
// One place to repoint everything. Selling from your own site or from Gumroad
// instead of a public GitHub repo means editing these three lines plus the
// `publish` block in package.json — nothing else.
//
// This is centralised because it has already failed once: when the repo went
// private, the update check, the README's download links and electron-updater
// all died at the same moment, and the update check swallowed the 404 without
// a word, so nothing surfaced it.
//
// updateUrl only has to return JSON containing `tag_name` and `html_url`. The
// GitHub Releases API happens to have that shape, so a static JSON file on your
// own domain is a drop-in replacement.
const DIST = {
    updateUrl:   `https://api.github.com/repos/${GH_REPO}/releases/latest`,
    downloadUrl: `https://github.com/${GH_REPO}/releases/latest`,
    supportUrl:  `https://github.com/${GH_REPO}/issues/new`,
};

// Last update-check outcome, surfaced in Settings → diagnostics.
// "ok" | "offline" | "missing" | "idle"
let updateCheckState = { status: "idle", detail: "" };

async function checkForUpdates() {
    try {
        const res = await fetch(DIST.updateUrl, { headers: { Accept: "application/vnd.github+json" } });
        if (!res.ok) {
            // 404/410 is not a network hiccup — it means the release endpoint
            // itself is gone (repo made private, renamed, or deleted), so every
            // existing install has silently stopped receiving updates. Loud in
            // the log, visible in diagnostics, but NOT a banner: this app is
            // offline-first and must never nag about the network.
            const gone = res.status === 404 || res.status === 410;
            updateCheckState = {
                status: gone ? "missing" : "offline",
                detail: `HTTP ${res.status} — ${DIST.updateUrl}`,
            };
            if (gone) console.error("[subsper] update endpoint is gone:", DIST.updateUrl,
                                    "— users are no longer getting updates. See DIST in main.js.");
            return;
        }
        const rel = await res.json();
        updateCheckState = { status: "ok", detail: rel.tag_name || "" };
        const tag = rel.tag_name || "";
        if (!_semverNewer(tag, APP_VERSION)) return;
        if (localStorage.getItem("ws_skip_update") === tag) return;
        const bar = document.createElement("div");
        bar.id = "update-banner";
        bar.style.cssText = "position:fixed;bottom:0;left:0;right:0;z-index:9998;display:flex;gap:10px;align-items:center;justify-content:center;padding:9px 14px;background:linear-gradient(90deg,#1a6dff,#7b3ff2);color:#fff;font-size:12px;font-weight:600;";
        const isTr = settings.uiLang === "tr";
        bar.innerHTML =
            `<span>${isTr ? "Yeni sürüm çıktı" : "New version available"}: v${APP_VERSION} → <b>${tag}</b></span>` +
            `<button id="upd-get" style="background:#fff;color:#1a2;border:none;border-radius:6px;padding:4px 12px;font-weight:700;cursor:pointer;color:#333">${isTr ? "İndir" : "Download"}</button>` +
            `<button id="upd-skip" style="background:transparent;color:#fff;border:1px solid rgba(255,255,255,.5);border-radius:6px;padding:4px 10px;cursor:pointer">${isTr ? "Bu sürümü atla" : "Skip"}</button>`;
        document.body.appendChild(bar);
        $("upd-get").onclick = () => { openExternal(rel.html_url || DIST.downloadUrl); };
        $("upd-skip").onclick = () => { localStorage.setItem("ws_skip_update", tag); bar.remove(); };
    } catch (e) {
        // Being offline is the normal case for an offline-first tool, so this
        // stays quiet — it is only recorded for the diagnostics panel.
        updateCheckState = { status: "offline", detail: e.message };
    }
}
function openExternal(url) {
    try {
        if (IS_DESKTOP_APP) { _req("electron").shell.openExternal(url); return; }
    } catch (e) {}
    try { if (typeof csInterface !== "undefined" && csInterface.openURLInDefaultBrowser) { csInterface.openURLInDefaultBrowser(url); return; } } catch (e) {}
    try { window.open(url); } catch (e) {}
}

// ── Report a problem (prefilled GitHub issue with diagnostics) ─────────────
function reportProblem() {
    let logTail = "";
    try { const W = (typeof wcpp === "function") ? wcpp() : null; if (W && W.recentLog) logTail = W.recentLog(30); } catch (e) {}
    const body =
`**What happened?**
(describe the problem here / sorunu buraya yaz)

---
App: Subsper ${IS_DESKTOP_APP ? "Desktop" : "Premiere Extension"} v${APP_VERSION}
OS: ${process.platform} ${os.release()} (${process.arch})
Update check: ${updateCheckState.status}${updateCheckState.detail ? " — " + updateCheckState.detail : ""}
Engine log (last steps):
\`\`\`
${logTail || "(no log)"}
\`\`\``;
    openExternal(`${DIST.supportUrl}?title=${encodeURIComponent("[Bug] ")}&body=${encodeURIComponent(body)}`);
}

// ── Model manager (Setup tab): list downloaded GGML models, delete, fetch ──
const MODEL_LABELS = { turbo: "turbo (large-v3-turbo)", "large-v3": "large-v3", medium: "medium", small: "small", base: "base", tiny: "tiny" };
function renderModelManager() {
    const wrap = $("models-list");
    const W = (typeof wcpp === "function") ? wcpp() : null;
    if (!wrap || !W) return;
    const rows = Object.keys(MODEL_LABELS).map(key => {
        let size = 0, exists = false;
        try { const p = W.modelPath(key); if (fs.existsSync(p)) { exists = true; size = fs.statSync(p).size; } } catch (e) {}
        const mb = size ? (size / 1048576 | 0) + " MB" : "";
        const btn = exists
            ? `<button class="btn-secondary" style="padding:2px 10px" onclick="deleteModel('${key}')">Delete</button>`
            : `<button class="btn-secondary" style="padding:2px 10px" onclick="downloadModel('${key}')">Download</button>`;
        return `<div class="model-item" style="display:flex;align-items:center;gap:8px">
            <div class="model-dot" style="opacity:${exists ? 1 : .25}"></div>
            <div class="model-name" style="flex:1">${MODEL_LABELS[key]}</div>
            <div class="model-size">${mb}</div>${btn}</div>`;
    }).join("");
    wrap.innerHTML = `<div class="glist">${rows}</div>
        <div class="setting-desc" style="margin-top:6px">Models are stored in ${escHtml((W.modelsDir && W.modelsDir()) || "")}</div>`;
}
function deleteModel(key) {
    const W = wcpp(); if (!W) return;
    try {
        const p = W.modelPath(key);
        if (fs.existsSync(p) && confirm(`Delete ${MODEL_LABELS[key]} (${(fs.statSync(p).size/1048576|0)} MB)? It will re-download on next use.`)) {
            fs.unlinkSync(p);
            showToast("Model deleted", "success");
        }
    } catch (e) { showToast("Delete failed: " + e.message, "error"); }
    renderModelManager();
}
async function downloadModel(key) {
    const W = wcpp(); if (!W) return;
    try {
        setStatus(`Downloading ${key} model…`, "info");
        await W.ensureModel(key, (frac) => setStatus(`Downloading ${key}… ${Math.round(frac * 100)}%`, "info"));
        setStatus(`✓ ${key} model ready`, "success");
        showToast("Model downloaded", "success");
    } catch (e) { setStatus(e.message, "error"); showToast("Download failed", "error"); }
    renderModelManager();
}

// ── Range preview modal (silence cut / filler cut confirmation) ────────────
function showRangePreview(title, ranges, onApply) {
    let ov = $("range-preview-ov");
    if (ov) ov.remove();
    ov = document.createElement("div");
    ov.id = "range-preview-ov";
    ov.style.cssText = "position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center";
    const total = ranges.reduce((a, r) => a + (r.end - r.start), 0);
    const rows = ranges.map((r, i) => `
        <label style="display:flex;gap:8px;align-items:center;padding:4px 2px;border-bottom:1px solid var(--border2);font-size:12px;cursor:pointer">
          <input type="checkbox" class="rp-chk" data-i="${i}" checked>
          <span style="flex:1">#${i + 1} &nbsp; ${formatTime(r.start)} → ${formatTime(r.end)}</span>
          <span style="color:var(--text3)">${(r.end - r.start).toFixed(2)}s</span>
        </label>`).join("");
    ov.innerHTML = `
      <div style="background:var(--bg2,#16181d);border:1px solid var(--border2,#333);border-radius:12px;max-width:440px;width:92%;max-height:70vh;display:flex;flex-direction:column;padding:16px">
        <div style="font-weight:700;font-size:13px;margin-bottom:4px">${escHtml(title)}</div>
        <div style="font-size:11px;color:var(--text3);margin-bottom:8px">${ranges.length} range(s) · ~${total.toFixed(1)}s — uncheck any you want to keep</div>
        <div style="overflow-y:auto;flex:1">${rows}</div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">
          <button class="btn-secondary" id="rp-cancel">Cancel</button>
          <button class="btn-transcribe btn-compact" id="rp-apply" style="margin:0;width:auto;padding:6px 18px">Apply</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    $("rp-cancel").onclick = () => ov.remove();
    ov.onclick = e => { if (e.target === ov) ov.remove(); };
    $("rp-apply").onclick = () => {
        const keep = [...ov.querySelectorAll(".rp-chk")].filter(c => c.checked).map(c => ranges[+c.dataset.i]);
        ov.remove();
        if (keep.length) onApply(keep);
    };
}

// ── Filler-word ranges (word-timing based, for video cutting) ──────────────
function computeFillerRanges() {
    const list = getFillerList().filter(w => !w.includes(" "));   // single words only
    if (!list.length) return [];
    const set = new Set(list.map(w => w.toLowerCase()));
    const ranges = [];
    for (const seg of segments) {
        for (const w of (seg.words || [])) {
            if (w.start == null || w.end == null) continue;
            const clean = (w.word || "").toLowerCase().replace(/[.,!?;:"'()\[\]{}…-]/g, "");
            if (clean && set.has(clean)) {
                const start = (seg.seqStart - seg.start) + w.start;   // map to timeline
                const end   = (seg.seqStart - seg.start) + w.end;
                if (end - start > 0.04) ranges.push({ start: Math.max(0, start - 0.02), end: end + 0.02 });
            }
        }
    }
    // merge overlapping
    ranges.sort((a, b) => a.start - b.start);
    const merged = [];
    for (const r of ranges) {
        const last = merged[merged.length - 1];
        if (last && r.start <= last.end + 0.05) last.end = Math.max(last.end, r.end);
        else merged.push({ ...r });
    }
    return merged;
}
async function cutFillerWords() {
    if (!segments.length) { showToast("Transcribe first — filler cutting needs word timings", "info", 3500); return; }
    const ranges = computeFillerRanges();
    if (!ranges.length) { showToast("No filler words with word-timing found", "info", 3000); return; }
    showRangePreview("Cut filler words from video", ranges, async keep => {
        if (IS_DESKTOP_APP) { showToast("Use the Edit tab on desktop (exports a trimmed file)", "info", 3000); return; }
        setEditStatus(`Cutting ${keep.length} filler(s)…`, "info");
        await loadHostJSX();
        const arg = JSON.stringify(keep).replace(/'/g, "\\'");
        const r = await evalScript(`rippleDeleteRanges('${arg}')`);
        if (r && r.success) { setEditStatus(`✓ Removed ${r.removed} item(s)`, "success"); showToast("Fillers cut — undo with Cmd+Z in Premiere", "success", 5000); }
        else setEditStatus((r && r.error) || "Filler cut failed", "error");
    });
}

// ── Word-by-word captions (karaoke-style, one caption per word) ────────────
function buildWordSRT() {
    let out = "", n = 0;
    for (const seg of segments) {
        const words = (seg.words || []).filter(w => w && w.start != null && w.end != null && (w.word || "").trim());
        if (words.length) {
            const off = seg.seqStart - seg.start;
            for (let i = 0; i < words.length; i++) {
                const w = words[i];
                const start = off + w.start;
                const end   = Math.max(start + 0.08, off + (i + 1 < words.length ? Math.min(w.end, words[i+1].start) : w.end));
                out += `${++n}\n${formatTime(start)} --> ${formatTime(end)}\n${w.word.trim()}\n\n`;
            }
        } else {
            // fallback: proportional split of the segment text
            const toks = (seg.text || "").split(/\s+/).filter(Boolean);
            const dur = (seg.seqEnd - seg.seqStart) / Math.max(1, toks.length);
            toks.forEach((tk, i) => {
                const start = seg.seqStart + i * dur;
                out += `${++n}\n${formatTime(start)} --> ${formatTime(start + dur)}\n${tk}\n\n`;
            });
        }
    }
    return out;
}
async function sendWordCaptions() {
    if (!segments.length) { showToast("Nothing to send yet", "info", 2000); return; }
    if (IS_DESKTOP_APP) {   // desktop: save as SRT file instead
        if (window.exportWordSRTDesktop) window.exportWordSRTDesktop();
        return;
    }
    sendBtn.disabled = true;
    setStatus("Sending word-by-word captions…", "info");
    showProgress(true);
    const srt = buildWordSRT();
    const escaped = srt.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\r?\n/g, "\\n");
    const result = await evalScript(`importSRTToProject('${escaped}')`);
    showProgress(false); sendBtn.disabled = false;
    if (result && result.success) { setStatus(result.autoAdded ? "✓ Word-by-word captions on the timeline!" : "SRT saved — drag onto a caption track", "success"); showToast("Word captions sent", "success"); }
    else handleError((result && result.error) || "Failed");
}

// ── Settings profiles ─────────────────────────────────────────────────────
// An editor working for several clients re-dials the same style, reading speed
// and word lists on every job. These save that whole set under a name.
// Deliberately NOT saved: API keys, licence, UI language — those belong to the
// person, not the project.
const PROFILE_KEYS = [
    "stylePreset", "customStyle", "karaoke", "karaokeHi",
    "autoSplit", "maxCharsPerLine", "maxLines", "maxCps", "maxDur",
    "gapFill", "gapMax",
    "punctAllowed", "customDict", "promptWords", "autoCleanup",
    "fillerWords", "fillerOn", "profanityList", "profanityMode", "profStem",
    "model", "language", "engine", "diarize",
];

function listProfiles() {
    try { return JSON.parse(localStorage.getItem("ws_profiles") || "{}") || {}; }
    catch (e) { return {}; }
}
function writeProfiles(all) {
    try { localStorage.setItem("ws_profiles", JSON.stringify(all)); } catch (e) {}
}

function saveProfile(name) {
    name = String(name || "").trim();
    if (!name) { showToast(t("prof_need_name"), "info", 2500); return false; }
    const all = listProfiles();
    const snap = {};
    for (const k of PROFILE_KEYS) if (settings[k] !== undefined) snap[k] = settings[k];
    all[name] = { savedAt: Date.now(), settings: snap };
    writeProfiles(all);
    showToast(t("prof_saved").replace("%s", name), "success", 3000);
    return true;
}

function loadProfile(name) {
    const p = listProfiles()[name];
    if (!p) { showToast(t("prof_missing"), "error", 3000); return false; }
    Object.assign(settings, p.settings);
    saveSettings();
    // Repaint every control from the restored values, then re-apply formatting
    // so the segment list matches the profile immediately rather than at the
    // next edit.
    for (const fn of [initSettingsUI, initEditSettingsUI, initAudioSettingsUI, applyLanguage]) {
        try { if (typeof fn === "function") fn(); } catch (e) {}
    }
    if (segments.length && settings.autoSplit) {
        pushUndo();
        segments = applySmartSplit(segments, settings);
        renderSegments(); updateSegCount(); reselect();
    }
    showToast(t("prof_loaded").replace("%s", name), "success", 3000);
    return true;
}

function deleteProfile(name) {
    const all = listProfiles();
    if (!all[name]) return false;
    delete all[name];
    writeProfiles(all);
    showToast(t("prof_deleted").replace("%s", name), "info", 2500);
    return true;
}

// ── Bilingual SRT (original + translation in one file) ────────────────────
/* Two lines per cue: source on top, translation underneath — the convention
 * language learners and international clients expect. Reads the same numbered
 * AI output that exportTranslationSRT does, so Translate has to have run. */
function buildBilingualSRT(order) {
    const text = $("ai-output") ? $("ai-output").value : "";
    const map = parseNumberedAi(text);
    if (!Object.keys(map).length) return null;
    return segments.map((seg, i) => {
        const src = (seg.text || "").trim();
        const dst = (map[i] != null ? map[i] : "").trim();
        const body = !dst || dst === src ? src
                   : order === "translation-first" ? dst + "\n" + src
                   : src + "\n" + dst;
        return `${i + 1}\n${formatTime(seg.seqStart)} --> ${formatTime(seg.seqEnd)}\n${body}\n`;
    }).join("\n");
}

function exportBilingualSRT() {
    const srt = buildBilingualSRT(settings.bilingualOrder || "source-first");
    if (!srt) { showToast(t("bi_need_translate"), "info", 3500); return; }
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const outPath = path.join(os.homedir(), "Desktop", `captions_bilingual_${stamp}.srt`);
    try {
        fs.writeFileSync(outPath, srt, "utf8");
        setStatus(`Bilingual SRT → ${outPath}`, "success");
        showToast(t("bi_saved"), "success", 4000);
        revealInFolder(outPath);
    } catch (e) { showToast("Save failed: " + e.message, "error"); }
}

// ── Translation SRT export (from the AI panel translate output) ────────────
function exportTranslationSRT() {
    const text = $("ai-output") ? $("ai-output").value : "";
    const map = parseNumberedAi(text);
    if (!Object.keys(map).length) { showToast("Run Translate first (numbered output needed)", "info", 3000); return; }
    const lines = segments.map((seg, i) => {
        const t2 = map[i] != null ? map[i] : seg.text;
        return `${i + 1}\n${formatTime(seg.seqStart)} --> ${formatTime(seg.seqEnd)}\n${t2}\n`;
    }).join("\n");
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const outPath = path.join(os.homedir(), "Desktop", `captions_translated_${stamp}.srt`);
    try {
        fs.writeFileSync(outPath, lines, "utf8");
        setStatus(`Translated SRT → ${outPath}`, "success");
        showToast("Translated SRT saved to Desktop", "success");
        revealInFolder(outPath);
    } catch (e) { showToast("Save failed: " + e.message, "error"); }
}

// ── Onboarding (first run, 3 steps) ────────────────────────────────────────
function maybeShowOnboarding() {
    if (localStorage.getItem("ws_onboarded") === "1") return;
    const isTr = settings.uiLang === "tr";
    const steps = isTr ? [
        ["1 · Yazıya dök", IS_DESKTOP_APP ? "Bir video/ses dosyası aç (sürükle-bırak da olur) ve Transcribe'a bas. Model ilk seferde bir kez iner." : "Timeline'ında klip varken Transcribe'a bas. In/Out koymazsan tüm timeline yazıya dökülür."],
        ["2 · Düzenle", "Metne çift tıkla = düzenle · kelimeye tıkla = böl · Space = oynat/duraklat · Cmd/Ctrl+Z = geri al."],
        ["3 · Dışa aktar", IS_DESKTOP_APP ? "SRT/VTT/ASS olarak kaydet — CapCut, YouTube, Premiere hepsi açar." : "Send to Premiere = timeline'a caption track. Export menüsünden SRT de alabilirsin."],
    ] : [
        ["1 · Transcribe", IS_DESKTOP_APP ? "Open a video/audio file (drag & drop works) and hit Transcribe. The model downloads once." : "With clips on your timeline, hit Transcribe. No In/Out set = the whole timeline."],
        ["2 · Edit", "Double-click text to edit · click a word to split · Space = play/pause · Cmd/Ctrl+Z = undo."],
        ["3 · Export", IS_DESKTOP_APP ? "Save as SRT/VTT/ASS — CapCut, YouTube and Premiere all open them." : "Send to Premiere puts a caption track on the timeline. SRT export is in the menu too."],
    ];
    const ov = document.createElement("div");
    ov.id = "onboard-ov";
    ov.style.cssText = "position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center";
    ov.innerHTML = `
      <div style="background:var(--bg2,#16181d);border:1px solid var(--border2,#333);border-radius:14px;max-width:420px;width:90%;padding:22px">
        <div style="font-size:16px;font-weight:800;margin-bottom:2px">Subsper 👋</div>
        <div style="font-size:11px;color:var(--text3);margin-bottom:14px">${isTr ? "30 saniyede başla" : "Get going in 30 seconds"}</div>
        ${steps.map(s => `<div style="margin-bottom:12px"><div style="font-weight:700;font-size:12.5px;margin-bottom:2px">${s[0]}</div><div style="font-size:12px;color:var(--text2,#bbb);line-height:1.45">${s[1]}</div></div>`).join("")}
        <button class="btn-transcribe" id="onboard-ok" style="width:100%;margin-top:6px">${isTr ? "Başla" : "Let's go"}</button>
      </div>`;
    document.body.appendChild(ov);
    $("onboard-ok").onclick = () => { localStorage.setItem("ws_onboarded", "1"); ov.remove(); };
}

// ── Feature-pack init (runs AFTER desktop-app.js overrides, via setTimeout) ─
setTimeout(function initFeaturePack() {
    /* Each UI injection gets its own try/catch.
     *
     * This whole function used to sit inside one `try`, so the first section
     * that threw silently cancelled every section after it — a missing node in
     * the export menu could take out the model manager, the AI buttons and the
     * settings tab, with nothing visible to explain why. Logging the section
     * name turns "some feature vanished" into a line that says which one. */
    function step(name, fn) {
        try { fn(); }
        catch (e) { console.error("[Subsper] feature pack section '" + name + "' failed:", e); }
    }
    try {
        // Undo hooks around every mutating action
        ["deleteSegment", "splitSegmentHalf", "splitAtWord", "doReplaceAll",
         "applyAiToSubtitles", "applySyncProposal", "cleanAll", "editSegment",
         "applyDictionary", "removeFillers", "censorProfanity", "applyProofread"].forEach(name => {
            const orig = window[name];
            if (typeof orig === "function") window[name] = function () { pushUndo(); return orig.apply(this, arguments); };
        });
        document.addEventListener("keydown", e => {
            const el = document.activeElement, tag = el && el.tagName;
            const typing = tag === "INPUT" || tag === "TEXTAREA" || (el && el.isContentEditable);
            if (typing) return;
            const mod = e.metaKey || e.ctrlKey;
            if (mod && !e.shiftKey && e.key.toLowerCase() === "z") { e.preventDefault(); undoSegments(); }
            else if (mod && e.shiftKey && e.key.toLowerCase() === "z") { e.preventDefault(); redoSegments(); }
            else if (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
                e.preventDefault();
                nudgeSelected(e.shiftKey ? "end" : "start", e.key === "ArrowLeft" ? -0.1 : 0.1);
            }
        });

        step("export menu", () => {
            // Export menu: grouped extra entries. menuGroupAdd puts each feature
            // under a labeled group (Video / Premiere / Project) instead of a flat pile.
            window.menuGroupAdd = function (grpId, labelKey, text, fn, tip) {
                const grp = $(grpId); if (!grp) return null;
                if (labelKey && !grp.querySelector(".menu-group-label")) {
                    const lab = document.createElement("div");
                    lab.className = "menu-group-label";
                    lab.textContent = t(labelKey);
                    grp.appendChild(lab);
                }
                const b = document.createElement("button");
                b.innerHTML = `<span>${text}</span>`;
                if (tip) b.setAttribute("data-tip", tip);
                b.onclick = () => { const em2 = $("export-menu"); if (em2) em2.style.display = "none"; fn(); };
                grp.appendChild(b);
                return b;
            };
            if (IS_DESKTOP_APP) {
                menuGroupAdd("export-grp-files", null,
                    settings.uiLang === "tr" ? "Kelime kelime SRT" : "Word-by-word SRT",
                    sendWordCaptions, "TikTok-style: every word becomes its own cue");
            } else {
                menuGroupAdd("export-grp-premiere", "grp_premiere",
                    settings.uiLang === "tr" ? "Kelime kelime altyazı → timeline" : "Word-by-word captions → timeline",
                    sendWordCaptions, "TikTok-style: every word becomes its own caption cue");
            }
        });

        step("last export format", () => {
            // Remember last export format + preselect
            const origExport = window.exportAs;
            if (typeof origExport === "function") {
                window.exportAs = function (fmt) { try { settings.lastExport = fmt; saveSettings(); } catch (e) {} return origExport.apply(this, arguments); };
            }
        });

        step("AI panel buttons", () => {
            // AI panel: "Save translated SRT" — contextual, only visible after Translate
            const aiActions = $("ai-actions");
            if (aiActions) {
                const tb = document.createElement("button");
                tb.className = "btn-secondary";
                tb.id = "ai-srt-btn";
                tb.style.display = "none";
                tb.textContent = settings.uiLang === "tr" ? "Çeviriyi SRT kaydet" : "Save translated SRT";
                tb.onclick = exportTranslationSRT;
                aiActions.appendChild(tb);

                // Bilingual: source and translation stacked in one cue. Same
                // contextual visibility — it needs Translate to have run.
                const bb = document.createElement("button");
                bb.className = "btn-secondary";
                bb.id = "ai-bilingual-btn";
                bb.style.display = "none";
                bb.textContent = t("bi_export");
                bb.setAttribute("data-tip", t("bi_need_translate"));
                bb.onclick = exportBilingualSRT;
                aiActions.appendChild(bb);
            }
        });

        step("edit-tools buttons", () => {
            // Extension-only: caption pull + filler cut buttons on the Edit-tools panel
            if (!IS_DESKTOP_APP) {
                const edPanel = (document.querySelector("#panel-ed-work .setup-scroll") || document.getElementById("panel-ed-work"));
                if (edPanel) {
                    const wrap = document.createElement("div");
                    wrap.className = "setting-item tool-card";
                    wrap.innerHTML = `
                      <div class="setting-row"><div class="setting-info">
                        <div class="setting-name">${settings.uiLang === "tr" ? "Dolgu Kelime Kes (deneysel)" : "Cut Filler Words (experimental)"}</div>
                        <div class="setting-desc">${settings.uiLang === "tr" ? "ee, ıı, şey… kelimelerini videodan ripple-delete ile keser. Önce Transcribe." : "Ripple-deletes ee/um/uh words from the video. Transcribe first."}</div>
                      </div></div>
                      <button class="btn-transcribe btn-compact" id="filler-cut-btn" style="margin-top:8px">${settings.uiLang === "tr" ? "Dolguları Kes" : "Cut Fillers"}</button>`;
                    edPanel.appendChild(wrap);
                    $("filler-cut-btn").onclick = cutFillerWords;
                }
            }
        });

        step("secondary actions", () => {
            // Compact secondary-actions row under the main controls (shared helper —
            // desktop adds Batch here, extension adds caption pull). Keeps the primary
            // Transcribe/Play area clean instead of stacking full-width buttons.
            window.secondaryAdd = function (text, fn, tip) {
                const txControls = document.querySelector("#panel-tx-work .controls");
                if (!txControls) return null;
                let row = $("secondary-actions");
                if (!row) {
                    row = document.createElement("div");
                    row.id = "secondary-actions";
                    txControls.appendChild(row);
                }
                const b = document.createElement("button");
                b.className = "btn-ghost";
                b.textContent = text;
                if (tip) b.setAttribute("data-tip", tip);
                b.onclick = fn;
                row.appendChild(b);
                return b;
            };
            // (timeline caption pull removed — Premiere doesn't expose caption
            //  contents reliably; Load SRT + File>Export>Captions covers the need)
        });

        step("setup tab", () => {
            // Setup tab: model manager + report button
            const setupPanel = $("panel-setup");
            if (setupPanel) {
                const sc = setupPanel.querySelector(".setup-scroll") || setupPanel;
                const rep = document.createElement("div");
                rep.innerHTML = `<div class="setup-section-title" style="margin-top:14px">Feedback</div>
                  <div class="setting-item"><div class="setting-row"><div class="setting-info">
                    <div class="setting-name">Report a problem</div>
                    <div class="setting-desc">Opens a GitHub issue prefilled with your app version and the last engine-log lines. No data is sent automatically.</div>
                  </div><button class="btn-secondary" onclick="reportProblem()">Report</button></div></div>
                  <div class="setting-desc" style="margin-top:10px;text-align:center;color:var(--text3)">Subsper v${APP_VERSION} · by zipheron</div>`;
                sc.appendChild(rep);
            }
            // Re-render models with the manager whenever diagnostics render them
            const origRenderModels = window.renderModels;
            if (typeof origRenderModels === "function") window.renderModels = function () { renderModelManager(); };
            renderModelManager();

            // ── Settings tab = GENERAL settings only (Interface, AI & API) + a
            //    "Setup" subsection. Subtitle/Edit/Audio settings stay under their
            //    own tabs' Settings sub-tab (user was explicit about this).
            try {
                const dst = document.querySelector("#panel-su-main .setup-scroll");
                const src = document.querySelector("#panel-tx-settings .setup-scroll");
                if (dst && src) {
                    // pull the Interface + AI&API sections (title + everything until
                    // the next section title) OUT of the Subtitle settings panel into
                    // the Settings tab's "Ayarlar" sub-page. Setup stays on its own
                    // sub-page untouched.
                    const pulled = { sec_interface: [], sec_api: [] };
                    let cur = null;
                    for (const node of [...src.children]) {
                        const isTitle = node.classList && node.classList.contains("setup-section-title");
                        if (isTitle) {
                            const key = (node.querySelector("[data-i18n]") || node).getAttribute("data-i18n");
                            cur = (key === "sec_interface" || key === "sec_api") ? key : null;
                        }
                        if (cur) pulled[cur].push(node);
                    }
                    pulled.sec_interface.forEach(n => dst.appendChild(n));
                    pulled.sec_api.forEach(n => dst.appendChild(n));
                    const first = dst.querySelector(".setup-section-title");
                    if (first) first.style.marginTop = "0";
                }
            } catch (eMig) { console.error("[Subsper] settings migration failed:", eMig); }

            maybeShowOnboarding();
            checkForUpdates();
        });

        } catch (e) { console.error("[Subsper] feature pack init failed:", e); }
}, 0);

/* ═══════════════════════════════════════════════════════════════════════════
   v1.10 feature pack — project save/load, hooks/clips, profanity beep ranges,
   MOGRT styled graphics, translation→Premiere, style favorites, notifications,
   extra UI languages. Same rules: dynamic injection, defensive, shared.
   ═══════════════════════════════════════════════════════════════════════════ */

// ── Extra UI languages (core subset — anything missing falls back to English)
Object.assign(I18N, {
  es: {
    tagline: "Subtítulos con IA", status_ready: "Listo — pulsa Transcribir",
    tab_transcribe: "Subtítulos", tab_edit: "Edición", tab_audio: "Audio", tab_setup: "Ajustes",
    sub_work_tx: "Editar", sub_settings: "Ajustes", sub_actions: "Herramientas",
    lbl_model: "Modelo", lbl_language: "Idioma", opt_auto: "Detección automática",
    btn_transcribe: "Transcribir", btn_loadsrt: "Cargar SRT", btn_play: "Reproducir", btn_pause: "Pausa",
    empty_p: "Pulsa Transcribir para subtitular tu vídeo.",
    empty_hint: "Clic en una palabra = dividir · doble clic = editar.",
    act_clear: "Borrar", act_send: "Enviar a Premiere",
    export_title: "Exportar como…", clean_title: "Limpiar…",
    sec_engine: "Motor de transcripción", sec_cleanup: "Limpieza del texto",
    sec_quality: "Calidad de subtítulos", sec_style: "Estilo", sec_interface: "Interfaz",
    sec_modellang: "Modelo e idioma", sec_api: "IA y API", sec_timing: "Sincronización", sec_karaoke: "Karaoke",
    lbl_uilang: "Idioma", lbl_theme: "Apariencia", theme_dark: "Oscuro", theme_light: "Claro", theme_auto: "Auto",
    btn_replaceall: "Reemplazar todo", btn_cancel: "Cancelar", btn_close: "Cerrar",
    nm_engine: "Motor", opt_eng_cpp: "Motor integrado — sin instalación ★",
    nm_hwaccel: "Aceleración por hardware", nm_threads: "Núcleos de CPU",
    nm_autoformat: "Autoformatear subtítulos", lbl_cpl: "Máx. caracteres por línea",
  },
  de: {
    tagline: "KI-Untertitel", status_ready: "Bereit — klicke auf Transkribieren",
    tab_transcribe: "Untertitel", tab_edit: "Schnitt", tab_audio: "Audio", tab_setup: "Setup",
    sub_work_tx: "Bearbeiten", sub_settings: "Einstellungen", sub_actions: "Werkzeuge",
    lbl_model: "Modell", lbl_language: "Sprache", opt_auto: "Automatisch erkennen",
    btn_transcribe: "Transkribieren", btn_loadsrt: "SRT laden", btn_play: "Abspielen", btn_pause: "Pause",
    empty_p: "Klicke auf Transkribieren, um dein Video zu untertiteln.",
    empty_hint: "Klick auf ein Wort = teilen · Doppelklick = bearbeiten.",
    act_clear: "Leeren", act_send: "An Premiere senden",
    export_title: "Exportieren als…", clean_title: "Bereinigen…",
    sec_engine: "Transkriptions-Engine", sec_cleanup: "Textbereinigung",
    sec_quality: "Untertitel-Qualität", sec_style: "Stil", sec_interface: "Oberfläche",
    sec_modellang: "Modell & Sprache", sec_api: "KI & API", sec_timing: "Timing", sec_karaoke: "Karaoke",
    lbl_uilang: "Sprache", lbl_theme: "Erscheinungsbild", theme_dark: "Dunkel", theme_light: "Hell", theme_auto: "Auto",
    btn_replaceall: "Alle ersetzen", btn_cancel: "Abbrechen", btn_close: "Schließen",
    nm_engine: "Engine", opt_eng_cpp: "Integrierte Engine — keine Installation ★",
    nm_hwaccel: "Hardware-Beschleunigung", nm_threads: "CPU-Threads",
    nm_autoformat: "Untertitel autoformatieren", lbl_cpl: "Max. Zeichen pro Zeile",
  },
  pt: {
    tagline: "Legendas com IA", status_ready: "Pronto — clique em Transcrever",
    tab_transcribe: "Legendas", tab_edit: "Edição", tab_audio: "Áudio", tab_setup: "Config",
    sub_work_tx: "Editar", sub_settings: "Configurações", sub_actions: "Ferramentas",
    lbl_model: "Modelo", lbl_language: "Idioma", opt_auto: "Detecção automática",
    btn_transcribe: "Transcrever", btn_loadsrt: "Carregar SRT", btn_play: "Reproduzir", btn_pause: "Pausar",
    empty_p: "Clique em Transcrever para legendar seu vídeo.",
    empty_hint: "Clique numa palavra = dividir · duplo clique = editar.",
    act_clear: "Limpar", act_send: "Enviar ao Premiere",
    export_title: "Exportar como…", clean_title: "Limpar…",
    sec_engine: "Motor de transcrição", sec_cleanup: "Limpeza do texto",
    sec_quality: "Qualidade das legendas", sec_style: "Estilo", sec_interface: "Interface",
    sec_modellang: "Modelo e idioma", sec_api: "IA e API", sec_timing: "Sincronização", sec_karaoke: "Karaokê",
    lbl_uilang: "Idioma", lbl_theme: "Aparência", theme_dark: "Escuro", theme_light: "Claro", theme_auto: "Auto",
    btn_replaceall: "Substituir tudo", btn_cancel: "Cancelar", btn_close: "Fechar",
    nm_engine: "Motor", opt_eng_cpp: "Motor integrado — sem instalação ★",
    nm_hwaccel: "Aceleração de hardware", nm_threads: "Threads de CPU",
    nm_autoformat: "Autoformatar legendas", lbl_cpl: "Máx. de caracteres por linha",
  },
});
Object.assign(I18N, {
  fr: {
    tagline: "Sous-titres IA", status_ready: "Prêt — cliquez sur Transcrire",
    tab_transcribe: "Sous-titres", tab_edit: "Montage", tab_audio: "Audio", tab_setup: "Réglages",
    sub_work_tx: "Éditer", sub_settings: "Réglages", sub_actions: "Outils",
    lbl_model: "Modèle", lbl_language: "Langue", opt_auto: "Détection auto",
    btn_transcribe: "Transcrire", btn_loadsrt: "Charger SRT", btn_play: "Lecture", btn_pause: "Pause",
    empty_p: "Cliquez sur Transcrire pour sous-titrer votre vidéo.",
    empty_hint: "Clic sur un mot = couper · double-clic = éditer.",
    act_clear: "Effacer", act_send: "Envoyer à Premiere",
    export_title: "Exporter en…", clean_title: "Nettoyer…",
    sec_engine: "Moteur de transcription", sec_cleanup: "Nettoyage du texte",
    sec_quality: "Qualité des sous-titres", sec_style: "Style", sec_interface: "Interface",
    sec_modellang: "Modèle et langue", sec_api: "IA et API", sec_timing: "Synchronisation", sec_karaoke: "Karaoké",
    lbl_uilang: "Langue", lbl_theme: "Apparence", theme_dark: "Sombre", theme_light: "Clair", theme_auto: "Auto",
    btn_replaceall: "Tout remplacer", btn_cancel: "Annuler", btn_close: "Fermer",
    nm_engine: "Moteur", opt_eng_cpp: "Moteur intégré — sans installation ★",
    nm_hwaccel: "Accélération matérielle", nm_threads: "Threads CPU",
    nm_autoformat: "Formater automatiquement", lbl_cpl: "Caractères max par ligne",
  },
  ru: {
    tagline: "ИИ-субтитры", status_ready: "Готово — нажмите «Транскрибировать»",
    tab_transcribe: "Субтитры", tab_edit: "Монтаж", tab_audio: "Аудио", tab_setup: "Настройки",
    sub_work_tx: "Правка", sub_settings: "Настройки", sub_actions: "Инструменты",
    lbl_model: "Модель", lbl_language: "Язык", opt_auto: "Автоопределение",
    btn_transcribe: "Транскрибировать", btn_loadsrt: "Загрузить SRT", btn_play: "Играть", btn_pause: "Пауза",
    empty_p: "Нажмите «Транскрибировать», чтобы создать субтитры.",
    empty_hint: "Клик по слову — разделить · двойной клик — правка.",
    act_clear: "Очистить", act_send: "Отправить в Premiere",
    export_title: "Экспорт как…", clean_title: "Очистка…",
    sec_engine: "Движок транскрипции", sec_cleanup: "Очистка текста",
    sec_quality: "Качество субтитров", sec_style: "Стиль", sec_interface: "Интерфейс",
    sec_modellang: "Модель и язык", sec_api: "ИИ и API", sec_timing: "Тайминг", sec_karaoke: "Караоке",
    lbl_uilang: "Язык", lbl_theme: "Оформление", theme_dark: "Тёмное", theme_light: "Светлое", theme_auto: "Авто",
    btn_replaceall: "Заменить все", btn_cancel: "Отмена", btn_close: "Закрыть",
    nm_engine: "Движок", opt_eng_cpp: "Встроенный движок — без установки ★",
    nm_hwaccel: "Аппаратное ускорение", nm_threads: "Потоки CPU",
    nm_autoformat: "Автоформат субтитров", lbl_cpl: "Макс. символов в строке",
  },
  ar: {
    tagline: "ترجمة بالذكاء الاصطناعي", status_ready: "جاهز — اضغط تفريغ",
    tab_transcribe: "الترجمة", tab_edit: "تحرير", tab_audio: "الصوت", tab_setup: "الإعداد",
    sub_work_tx: "تحرير", sub_settings: "الإعدادات", sub_actions: "أدوات",
    lbl_model: "النموذج", lbl_language: "اللغة", opt_auto: "كشف تلقائي",
    btn_transcribe: "تفريغ", btn_loadsrt: "تحميل SRT", btn_play: "تشغيل", btn_pause: "إيقاف",
    empty_p: "اضغط تفريغ لإنشاء ترجمة للفيديو.",
    empty_hint: "انقر كلمة = تقسيم · نقر مزدوج = تحرير.",
    act_clear: "مسح", act_send: "أرسل إلى Premiere",
    export_title: "تصدير كـ…", clean_title: "تنظيف…",
    sec_engine: "محرك التفريغ", sec_cleanup: "تنظيف النص",
    sec_quality: "جودة الترجمة", sec_style: "النمط", sec_interface: "الواجهة",
    sec_modellang: "النموذج واللغة", sec_api: "ذكاء اصطناعي وAPI", sec_timing: "التوقيت", sec_karaoke: "كاريوكي",
    lbl_uilang: "اللغة", lbl_theme: "المظهر", theme_dark: "داكن", theme_light: "فاتح", theme_auto: "تلقائي",
    btn_replaceall: "استبدال الكل", btn_cancel: "إلغاء", btn_close: "إغلاق",
    nm_engine: "المحرك", opt_eng_cpp: "محرك مدمج — بدون تثبيت ★",
    nm_hwaccel: "تسريع عتادي", nm_threads: "خيوط المعالج",
    nm_autoformat: "تنسيق تلقائي للترجمة", lbl_cpl: "أقصى حروف بالسطر",
  },
  az: {
    tagline: "Süni intellekt altyazı", status_ready: "Hazır — Transkript düyməsinə basın",
    tab_transcribe: "Altyazı", tab_edit: "Montaj", tab_audio: "Səs", tab_setup: "Quraşdırma",
    sub_work_tx: "Redaktə", sub_settings: "Parametrlər", sub_actions: "Alətlər",
    lbl_model: "Model", lbl_language: "Dil", opt_auto: "Avtomatik",
    btn_transcribe: "Transkript", btn_loadsrt: "SRT yüklə", btn_play: "Oynat", btn_pause: "Fasilə",
    empty_p: "Videonuza altyazı üçün Transkript düyməsinə basın.",
    empty_hint: "Sözə klik = böl · ikiqat klik = redaktə.",
    act_clear: "Təmizlə", act_send: "Premiere-ə göndər",
    export_title: "Belə ixrac et…", clean_title: "Təmizlik…",
    sec_engine: "Transkript mühərriki", sec_cleanup: "Mətn təmizliyi",
    sec_quality: "Altyazı keyfiyyəti", sec_style: "Üslub", sec_interface: "İnterfeys",
    sec_modellang: "Model və dil", sec_api: "Sİ və API", sec_timing: "Zamanlama", sec_karaoke: "Karaoke",
    lbl_uilang: "Dil", lbl_theme: "Görünüş", theme_dark: "Tünd", theme_light: "Açıq", theme_auto: "Avto",
    btn_replaceall: "Hamısını əvəz et", btn_cancel: "Ləğv et", btn_close: "Bağla",
    nm_engine: "Mühərrik", opt_eng_cpp: "Daxili mühərrik — quraşdırma yoxdur ★",
    nm_hwaccel: "Aparat sürətləndirmə", nm_threads: "CPU axınları",
    nm_autoformat: "Altyazını avto-formatla", lbl_cpl: "Sətirdə maks. simvol",
  },
  uz: {
    tagline: "SI subtitrlar", status_ready: "Tayyor — Transkripsiya'ni bosing",
    tab_transcribe: "Subtitr", tab_edit: "Tahrir", tab_audio: "Audio", tab_setup: "Sozlama",
    sub_work_tx: "Tahrirlash", sub_settings: "Sozlamalar", sub_actions: "Vositalar",
    lbl_model: "Model", lbl_language: "Til", opt_auto: "Avto aniqlash",
    btn_transcribe: "Transkripsiya", btn_loadsrt: "SRT yuklash", btn_play: "Ijro", btn_pause: "Pauza",
    empty_p: "Videoga subtitr uchun Transkripsiya'ni bosing.",
    empty_hint: "So'zga bosing = bo'lish · ikki marta bosing = tahrir.",
    act_clear: "Tozalash", act_send: "Premiere'ga yuborish",
    export_title: "Sifatida eksport…", clean_title: "Tozalash…",
    sec_engine: "Transkripsiya dvigateli", sec_cleanup: "Matn tozalash",
    sec_quality: "Subtitr sifati", sec_style: "Uslub", sec_interface: "Interfeys",
    sec_modellang: "Model va til", sec_api: "SI va API", sec_timing: "Vaqt", sec_karaoke: "Karaoke",
    lbl_uilang: "Til", lbl_theme: "Ko'rinish", theme_dark: "Qorong'i", theme_light: "Yorug'", theme_auto: "Avto",
    btn_replaceall: "Hammasini almashtirish", btn_cancel: "Bekor", btn_close: "Yopish",
    nm_engine: "Dvigatel", opt_eng_cpp: "O'rnatilgan dvigatel — o'rnatishsiz ★",
    nm_hwaccel: "Apparat tezlashtirish", nm_threads: "CPU oqimlari",
    nm_autoformat: "Subtitrni avto-format", lbl_cpl: "Qatordagi maks. belgi",
  },
  kk: {
    tagline: "ЖИ субтитрлер", status_ready: "Дайын — «Транскрипциялау» басыңыз",
    tab_transcribe: "Субтитр", tab_edit: "Өңдеу", tab_audio: "Аудио", tab_setup: "Баптау",
    sub_work_tx: "Өңдеу", sub_settings: "Баптаулар", sub_actions: "Құралдар",
    lbl_model: "Модель", lbl_language: "Тіл", opt_auto: "Авто анықтау",
    btn_transcribe: "Транскрипциялау", btn_loadsrt: "SRT жүктеу", btn_play: "Ойнату", btn_pause: "Кідірту",
    empty_p: "Видеоға субтитр үшін «Транскрипциялау» басыңыз.",
    empty_hint: "Сөзге басу = бөлу · қос басу = өңдеу.",
    act_clear: "Тазалау", act_send: "Premiere-ге жіберу",
    export_title: "Былай экспорттау…", clean_title: "Тазалау…",
    sec_engine: "Транскрипция қозғалтқышы", sec_cleanup: "Мәтінді тазалау",
    sec_quality: "Субтитр сапасы", sec_style: "Стиль", sec_interface: "Интерфейс",
    sec_modellang: "Модель мен тіл", sec_api: "ЖИ және API", sec_timing: "Уақыт", sec_karaoke: "Караоке",
    lbl_uilang: "Тіл", lbl_theme: "Көрінісі", theme_dark: "Қараңғы", theme_light: "Ашық", theme_auto: "Авто",
    btn_replaceall: "Барлығын алмастыру", btn_cancel: "Болдырмау", btn_close: "Жабу",
    nm_engine: "Қозғалтқыш", opt_eng_cpp: "Кірістірілген қозғалтқыш — орнатусыз ★",
    nm_hwaccel: "Аппараттық жеделдету", nm_threads: "CPU ағындары",
    nm_autoformat: "Субтитрді авто-пішімдеу", lbl_cpl: "Жолдағы макс. таңба",
  },
});

// ── Profanity ranges (word-timing based, for audio beeping) ────────────────
function computeProfanityRanges() {
    let list = BUILTIN_PROFANITY.slice();
    (settings.profanityList || "").split(/[,\n]/).forEach(w => { w = w.trim(); if (w) list.push(w); });
    const set = new Set(list.map(w => w.toLowerCase()));
    const ranges = [];
    for (const seg of segments) {
        for (const w of (seg.words || [])) {
            if (w.start == null || w.end == null) continue;
            const clean = (w.word || "").toLowerCase().replace(/[.,!?;:"'()\[\]{}…*-]/g, "");
            if (!clean) continue;
            // Exact hit → beep the whole word. Stem hit (kanın ⊃ kan) → beep only
            // the root's share of the word, so the suffix stays audible.
            let ratio = 0;
            if (set.has(clean)) ratio = 1;
            else if (settings.profStem !== false) {
                for (const root of set) {
                    if (root.length >= 3 && clean.length > root.length &&
                        clean.length - root.length <= 6 && clean.startsWith(root)) {
                        ratio = root.length / clean.length; break;
                    }
                }
            }
            if (ratio > 0) {
                const off = seg.seqStart - seg.start;
                const shift = (settings.beepShift || 0) / 1000;
                const pad   = (settings.beepPad ?? 40) / 1000;
                const rootEnd = w.start + (w.end - w.start) * ratio;
                ranges.push({ start: Math.max(0, off + w.start + shift - pad),
                              end:   Math.max(0.05, off + rootEnd + shift + pad) });
            }
        }
    }
    ranges.sort((a, b) => a.start - b.start);
    const merged = [];
    for (const r of ranges) {
        const last = merged[merged.length - 1];
        if (last && r.start <= last.end + 0.05) last.end = Math.max(last.end, r.end);
        else merged.push({ ...r });
    }
    return merged;
}

// ── Project save / load (.subsper JSON) + crash-safe autosave ──────────────
function _projectData() {
    return {
        app: "subsper", version: APP_VERSION, savedAt: new Date().toISOString(),
        mediaPath: (typeof window !== "undefined" && window.__SUBSPER_MEDIA__) || null,
        seqInTime, lastLanguage,
        segments,
        settings: { stylePreset: settings.stylePreset, customStyle: settings.customStyle,
                    karaoke: settings.karaoke, karaokeHi: settings.karaokeHi },
    };
}
function _loadProjectData(data) {
    if (!data || data.app !== "subsper" || !Array.isArray(data.segments)) throw new Error("Not a Subsper project file.");
    pushUndo();
    segments = data.segments;
    seqInTime = data.seqInTime || 0;
    lastLanguage = data.lastLanguage || "";
    if (data.settings) { Object.assign(settings, data.settings); saveSettings(); }
    renderSegments(); updateSegCount();
    actionsBar.style.display = segments.length ? "flex" : "none";
    sendBtn.disabled = segments.length === 0;
    setStatus(`Project loaded — ${segments.length} segment(s)`, "success");
}
function saveProject() {
    if (!segments.length) { showToast("Nothing to save yet", "info", 2000); return; }
    const json = JSON.stringify(_projectData(), null, 1);
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const defName = `project_${stamp}.subsper`;
    let outPath = null;
    try {
        if (window.cep && window.cep.fs && window.cep.fs.showSaveDialogEx) {
            const res = window.cep.fs.showSaveDialogEx("Save Subsper project", "", ["subsper"], defName, "SUBSPER");
            if (res && res.data) outPath = res.data;
        }
    } catch (e) {}
    if (!outPath) outPath = path.join(os.homedir(), "Desktop", defName);
    try {
        fs.writeFileSync(outPath, json, "utf8");
        setStatus(`Project saved → ${outPath}`, "success");
        showToast("Project saved", "success");
    } catch (e) { showToast("Save failed: " + e.message, "error"); }
}
function openProject() {
    try {
        if (window.cep && window.cep.fs && window.cep.fs.showOpenDialogEx) {
            const res = window.cep.fs.showOpenDialogEx(false, false, "Open Subsper project", "", ["subsper"]);
            const p = res && res.data && res.data[0];
            if (p) { _loadProjectData(JSON.parse(fs.readFileSync(p, "utf8"))); return; }
        }
    } catch (e) { showToast("Open failed: " + e.message, "error"); return; }
    // fallback: hidden input (desktop overrides with native dialog)
    const inp = document.createElement("input");
    inp.type = "file"; inp.accept = ".subsper,.json";
    inp.onchange = () => {
        const f = inp.files[0]; if (!f) return;
        try { _loadProjectData(JSON.parse(fs.readFileSync(f.path, "utf8"))); }
        catch (e) { showToast("Open failed: " + e.message, "error"); }
    };
    inp.click();
}
// Autosave every 20s → localStorage; offer restore on next start if unsaved work existed.
setInterval(() => {
    try {
        if (segments && segments.length) localStorage.setItem("ws_autosave", JSON.stringify(_projectData()));
    } catch (e) {}
}, 20000);
function maybeOfferRestore() {
    try {
        const raw = localStorage.getItem("ws_autosave");
        if (!raw || (segments && segments.length)) return;
        const data = JSON.parse(raw);
        if (!data.segments || !data.segments.length) return;
        const when = (data.savedAt || "").replace("T", " ").slice(0, 16);
        const bar = document.createElement("div");
        bar.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:9997;display:flex;gap:10px;align-items:center;justify-content:center;padding:8px;background:var(--bg3,#222);border-bottom:1px solid var(--border2,#333);font-size:12px";
        const isTr = settings.uiLang === "tr";
        bar.innerHTML = `<span>${isTr ? "Kaydedilmemiş çalışma bulundu" : "Unsaved work found"} (${data.segments.length} seg · ${when})</span>
          <button class="btn-secondary" id="rest-yes" style="padding:3px 12px">${isTr ? "Geri yükle" : "Restore"}</button>
          <button class="btn-secondary" id="rest-no" style="padding:3px 12px">${isTr ? "Sil" : "Discard"}</button>`;
        document.body.appendChild(bar);
        $("rest-yes").onclick = () => { try { _loadProjectData(data); } catch (e) {} bar.remove(); };
        $("rest-no").onclick = () => { localStorage.removeItem("ws_autosave"); bar.remove(); };
    } catch (e) {}
}

// ── Style favorites (save current Custom style under a name) ───────────────
function saveStyleFavorite() {
    const name = prompt(settings.uiLang === "tr" ? "Favori stile isim ver:" : "Name this style favorite:");
    if (!name) return;
    const favs = settings.styleFavs || [];
    favs.push({ name: name.slice(0, 24), style: { ...DEFAULT_CUSTOM_STYLE, ...(settings.customStyle || {}) } });
    settings.styleFavs = favs.slice(-8);
    saveSettings(); renderStyleFavs();
    showToast("Style favorite saved", "success");
}
function applyStyleFavorite(i) {
    const fav = (settings.styleFavs || [])[i];
    if (!fav) return;
    settings.customStyle = { ...fav.style };
    settings.stylePreset = "custom";
    saveSettings(); renderStyleChips(); updateStylePreview();
}
function deleteStyleFavorite(i) {
    (settings.styleFavs || []).splice(i, 1);
    saveSettings(); renderStyleFavs();
}
function renderStyleFavs() {
    let row = $("style-favs-row");
    const chips = $("style-chips");
    if (!chips) return;
    if (!row) {
        row = document.createElement("div");
        row.id = "style-favs-row";
        row.style.cssText = "display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;align-items:center";
        chips.parentElement.insertBefore(row, chips.nextSibling);
    }
    const favs = settings.styleFavs || [];
    row.innerHTML = favs.map((f, i) =>
        `<button class="style-chip" onclick="applyStyleFavorite(${i})" oncontextmenu="deleteStyleFavorite(${i});return false" data-tip="Click = apply · right-click = delete">★ ${escHtml(f.name)}</button>`).join("") +
        `<button class="style-chip" onclick="saveStyleFavorite()" data-tip="${settings.uiLang === "tr" ? "Mevcut Custom stili favorilere kaydet" : "Save the current Custom style as a favorite"}">＋ ${settings.uiLang === "tr" ? "Favori" : "Favorite"}</button>`;
}

// ── Hook / viral-clip finder (parses the AI Shorts output timecodes) ───────
function parseAiClipRanges(text) {
    const out = [];
    const re = /(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(?:-|–|—|to|→)\s*(\d{1,2}):(\d{2})(?::(\d{2}))?/g;
    let m;
    while ((m = re.exec(text || "")) !== null) {
        const s = m[3] != null ? (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) : (+m[1]) * 60 + (+m[2]);
        const e = m[6] != null ? (+m[4]) * 3600 + (+m[5]) * 60 + (+m[6]) : (+m[4]) * 60 + (+m[5]);
        if (e > s && e - s <= 600) out.push({ start: s, end: e });
    }
    // dedupe overlaps
    const seen = [];
    return out.filter(r => {
        if (seen.some(x => Math.abs(x.start - r.start) < 1 && Math.abs(x.end - r.end) < 1)) return false;
        seen.push(r); return true;
    });
}
async function aiClipsAction() {
    const ranges = parseAiClipRanges($("ai-output") ? $("ai-output").value : "");
    if (!ranges.length) { showToast(settings.uiLang === "tr" ? "Önce 'Shorts Çıkar' çalıştır — çıktıda MM:SS-MM:SS aralıkları olmalı" : "Run 'Extract Shorts' first — output needs MM:SS-MM:SS ranges", "info", 4500); return; }
    if (IS_DESKTOP_APP) {
        if (window.exportAiClipsDesktop) window.exportAiClipsDesktop(ranges);
        return;
    }
    // Extension: drop a marker at each hook so the editor can jump & cut
    await loadHostJSX();
    const marks = ranges.map((r, i) => ({ start: r.start, end: r.end, dur: +(r.end - r.start).toFixed(1) }));
    const res = await evalScript(`addSilenceMarkers('${JSON.stringify(marks).replace(/'/g, "\\'")}')`);
    if (res && res.success) showToast(`${res.added} hook marker(s) added to the timeline`, "success", 5000);
    else showToast((res && res.error) || "Could not add markers", "error");
}

// ── Beep profanity ──────────────────────────────────────────────────────────
// Desktop: exports a beeped copy of the file. Extension: generates a beep-only
// WAV (silent except 1 kHz at the ranges) and lays it on a NEW audio track at 0
// — a real beep on the timeline. Mute/lower the original words manually if the
// underlying audio must be fully hidden.
function beepProfanityAction() {
    if (!segments.length) { showToast("Transcribe first — beeping needs word timings", "info", 3000); return; }
    const ranges = computeProfanityRanges();
    if (!ranges.length) { showToast(settings.uiLang === "tr" ? "Küfür bulunamadı — Ayarlar'daki küfür listesi + kelime zamanları kullanılır" : "No profanity found (uses the Settings profanity list + word timings)", "info", 4000); return; }
    const mute = (settings.beepMode === "mute");
    const title = settings.uiLang === "tr" ? (mute ? "Küfürleri sustur" : "Küfürleri biple") : (mute ? "Mute profanity" : "Beep profanity");
    showRangePreview(title, ranges, async (chosen) => {
        if (IS_DESKTOP_APP) {
            if (window.beepProfanityDesktop) window.beepProfanityDesktop(chosen, mute);
            return;
        }
        const W = wcpp();
        if (!W || !W.beepTrackWav) { showToast("Engine unavailable", "error"); return; }
        try {
            // Mute mode: no beep track — just duck the speech to 0 during the ranges.
            let r = { success: true, track: -1 };
            if (!mute) {
                setStatus(settings.uiLang === "tr" ? "Bip sesi üretiliyor…" : "Generating beep track…", "info");
                showProgress(true);
                const wav = path.join(os.tmpdir(), `subsper_beep_${Date.now()}.wav`);
                await W.beepTrackWav(extDir(), chosen, wav, { spawnOpts: { env: spawnEnv() } });
                await loadHostJSX();
                r = await evalScript(`insertAudioAtStart('${wav.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}')`);
            } else {
                await loadHostJSX();
            }
            // Duck (or mute) ONLY the transcribed speech clips during the beeped
            // ranges — never music beds, never the beep track we just inserted.
            let ducked = null;
            try {
                const duckLevel = mute ? 0 : Math.max(0, Math.min(1, (settings.beepDuck || 0) / 100));
                let paths = [];
                try {
                    const si = await evalScript("getSequenceInfo()");
                    if (si && si.clips) paths = si.clips.map(c => c.path).filter(Boolean);
                } catch (eSI) {}
                const dArg = JSON.stringify({
                    ranges: chosen, level: duckLevel, paths,
                    skipTrack: (r && r.success && typeof r.track === "number") ? r.track : -1,
                }).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
                ducked = await evalScript(`duckAudioRanges('${dArg}')`);
                if (ducked && ducked.diag) console.log("[Subsper] duck diag:", ducked.diag);
            } catch (eD) {}
            if (r && r.success) {
                const duckedOk = ducked && ducked.success && ducked.keyed > 0;
                if (mute) {
                    setStatus(settings.uiLang === "tr"
                        ? `✓ ${chosen.length} küfür ${duckedOk ? "susturuldu" : "işaretlendi (ses kısma otomatik olamadı)"}`
                        : `✓ ${chosen.length} word(s) ${duckedOk ? "muted" : "flagged (auto-mute unavailable)"}`, duckedOk ? "success" : "warning");
                    showToast(duckedOk
                        ? (settings.uiLang === "tr" ? "Küfürler susturuldu ✓ (geri al: Cmd+Z)" : "Profanity muted ✓ (undo: Cmd+Z)")
                        : (settings.uiLang === "tr" ? "Bu Premiere sürümünde otomatik susturulamadı — klibin sesini elle kıs" : "Auto-mute not possible on this Premiere build — lower the clip audio manually"),
                        "success", 7000);
                } else {
                    setStatus(settings.uiLang === "tr"
                        ? `✓ Bip A${(r.track || 0) + 1} kanalında${duckedOk ? " + orijinal ses kısıldı" : ""} (${chosen.length} nokta)`
                        : `✓ Beep on A${(r.track || 0) + 1}${duckedOk ? " + original audio ducked" : ""} (${chosen.length} spot(s))`, "success");
                    showToast(duckedOk
                        ? (settings.uiLang === "tr" ? "Bip + ses kısma uygulandı ✓ (geri almak: Premiere'de Cmd+Z)" : "Beep + ducking applied ✓ (undo in Premiere: Cmd+Z)")
                        : (settings.uiLang === "tr" ? "Bip eklendi. Ses kısma bu Premiere sürümünde otomatik olamadı — klibin sesini elle kıs" : "Beep added. Auto-ducking not possible on this Premiere build — lower the clip audio manually"),
                        "success", 7000);
                }
            } else {
                setStatus((r && r.error) || "Beep placement failed", "error");
            }
        } catch (e) {
            setStatus(e.message, "error");
        } finally { showProgress(false); }
    });
}

// ── MOGRT styled graphics (Premiere) — real sendStyledGraphics ─────────────
function pickMogrtTemplate() {
    try {
        if (window.cep && window.cep.fs && window.cep.fs.showOpenDialogEx) {
            const res = window.cep.fs.showOpenDialogEx(false, false, "Pick a .mogrt template", "", ["mogrt"]);
            const p = res && res.data && res.data[0];
            if (p) { settings.mogrtPath = p; saveSettings(); showToast("MOGRT set: " + p.split(/[\\/]/).pop(), "success"); return; }
        }
    } catch (e) {}
    showToast("Pick a .mogrt exported from Premiere/After Effects (Essential Graphics)", "info", 5000);
}
async function sendStyledGraphics() {
    if (IS_DESKTOP_APP) { showToast("MOGRT send is Premiere-only", "info", 2500); return; }
    if (!segments.length) return;
    if (!settings.mogrtPath) { pickMogrtTemplate(); if (!settings.mogrtPath) return; }
    setStatus("Placing styled graphics on the timeline…", "info");
    showProgress(true);
    await loadHostJSX();
    const items = segments.map(s => ({ text: s.text, start: s.seqStart, end: s.seqEnd }));
    const payload = JSON.stringify({ mogrtPath: settings.mogrtPath, items });
    const r = await evalScript(`importTextGraphics('${payload.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}')`);
    showProgress(false);
    if (r && r.success) {
        setStatus(`✓ ${r.placed} styled graphic(s) placed on track V${(r.track || 0) + 1}`, "success");
        showToast("Styled captions placed — fully editable in Essential Graphics", "success", 5000);
    } else {
        if (r && r.needTemplate) { settings.mogrtPath = ""; saveSettings(); }
        setStatus((r && r.error) || "MOGRT placement failed", "error");
        if (r && r.diag) console.log("[Subsper] mogrt diag:", r.diag);
    }
}

// ── Translation → second Premiere caption track ────────────────────────────
async function sendTranslationToPremiere() {
    if (IS_DESKTOP_APP) { exportTranslationSRT(); return; }
    const map = parseNumberedAi($("ai-output") ? $("ai-output").value : "");
    if (!Object.keys(map).length) { showToast("Run Translate first", "info", 2500); return; }
    const srt = segments.map((seg, i) =>
        `${i + 1}\n${formatTime(seg.seqStart)} --> ${formatTime(seg.seqEnd)}\n${map[i] != null ? map[i] : seg.text}\n`).join("\n");
    setStatus("Sending translated captions…", "info");
    const escaped = srt.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\r?\n/g, "\\n");
    const r = await evalScript(`importSRTToProject('${escaped}')`);
    if (r && r.success) { setStatus("✓ Translated caption track added", "success"); showToast("Translation on the timeline", "success"); }
    else handleError((r && r.error) || "Failed");
}

// ── v1.10 init ──────────────────────────────────────────────────────────────
setTimeout(function initV110() {
    try {
        // Notification when a (long) transcription finishes in the background
        try { if (typeof Notification !== "undefined" && Notification.permission === "default") Notification.requestPermission(); } catch (e) {}
        const origStart = window.startTranscription;
        if (typeof origStart === "function") {
            window.startTranscription = async function () {
                const t0 = Date.now();
                const r = await origStart.apply(this, arguments);
                try {
                    if (Date.now() - t0 > 20000 && document.hidden && typeof Notification !== "undefined" && Notification.permission === "granted" && segments.length) {
                        new Notification("Subsper", { body: (settings.uiLang === "tr" ? "Transkript hazır — " : "Transcript ready — ") + segments.length + " segment", silent: false });
                    }
                } catch (e) {}
                return r;
            };
        }

        // Language options: extend the Settings dropdown beyond EN/TR
        const uiSel = $("set-uilang");
        if (uiSel && !uiSel.querySelector('option[value="es"]')) {
            [["es", "Español"], ["de", "Deutsch"], ["fr", "Français"], ["pt", "Português"],
             ["ru", "Русский"], ["ar", "العربية"], ["az", "Azərbaycan"], ["uz", "Oʻzbek"], ["kk", "Қазақша"]].forEach(([v, label]) => {
                const o = document.createElement("option"); o.value = v; o.textContent = label; uiSel.appendChild(o);
            });
            uiSel.value = settings.uiLang;
        }

        // Project buttons (Save/Open) → "Project" group in the export menu
        if (window.menuGroupAdd) {
            menuGroupAdd("export-grp-project", "grp_project",
                settings.uiLang === "tr" ? "Projeyi kaydet (.subsper)" : "Save project (.subsper)", saveProject);
            menuGroupAdd("export-grp-project", "grp_project",
                settings.uiLang === "tr" ? "Proje aç…" : "Open project…", openProject);
            if (!IS_DESKTOP_APP) {
                menuGroupAdd("export-grp-premiere", "grp_premiere",
                    settings.uiLang === "tr" ? "Stilli grafik (MOGRT) → timeline" : "Styled graphics (MOGRT) → timeline",
                    sendStyledGraphics, "Places each subtitle as an editable Essential Graphics clip. Pick any .mogrt once.");
            }
        }

        // AI panel: contextual clip + translation buttons (visibility via updateAiActions)
        const aiActs = $("ai-actions");
        if (aiActs) {
            const bC = document.createElement("button");
            bC.className = "btn-secondary";
            bC.id = "ai-clips-btn";
            bC.style.display = "none";
            bC.textContent = settings.uiLang === "tr" ? (IS_DESKTOP_APP ? "🎬 Klipleri dışa aktar" : "🎬 Hook marker'ları koy") : (IS_DESKTOP_APP ? "🎬 Export hook clips" : "🎬 Mark hooks on timeline");
            bC.setAttribute("data-tip", "Parses MM:SS-MM:SS ranges from the Shorts output");
            bC.onclick = aiClipsAction;
            aiActs.appendChild(bC);
            if (!IS_DESKTOP_APP) {
                const bT = document.createElement("button");
                bT.className = "btn-secondary";
                bT.id = "ai-send-tr-btn";
                bT.style.display = "none";
                bT.textContent = settings.uiLang === "tr" ? "Çeviriyi Premiere'e gönder" : "Send translation to Premiere";
                bT.onclick = sendTranslationToPremiere;
                aiActs.appendChild(bT);
            }
        }

        // AI header: sync provider/model selects + key hint with saved settings
        const provSel = $("ai-panel-provider");
        if (provSel) provSel.value = settings.aiProvider || "gemini";
        rebuildAiModelSelect();
        updateAiKeyHint();

        // Style favorites row under the preset chips
        renderStyleFavs();

        // Beep-profanity tool card on the Audio tab (both; desktop executes)
        const auPanel = (document.querySelector("#panel-au-work .setup-scroll") || document.getElementById("panel-au-work"));
        if (auPanel) {
            const card = document.createElement("div");
            card.className = "setting-item tool-card";
            card.innerHTML = `
              <div class="setting-row"><div class="setting-info">
                <div class="setting-name">${settings.uiLang === "tr" ? "Küfürleri Biple" : "Beep Profanity"}</div>
                <div class="setting-desc">${settings.uiLang === "tr" ? "Kelime zamanlarıyla küfür aralıklarını bulur; sesi susturup 1 kHz bip basar. Önce Transcribe." : "Finds profanity via word timings; mutes it and overlays a 1 kHz beep. Transcribe first."}</div>
              </div></div>
              <button class="btn-transcribe btn-compact" style="margin-top:8px" onclick="beepProfanityAction()">${settings.uiLang === "tr" ? "Biple" : "Beep it"}</button>`;
            auPanel.appendChild(card);
        }

        maybeOfferRestore();
    } catch (e) { console.error("[Subsper] v1.10 init failed:", e); }
}, 10);

/* ═══════════════════════════════════════════════════════════════════════════
   v1.12 differentiator pack — text-based video editing, chapters, multi-lang
   SRT, speech analytics, keyword-emphasis karaoke, speaker rename, style
   share, dictionary packs, local-AI (Ollama) support.
   ═══════════════════════════════════════════════════════════════════════════ */

// ── Text-based video editing ("delete the sentence → cut the video") ───────
// _originalSegments = the segment list right after transcription. Rows the user
// DELETES afterwards become cut-ranges; splits/edits/merges are left alone
// (their time span is still covered by the current list).
let _originalSegments = null;
function snapshotOriginalSegments() {
    try { _originalSegments = segments.map(s => ({ seqStart: s.seqStart, seqEnd: s.seqEnd })); } catch (e) { _originalSegments = null; }
}
function computeDeletedRanges() {
    if (!_originalSegments || !_originalSegments.length) return [];
    const covered = (t) => segments.some(s => t >= s.seqStart - 0.02 && t <= s.seqEnd + 0.02);
    const removed = [];
    for (const o of _originalSegments) {
        const mid = (o.seqStart + o.seqEnd) / 2;
        if (!covered(mid)) removed.push({ start: o.seqStart, end: o.seqEnd });
    }
    removed.sort((a, b) => a.start - b.start);
    const merged = [];
    for (const r of removed) {
        const last = merged[merged.length - 1];
        if (last && r.start <= last.end + 0.05) last.end = Math.max(last.end, r.end);
        else merged.push({ ...r });
    }
    return merged;
}
async function applyTextCuts() {
    if (!_originalSegments) { showToast(settings.uiLang === "tr" ? "Önce Transcribe — sonra istemediğin satırları sil" : "Transcribe first — then delete the rows you don't want", "info", 4000); return; }
    const removed = computeDeletedRanges();
    if (!removed.length) { showToast(settings.uiLang === "tr" ? "Silinmiş satır yok. Satır sil (✕), sonra tekrar dene" : "No deleted rows yet. Delete rows (✕), then retry", "info", 4500); return; }
    showRangePreview(settings.uiLang === "tr" ? "Silinen satırları videodan kes" : "Cut deleted rows from the video", removed, async (chosen) => {
        if (IS_DESKTOP_APP) {
            if (window.applyTextCutsDesktop) window.applyTextCutsDesktop(chosen);
            return;
        }
        setEditStatus(`Cutting ${chosen.length} range(s)…`, "info");
        await loadHostJSX();
        const arg = JSON.stringify(chosen).replace(/'/g, "\\'");
        const r = await evalScript(`rippleDeleteRanges('${arg}')`);
        if (r && r.success) {
            snapshotOriginalSegments();   // current state becomes the new baseline
            setEditStatus(`✓ Removed ${r.removed} item(s) — timeline follows your text`, "success");
            showToast(settings.uiLang === "tr" ? "Video metnini takip etti ✂ (geri almak: Premiere'de Cmd+Z)" : "Video now follows your text ✂ (undo in Premiere: Cmd+Z)", "success", 6000);
        } else setEditStatus((r && r.error) || "Cut failed", "error");
    });
}

// ── Speaker rename (click the S1/S2 chip on a segment) ─────────────────────
function renameSpeaker(sp) {
    const cur = sp || "";
    const name = prompt((settings.uiLang === "tr" ? "Konuşmacı adı: " : "Speaker name: ") + cur, cur.replace("SPEAKER_", "S"));
    if (!name || name === cur) return;
    pushUndo();
    segments.forEach(s => { if (s.speaker === sp) s.speaker = name; });
    renderSegments(); reselect();
    showToast((settings.uiLang === "tr" ? "Yeniden adlandırıldı: " : "Renamed: ") + name, "success");
}

// ── Speech analytics (works fully offline, no AI needed) ───────────────────
function showSpeechStats() {
    if (!segments.length) { showToast("Transcribe first", "info", 2000); return; }
    const first = segments[0].seqStart, last = segments[segments.length - 1].seqEnd;
    const span = Math.max(0.01, last - first);
    let spoken = 0, words = 0, fillers = 0, chars = 0;
    const fl = getFillerList().filter(w => !w.includes(" "));
    const fset = new Set(fl.map(w => w.toLowerCase()));
    for (const s of segments) {
        spoken += (s.seqEnd - s.seqStart);
        const ws = (s.text || "").split(/\s+/).filter(Boolean);
        words += ws.length; chars += (s.text || "").length;
        ws.forEach(w => { if (fset.has(w.toLowerCase().replace(/[.,!?;:"']/g, ""))) fillers++; });
    }
    const wpm = Math.round(words / (span / 60));
    const silPct = Math.max(0, Math.round((1 - spoken / span) * 100));
    const cps = (chars / spoken).toFixed(1);
    const isTr = settings.uiLang === "tr";
    const rows = [
        [isTr ? "Süre" : "Duration", `${Math.floor(span / 60)}m ${Math.round(span % 60)}s`],
        [isTr ? "Kelime" : "Words", String(words)],
        [isTr ? "Konuşma hızı" : "Speaking pace", `${wpm} ${isTr ? "kelime/dk" : "wpm"} ${wpm > 170 ? "⚡" : wpm < 110 ? "🐢" : "✓"}`],
        [isTr ? "Dolgu kelime" : "Filler words", `${fillers} (${(fillers / Math.max(1, words) * 100).toFixed(1)}%)`],
        [isTr ? "Sessizlik" : "Silence", `${silPct}%`],
        [isTr ? "Okuma hızı" : "Reading speed", `${cps} ${isTr ? "karakter/sn" : "chars/sec"}`],
    ];
    let ov = $("stats-ov"); if (ov) ov.remove();
    ov = document.createElement("div");
    ov.id = "stats-ov";
    ov.style.cssText = "position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center";
    ov.innerHTML = `<div style="background:var(--bg2,#16181d);border:1px solid var(--border2,#333);border-radius:12px;max-width:340px;width:90%;padding:18px">
        <div style="font-weight:800;font-size:13px;margin-bottom:10px">📊 ${isTr ? "Konuşma Analizi" : "Speech Analytics"}</div>
        ${rows.map(r => `<div style="display:flex;justify-content:space-between;font-size:12.5px;padding:5px 0;border-bottom:1px solid var(--border2)"><span style="color:var(--text2)">${r[0]}</span><b>${r[1]}</b></div>`).join("")}
        <button class="btn-secondary" style="margin-top:12px;width:100%" onclick="document.getElementById('stats-ov').remove()">OK</button></div>`;
    ov.onclick = e => { if (e.target === ov) ov.remove(); };
    document.body.appendChild(ov);
}

// ── Provider-agnostic single completion (used by chapters & multi-lang) ─────
async function aiComplete(prompt) {
    const provider = settings.aiProvider || "gemini";
    const model = modelForProvider(provider, settings.geminiModel);
    const key = { gemini: settings.geminiApiKey, openai: settings.openaiApiKey,
                  anthropic: settings.anthropicApiKey, custom: settings.customApiKey }[provider] || "";
    if (!key && provider !== "custom") throw new Error("API key missing (Settings → AI & API)");
    if (provider === "gemini") {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message || "API error");
        return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    }
    if (provider === "anthropic") {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01", "anthropic-dangerously-allow-browser": "true" },
            body: JSON.stringify({ model, max_tokens: 4096, messages: [{ role: "user", content: prompt }] }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message || "API error");
        return data.content?.[0]?.text || "";
    }
    const url = provider === "custom" && settings.customApiUrl ? settings.customApiUrl + "/chat/completions" : "https://api.openai.com/v1/chat/completions";
    const res = await fetch(url, {
        method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
        body: JSON.stringify({ model: model || "gpt-4o", messages: [{ role: "user", content: prompt }] }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || "API error");
    return data.choices?.[0]?.message?.content || "";
}

function _plainTranscript() {
    return segments.map((s, i) => `${i + 1} [${fmtMMSS(s.seqStart)}] ${(s.text || "").replace(/\s+/g, " ").trim()}`).join("\n");
}

// ── YouTube chapters ────────────────────────────────────────────────────────
async function aiChapters() {
    if (!segments.length) { showToast("Transcribe first", "info", 2000); return; }
    const out = $("ai-output"); if (out) out.value = "Thinking...";
    updateAiActions(null);
    try {
        const text = await aiComplete(
`Create YouTube chapters for this video transcript. Rules: 4-10 chapters, first one MUST be "00:00", format each line exactly "MM:SS Title" (or HH:MM:SS if over an hour), titles short and catchy, same language as the transcript. Output ONLY the chapter lines.

Transcript:
${_plainTranscript()}`);
        if (out) out.value = text.trim();
        updateAiActions("chapters");
        showToast(settings.uiLang === "tr" ? "Bölümler hazır — kopyala, YouTube açıklamasına yapıştır" : "Chapters ready — copy into your YouTube description", "success", 5000);
    } catch (e) { if (out) out.value = "Error: " + e.message; }
}

// ── Multi-language SRT batch ────────────────────────────────────────────────
const LANG_NAMES = { en: "English", tr: "Turkish", de: "German", es: "Spanish", fr: "French", pt: "Portuguese", it: "Italian", ar: "Arabic", ru: "Russian", ja: "Japanese" };
async function multiLangSRT() {
    if (!segments.length) { showToast("Transcribe first", "info", 2000); return; }
    const isTr = settings.uiLang === "tr";
    const raw = prompt(isTr ? "Hedef diller (virgülle, örn: en,de,es,fr):" : "Target languages (comma-separated, e.g. en,de,es,fr):", "en,de,es");
    if (!raw) return;
    const langs = raw.split(/[, ]+/).map(s => s.trim().toLowerCase()).filter(l => l && l.length <= 3);
    if (!langs.length) return;
    const outDir = path.join(os.homedir(), "Desktop", "subsper_translations");
    try { fs.mkdirSync(outDir, { recursive: true }); } catch (e) {}
    const lineCount = segments.length;
    const out = $("ai-output");
    let done = 0;
    for (const lc of langs) {
        const langName = LANG_NAMES[lc] || lc;
        if (out) out.value = `Translating → ${langName} (${done + 1}/${langs.length})…`;
        setStatus(`AI translating → ${langName}…`, "info");
        try {
            const text = await aiComplete(
`Translate each numbered subtitle line below into natural ${langName}. The transcript has ${lineCount} numbered lines ("N [MM:SS] text"). Return EXACTLY ${lineCount} lines as "N. text" — same count and order, never merge or drop lines. Output ONLY the numbered lines.

Transcript:
${_plainTranscript()}`);
            const map = parseNumberedAi(text);
            const srt = segments.map((seg, i) =>
                `${i + 1}\n${formatTime(seg.seqStart)} --> ${formatTime(seg.seqEnd)}\n${map[i] != null ? map[i] : seg.text}\n`).join("\n");
            fs.writeFileSync(path.join(outDir, `captions_${lc}.srt`), srt, "utf8");
            done++;
        } catch (e) {
            showToast(`${langName}: ${e.message}`, "error", 5000);
        }
    }
    if (out) out.value = (isTr ? `✓ ${done}/${langs.length} dil kaydedildi → ` : `✓ ${done}/${langs.length} language(s) saved → `) + outDir;
    setStatus(`✓ Multi-language SRT: ${done}/${langs.length} → ${outDir}`, done ? "success" : "error");
    if (done) revealInFolder(path.join(outDir, `captions_${langs[0]}.srt`));
}

// ── Style favorites: share (export / import) ───────────────────────────────
function exportStyleFavs() {
    const favs = settings.styleFavs || [];
    if (!favs.length) { showToast(settings.uiLang === "tr" ? "Önce favori kaydet (★)" : "Save a favorite first (★)", "info", 2500); return; }
    const p = path.join(os.homedir(), "Desktop", "subsper_styles.json");
    try { fs.writeFileSync(p, JSON.stringify({ app: "subsper-styles", favs }, null, 1), "utf8"); showToast("→ " + p, "success", 4000); revealInFolder(p); }
    catch (e) { showToast(e.message, "error"); }
}
function importStyleFavs() {
    const inp = document.createElement("input");
    inp.type = "file"; inp.accept = ".json";
    inp.onchange = () => {
        const f = inp.files[0]; if (!f) return;
        try {
            const data = JSON.parse(fs.readFileSync(f.path, "utf8"));
            if (data.app !== "subsper-styles" || !Array.isArray(data.favs)) throw new Error("Not a Subsper style file");
            settings.styleFavs = (settings.styleFavs || []).concat(data.favs).slice(-12);
            saveSettings(); renderStyleFavs();
            showToast(`+${data.favs.length} style(s)`, "success");
        } catch (e) { showToast(e.message, "error"); }
    };
    inp.click();
}

// ── Dictionary packs (one-click wrong=right rule sets) ─────────────────────
const DICT_PACKS = {
    tech:   ["java script=JavaScript", "phyton=Python", "gugıl=Google", "yutub=YouTube", "linkedin=LinkedIn", "ai=AI", "chat gpt=ChatGPT", "opun ai=OpenAI"],
    gaming: ["valorant=Valorant", "cs go=CS:GO", "lol=LoL", "fps=FPS", "gg=GG", "meta=meta", "skin=skin", "battle royale=Battle Royale"],
    social: ["instagram=Instagram", "tiktok=TikTok", "reels=Reels", "shorts=Shorts", "influencer=influencer", "hashtag=hashtag", "story=story", "dm=DM"],
};
function applyDictPack(name) {
    const pack = DICT_PACKS[name]; if (!pack) return;
    const cur = (settings.customDict || "").trim();
    const have = new Set(cur.split(/\r?\n/).map(l => l.split("=")[0].trim().toLowerCase()));
    const add = pack.filter(r => !have.has(r.split("=")[0].toLowerCase()));
    settings.customDict = (cur ? cur + "\n" : "") + add.join("\n");
    saveSettings();
    const ta = $("set-dict"); if (ta) ta.value = settings.customDict;
    updateDictCount();
    showToast(`+${add.length} ${name} rules`, "success");
}

// ── v1.12 init ──────────────────────────────────────────────────────────────
setTimeout(function initV112() {
    try {
        // Baseline snapshot for text-based editing: taken after every transcription
        const origStart2 = window.startTranscription;
        if (typeof origStart2 === "function") {
            window.startTranscription = async function () {
                const r = await origStart2.apply(this, arguments);
                try { if (segments && segments.length) snapshotOriginalSegments(); } catch (e) {}
                return r;
            };
        }

        // Edit tools: "Cut deleted rows from video" + "Speech analytics" cards
        const edPanel2 = (document.querySelector("#panel-ed-work .setup-scroll") || document.getElementById("panel-ed-work"));
        if (edPanel2) {
            const isTr = settings.uiLang === "tr";
            const card = document.createElement("div");
            card.className = "setting-item tool-card";
            card.innerHTML = `
              <div class="setting-row"><div class="setting-info">
                <div class="setting-name">✂️ ${isTr ? "Metinden Video Kurgu" : "Text-Based Video Editing"}</div>
                <div class="setting-desc">${isTr ? "Altyazı listesinden sildiğin satırlar videodan da kesilir. Sil (✕) → bu butona bas → önizle → uygula." : "Rows you delete from the subtitle list get cut from the video too. Delete (✕) → press this → preview → apply."}</div>
              </div></div>
              <button class="btn-transcribe btn-compact" style="margin-top:8px" onclick="applyTextCuts()">${isTr ? "Silinenleri Videodan Kes" : "Cut Deleted Rows"}</button>
              <button class="btn-secondary" style="margin-top:6px;width:100%" onclick="showSpeechStats()">📊 ${isTr ? "Konuşma Analizi" : "Speech Analytics"}</button>`;
            edPanel2.appendChild(card);
        }

        // AI panel: Chapters + Multi-language buttons into the content grid
        const grids = document.querySelectorAll("#ai-panel .ai-grid");
        const contentGrid = grids[grids.length - 1];
        if (contentGrid) {
            const isTr = settings.uiLang === "tr";
            const bCh = document.createElement("button");
            bCh.innerHTML = `<span class="ic" data-icon="captions"></span><span>${isTr ? "YouTube Bölümleri" : "YouTube Chapters"}</span>`;
            bCh.onclick = aiChapters;
            const bML = document.createElement("button");
            bML.innerHTML = `<span class="ic" data-icon="download"></span><span>${isTr ? "Çoklu Dil SRT" : "Multi-language SRT"}</span>`;
            bML.setAttribute("data-tip", isTr ? "Tek seferde birden çok dile çevirip Desktop'a SRT seti kaydeder" : "Translates into several languages at once, saves an SRT set to Desktop");
            bML.onclick = multiLangSRT;
            contentGrid.appendChild(bCh); contentGrid.appendChild(bML);
            if (typeof applyIcons === "function") applyIcons(contentGrid);
        }
        // Copy button for chapters output
        const aiActs2 = $("ai-actions");
        if (aiActs2) {
            const bCp = document.createElement("button");
            bCp.className = "btn-secondary";
            bCp.id = "ai-copy-btn";
            bCp.style.display = "none";
            bCp.textContent = settings.uiLang === "tr" ? "📋 Kopyala" : "📋 Copy";
            bCp.onclick = () => copyText($("ai-output").value);
            aiActs2.appendChild(bCp);
        }
        // extend contextual actions for chapters
        const origUpd = window.updateAiActions;
        if (typeof origUpd === "function") {
            window.updateAiActions = function (type) {
                origUpd(type);
                const el = $("ai-copy-btn");
                if (el) el.style.display = (type === "chapters" || type === "summary" || type === "tags") ? "inline-flex" : "none";
            };
        }

        // Style favorites share buttons
        const favRow = $("style-favs-row");
        if (favRow) {
            const isTr = settings.uiLang === "tr";
            const ex = document.createElement("button");
            ex.className = "style-chip"; ex.textContent = "⇪"; ex.setAttribute("data-tip", isTr ? "Favorileri dosyaya aktar (paylaş)" : "Export favorites to a file (share)");
            ex.onclick = exportStyleFavs;
            const im = document.createElement("button");
            im.className = "style-chip"; im.textContent = "⇩"; im.setAttribute("data-tip", isTr ? "Stil dosyası içe aktar" : "Import a style file");
            im.onclick = importStyleFavs;
            favRow.appendChild(ex); favRow.appendChild(im);
        }

        // Dictionary packs under the custom-dictionary textarea
        const dictTa = $("set-dict");
        if (dictTa && dictTa.parentElement) {
            const isTr = settings.uiLang === "tr";
            const row = document.createElement("div");
            row.style.cssText = "display:flex;gap:6px;flex-wrap:wrap;margin-top:6px";
            row.innerHTML = `<span style="font-size:10.5px;color:var(--text3);align-self:center">${isTr ? "Hazır paket:" : "Preset pack:"}</span>` +
                Object.keys(DICT_PACKS).map(k => `<button class="style-chip" onclick="applyDictPack('${k}')">＋ ${k}</button>`).join("");
            dictTa.parentElement.insertBefore(row, dictTa.nextSibling);
        }

        // Local AI (Ollama) hint on the custom-URL field
        const cu = $("set-custom-url");
        if (cu) cu.placeholder = "http://localhost:11434/v1  (Ollama — %100 offline AI)";
    } catch (e) { console.error("[Subsper] v1.12 init failed:", e); }
}, 20);
