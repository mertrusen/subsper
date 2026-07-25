/* Harness: load features-v2.js + ui-v2.js under a fake DOM, once with
   IS_DESKTOP=true and once without, and assert the gating.
   Run: node dev/v2-harness.js  (from the repo root) */
"use strict";
const fsReal = require("fs");
const vm = require("vm");

function run(desktop) {
    const REG = {};
    const CARDS = [];
    function makeEl(tag) {
        const el = {
            tagName: (tag || "div").toUpperCase(),
            children: [], style: {}, attrs: {}, textContent: "", value: "", title: "",
            nextSibling: null, lastElementChild: null, previousElementSibling: null,
            classList: {
                _s: new Set(),
                add(...c) { c.forEach(x => this._s.add(x)); },
                remove(...c) { c.forEach(x => this._s.delete(x)); },
                toggle(c, f) { f ? this._s.add(c) : this._s.delete(c); },
                contains(c) { return this._s.has(c); },
            },
            setAttribute(k, v) {
                el.attrs[k] = String(v);
                if (k === "id") { el.id = v; REG[v] = el; }
                if (k === "data-tool") CARDS.push(v);
            },
            getAttribute(k) { return k in el.attrs ? el.attrs[k] : null; },
            appendChild(c) { el.children.push(c); c.parentElement = el; c.parentNode = el; return c; },
            insertBefore(c) { el.children.unshift(c); c.parentElement = el; c.parentNode = el; return c; },
            insertAdjacentElement(w, c) { return el.appendChild(c); },
            querySelector() { return null; },
            querySelectorAll() { return []; },
            addEventListener() {}, removeEventListener() {},
            closest() { return el._closest || null; },
            matches() { return false; },
            remove() {}, focus() {}, select() {}, load() {},
            getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 56 }; },
            oninput: null, onclick: null,
        };
        let _html = "";
        Object.defineProperty(el, "innerHTML", {
            get() { return _html; },
            set(v) {
                _html = String(v);
                const re = /id="([^"]+)"/g; let m;
                while ((m = re.exec(_html))) {
                    if (!REG[m[1]]) {
                        const c = makeEl();
                        c.id = m[1]; c.parentElement = el; c.parentNode = el;
                        REG[m[1]] = c;
                    }
                }
            },
        });
        return el;
    }

    const scrollEd = makeEl(), scrollAu = makeEl(), scrollSu = makeEl();
    const settingItem = makeEl();
    ["silence-btn", "zoom-btn", "filler-cut-btn", "style-chips", "set-silthr",
     "set-audio-denoise", "set-beepmode", "home-cats", "home-badge-text",
     "home-foot", "page-back-label", "page-title", "page-gear", "language-select",
     "error-panel", "chapters-out", "sil-tracks", "ai-panel", "style-preview",
     "style-preview-text"].forEach(id => {
        const e = makeEl(); e.id = id; e._closest = settingItem;
        e.parentElement = e.parentNode = settingItem;
        REG[id] = e;
    });
    const beepBtn = makeEl(); beepBtn._closest = makeEl();
    const txControls = makeEl();
    const errHeader = makeEl();

    const doc = {
        title: "",
        body: makeEl("body"),
        activeElement: null,
        createElement: t => makeEl(t),
        getElementById: id => REG[id] || null,
        querySelector(sel) {
            if (sel === "#panel-ed-work .setup-scroll") return scrollEd;
            if (sel === "#panel-au-work .setup-scroll") return scrollAu;
            if (sel === "#panel-su-main .setup-scroll") return scrollSu;
            if (sel === "#error-panel .error-header") return errHeader;
            if (sel.indexOf("beepProfanityAction") !== -1) return beepBtn;
            if (sel.indexOf("cutFillerWordsDesktop") !== -1) return beepBtn;
            if (sel === "#panel-tx-work .controls") return txControls;
            return null;
        },
        querySelectorAll() { return []; },
        addEventListener() {}, removeEventListener() {},
    };

    const store = {};
    const sandbox = {
        console, setTimeout, clearTimeout, setInterval, clearInterval,
        document: doc,
        navigator: { clipboard: { writeText() {} }, platform: "test" },
        localStorage: {
            getItem: k => (k in store ? store[k] : null),
            setItem: (k, v) => { store[k] = String(v); },
            removeItem: k => { delete store[k]; },
        },
        settings: { uiLang: "tr" },
        segments: [],
        _originalSegments: null,
        APP_VERSION: "1.2.0",
        I18N: { en: {}, tr: {} },
        SPEAKER_COLORS: ["FFFFFF", "00FFFF"],
        DEFAULT_CUSTOM_STYLE: {},
        STYLE_PRESETS: [],
        currentSubTab: { transcribe: "work", edit: "work", audio: "work", setup: "main" },
        $: id => REG[id] || null,
        showToast() {}, setStatus() {}, setSilenceStatus() {}, setEditStatus() {},
        setAudioStatus() {}, showSilenceProgress() {}, showProgress() {},
        showRangePreview() {}, switchMainTab() {}, switchSubTab() {},
        evalScript: async () => ({ success: false }),
        loadHostJSX: async () => {},
        aiComplete: async () => "",
        parseAiClipRanges: () => [],
        onSettingChange(k, v) { sandbox.settings[k] = v; },
        saveSettings() {},
        getFillerList: () => [], computeProfanityRanges: () => [],
        computeDeletedRanges: () => [], snapshotOriginalSegments() {},
        findSilenceRanges: async () => ({ ranges: [] }),
        revealInFolder() {}, seekToTime() {},
        populateCustomForm() {}, updateStylePreview() {}, buildASSStyle: () => "",
        assColor: (c, a) => "&H00" + c,
        initEditSettingsUI() {}, initAudioSettingsUI() {},
        maybeShowOnboarding() {}, toggleAiPanel() {},
        setLanguage() {},
        LICENSING_ENABLED: false,
        verifyLicenseKey: async () => ({ success: true }),
        segmentsToSRT: () => "1\n00:00:00,000 --> 00:00:01,000\nx\n",
        startTranscription: async () => {},
        fetch: async () => ({ ok: true, json: async () => ({ videos: [] }) }),
        fs: { writeFileSync() {}, mkdirSync() {} },
        os: { homedir: () => "/tmp" },
        path: { join: (...a) => a.join("/") },
        applyTextCuts: function origApplyTextCuts() {},
        cutFillerWords: function origCutFillerWords() {},
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    if (desktop) sandbox.IS_DESKTOP = true;
    const origApply = sandbox.applyTextCuts, origFiller = sandbox.cutFillerWords;
    if (desktop) store.ws_lastTool = "zoom";

    const ctx = vm.createContext(sandbox);
    for (const f of ["js/features-v2.js", "js/ui-v2.js"]) {
        vm.runInContext(fsReal.readFileSync(f, "utf8"), ctx, { filename: f });
    }
    return new Promise(res => setTimeout(() => res({
        REG, CARDS, sandbox, origApply, origFiller,
    }), 200));
}

function has(r, id) { return !!r.REG[id]; }
let fails = 0;
function ok(cond, label) {
    console.log((cond ? "  ok  " : "  FAIL") + " " + label);
    if (!cond) fails++;
}

(async () => {
    process.chdir(require("path").join(__dirname, ".."));

    console.log("— desktop mode (IS_DESKTOP=true) —");
    const d = await run(true);
    ok(has(d, "repeat-btn"), "repeat card injected");
    ok(has(d, "chapters-btn") && has(d, "viral-btn") && has(d, "broll-btn"), "content cards injected");
    ok(has(d, "pace-btn") && has(d, "social-btn"), "pace+social injected");
    ok(has(d, "chapters-save") && has(d, "prof-report-btn"), "extras injected");
    ok(!has(d, "resize-btn") && !has(d, "mc-scan"), "resize+multicam ABSENT");
    ok(!has(d, "sil-run") && !has(d, "zoompro-run"), "Silence/Zoom Pro ABSENT");
    ok(!has(d, "duck-btn") && !has(d, "markercut-btn"), "ducking+marker-cut ABSENT");
    ok(!has(d, "ui2-hist-list"), "history panel ABSENT");
    ok(d.sandbox.applyTextCuts === d.origApply, "applyTextCuts NOT replaced");
    ok(d.sandbox.cutFillerWords === d.origFiller, "cutFillerWords NOT replaced");
    const hidden = ["zoom", "multicam", "markercut", "resize", "ducking"];
    ok(hidden.every(k => !d.CARDS.includes(k)), "home grid hides Premiere-only tools");
    ok(["subtitles", "silence", "repeat", "filler", "beep", "enhance", "chapters",
        "viral", "pace", "social", "broll", "settings", "help", "ai"]
        .every(k => d.CARDS.includes(k)), "home grid keeps desktop tools (14)");
    ok(has(d, "beep-words-mirror") && has(d, "filler-words-mirror"), "list mirrors (desktop)");
    ok(has(d, "subposx") && has(d, "subposy") && has(d, "submaxw"), "position+width sliders (desktop)");
    ok(has(d, "set-pexels") && has(d, "broll-dl"), "Faz D stock B-roll (desktop)");
    ok(!has(d, "batch-scan"), "sequence batch ABSENT on desktop");
    ok(!has(d, "lic-key"), "license UI hidden while LICENSING_ENABLED=false");
    const lsD = d.sandbox.__licenseState();
    ok(lsD.status === "trial" && lsD.daysLeft === 7, "fresh trial = 7 days left");
    ok(d.sandbox.__licenseGate() === true, "gate open while licensing disabled");

    console.log("— extension mode (regression) —");
    const e = await run(false);
    ok(has(e, "repeat-btn") && has(e, "resize-btn") && has(e, "mc-scan"), "resize+multicam present");
    ok(has(e, "sil-run") && has(e, "zoompro-run"), "Silence/Zoom Pro present");
    ok(has(e, "duck-btn") && has(e, "markercut-btn"), "ducking+marker-cut present");
    ok(has(e, "ui2-hist-list"), "history panel present");
    ok(e.sandbox.applyTextCuts !== e.origApply, "applyTextCuts upgraded");
    ok(e.sandbox.cutFillerWords !== e.origFiller, "cutFillerWords upgraded");
    ok(["zoom", "multicam", "markercut", "resize", "ducking"]
        .every(k => e.CARDS.includes(k)), "home grid shows all 19 tools");
    ok(has(e, "beep-words-mirror") && has(e, "filler-words-mirror"), "list mirrors (extension)");
    ok(has(e, "submaxw"), "width slider (extension)");
    ok(has(e, "batch-scan") && has(e, "batch-run"), "sequence batch present (extension)");
    ok(has(e, "set-pexels") && has(e, "broll-dl"), "Faz D stock B-roll (extension)");
    const sl = e.sandbox.__styleLineV2;
    if (sl) {
        const p = { font: "Arial", size: 54, primary: "FFFFFF", outline: "000000",
                    outlineW: 3, shadow: 1, bold: false, italic: false, align: 2,
                    box: false, boxColor: "000000", boxAlpha: 96, glow: 0 };
        e.sandbox.settings.subMaxW = null;
        const auto = sl(p, false, e.sandbox.assColor, "FFE000");
        e.sandbox.settings.subMaxW = 80;
        const w80 = sl(p, false, e.sandbox.assColor, "FFE000");
        ok(auto.indexOf(",60,60,") !== -1, "ASS margins default 60 (1920)");
        ok(w80.indexOf(",192,192,") !== -1, "ASS margins width 80% → 192 (1920)");
        // vertical PlayRes: margins follow real video width
        e.sandbox.__videoW = 1080; e.sandbox.__videoH = 1920;
        const v80 = sl(p, false, e.sandbox.assColor, "FFE000");
        ok(v80.indexOf(",108,108,") !== -1, "ASS margins width 80% → 108 (vertical 1080)");
        delete e.sandbox.__videoW; delete e.sandbox.__videoH;
        e.sandbox.settings.subMaxW = null;
    } else ok(false, "__styleLineV2 hook missing");

    console.log(fails ? `\n${fails} FAILURE(S)` : "\nALL GREEN");
    process.exit(fails ? 1 : 0);
})().catch(er => { console.error("HARNESS ERROR:", er); process.exit(2); });
