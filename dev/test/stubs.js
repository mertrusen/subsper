// Fake environment for the extracted code. Only what the tested functions
// actually touch — anything else missing shows up immediately as a ReferenceError
// rather than passing silently.

var segments = [];
var selectedIndex = -1;
var lastLanguage = "";
var activeFindRegex = null;
var findMatchSegs = [];

var settings = {
    uiLang: "tr",
    customDict: "",
    fillerWords: "", fillerOn: true,
    profanityList: "", profanityMode: "asterisk", profStem: true,
    punctAllowed: ".,?!:;\"'()[]{}-",
    maxCharsPerLine: 42, maxLines: 2, maxCps: 17, maxDur: 7.0,
    autoSplit: true,
};

// Recorded side effects, so tests can assert on user-facing feedback.
var _toasts = [], _statuses = [], _renders = 0;

function resetEnv(opts) {
    opts = opts || {};
    segments = opts.segments || [];
    selectedIndex = -1;
    lastLanguage = opts.lang || "";
    _toasts = []; _statuses = []; _renders = 0;
    settings.customDict = opts.customDict || "";
    settings.fillerWords = opts.fillerWords || "";
    settings.fillerOn = opts.fillerOn !== false;
    settings.profanityList = opts.profanityList || "";
    settings.profanityMode = opts.profanityMode || "asterisk";
    settings.profStem = opts.profStem !== false;
    settings.uiLang = opts.uiLang || "tr";
}

function renderSegments() { _renders++; }
function selectSegment(i) { selectedIndex = i; }
function updateSegCount() {}
function reselect() {}
function pushUndo() {}
function showToast(msg) { _toasts.push(String(msg)); }
function setStatus(msg) { _statuses.push(String(msg)); }
function icon() { return ""; }
function t(k) { return k; }
function L(tr, en) { return settings.uiLang === "tr" ? tr : en; }
function texts() { return segments.map(function (s) { return s.text; }); }

// Convenience for building word-timed segments in tests.
function seg(text, start, end, words) {
    return {
        id: 0, text: text,
        start: start, end: end,
        seqStart: start, seqEnd: end,
        words: words || [],
    };
}
function W(word, start, end) { return { word: word, start: start, end: end }; }

// localStorage: profiles live here, so the suite needs a real one.
var localStorage = (function () {
    var m = {};
    return {
        getItem: function (k) { return Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null; },
        setItem: function (k, v) { m[k] = String(v); },
        removeItem: function (k) { delete m[k]; },
        clear: function () { m = {}; },
    };
})();

// buildBilingualSRT reads the AI panel's textarea through $("ai-output").
var _aiOutput = "";
function $(id) { return id === "ai-output" ? { value: _aiOutput } : null; }
function saveSettings() {}
function applyLanguage() {}
function initSettingsUI() {}
function initEditSettingsUI() {}
function initAudioSettingsUI() {}
