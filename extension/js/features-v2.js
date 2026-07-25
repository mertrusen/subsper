/* Subsper features v2 — Remove Repeats · Chapters · Viral Clips · B-Roll ·
   Vertical Resize · Multicam (placeholder). Shared by the Premiere extension
   and the desktop app (DESK flag gates timeline-only tools; on desktop, cuts
   export a trimmed copy of the loaded file instead of touching a timeline).
   Loaded after main.js (uses its globals: segments, settings, aiComplete,
   parseAiClipRanges, showRangePreview, evalScript, loadHostJSX, showToast,
   fmtMMSS) and before ui-v2.js (which isolates each card into its own page).
   Engine order per smart tool: cloud/local AI when a key or custom URL is
   set, otherwise on-device heuristics — the buttons never lock. */
(function () {
    "use strict";

    const L = (tr, en) => (settings.uiLang === "tr") ? tr : en;
    const $id = id => document.getElementById(id);
    const DESK = (typeof window !== "undefined" && window.IS_DESKTOP === true);
    // .ass PlayRes = real video dims when known (desktop sets __videoW/H);
    // the fixed 1920x1080 header oversized fonts ~1.8x on vertical videos
    const PR = () => ({ w: window.__videoW || 1920, h: window.__videoH || 1080 });

    // ── shared helpers ─────────────────────────────────────────────────────
    function aiAvailable() {
        const p = settings.aiProvider || "gemini";
        if (p === "custom") return !!(settings.customApiUrl);
        return !!({ gemini: settings.geminiApiKey, openai: settings.openaiApiKey,
                    anthropic: settings.anthropicApiKey }[p]);
    }
    const STOP = new Set(("bir bu şu o ve ile de da ki mi mu mü ne için gibi çok daha ama fakat veya ya hem sonra önce şey işte yani the a an and or but of to in on for with is are was were be it this that you i we they he she as at by from not so if then than very just".split(" ")));
    function tokens(t) {
        return String(t || "").toLowerCase()
            .replace(/[^\wçğıöşüâîûа-яё\s]/gi, " ")
            .split(/\s+/).filter(w => w.length >= 2 && !STOP.has(w));
    }
    function jaccard(a, b) {
        if (!a.length || !b.length) return 0;
        const A = new Set(a), B = new Set(b);
        let inter = 0;
        A.forEach(w => { if (B.has(w)) inter++; });
        return inter / (A.size + B.size - inter);
    }
    function mmss(sec) {
        sec = Math.max(0, Math.round(sec));
        const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
        const p = n => String(n).padStart(2, "0");
        return h ? `${p(h)}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
    }
    function needTranscript() {
        if (segments && segments.length) return false;
        showToast(L("Önce Transcribe — bu araç kelime zamanlarını kullanır", "Transcribe first — this tool needs word timings"), "info", 3500);
        return true;
    }
    async function namedMarkers(items) {
        if (DESK) return { success: false, error: "premiere-only" };   // no timeline on desktop
        await loadHostJSX();
        return evalScript(`addNamedMarkers('${JSON.stringify(items).replace(/'/g, "\\'")}')`);
    }
    function copyText(txt) {
        try { navigator.clipboard.writeText(txt); showToast(L("Kopyalandı", "Copied"), "success"); }
        catch (e) {
            const ta = document.createElement("textarea");
            ta.value = txt; document.body.appendChild(ta); ta.select();
            document.execCommand("copy"); ta.remove();
            showToast(L("Kopyalandı", "Copied"), "success");
        }
    }

    // ── Remove Repeats ─────────────────────────────────────────────────────
    function detectRepeats(segs, keep) {
        const cut = new Set();
        for (let i = 0; i < segs.length; i++) {
            const A = tokens(segs[i].text);
            if (A.length < 3) continue;
            for (let j = i + 1; j <= Math.min(i + 2, segs.length - 1); j++) {
                const B = tokens(segs[j].text);
                if (B.length < 3) continue;
                if (jaccard(A, B) >= 0.55) {
                    if (keep === "fastest") {
                        const di = segs[i].seqEnd - segs[i].seqStart;
                        const dj = segs[j].seqEnd - segs[j].seqStart;
                        cut.add(di > dj ? i : j);
                    } else cut.add(i); // keep the LAST take → cut the EARLIER one
                }
            }
        }
        return [...cut].sort((a, b) => a - b);
    }
    // AI sometimes returns the FINAL take's range despite the prompt — remap
    // any cut that lands on the last of a duplicate pair back to the earlier one
    function fixKeepLast(ranges, segs) {
        const segAt = t => segs.findIndex(s => t >= s.seqStart - 0.2 && t <= s.seqEnd + 0.2);
        return ranges.map(r => {
            const k = segAt((r.start + r.end) / 2);
            if (k < 0) return r;
            const K = tokens(segs[k].text);
            const similar = i => i >= 0 && i < segs.length && jaccard(K, tokens(segs[i].text)) >= 0.55;
            const hasLater = similar(k + 1) || similar(k + 2);
            if (hasLater) return r; // cutting an earlier take — correct
            for (const i of [k - 1, k - 2]) {
                if (similar(i)) return { start: segs[i].seqStart, end: segs[i].seqEnd,
                                         dur: +(segs[i].seqEnd - segs[i].seqStart).toFixed(1) };
            }
            return r;
        }).filter((r, idx, arr) => arr.findIndex(x => Math.abs(x.start - r.start) < 0.3) === idx);
    }
    window.__fixKeepLast = fixKeepLast; // unit-test hook
    window.__detectRepeats = detectRepeats; // unit-test hook

    async function findRepeats() {
        if (needTranscript()) return;
        const btn = $id("repeat-btn"); if (btn) btn.disabled = true;
        try {
            const keep = ($id("repeat-keep") || {}).value || "last";
            let ranges = detectRepeats(segments, keep).map(i => ({
                start: segments[i].seqStart, end: segments[i].seqEnd,
                dur: +(segments[i].seqEnd - segments[i].seqStart).toFixed(1),
            }));
            let via = L("cihaz içi", "on-device");
            if (!ranges.length && aiAvailable()) {
                showToast(L("Cihaz içi eşleşme yok — AI ile aranıyor…", "No on-device match — asking AI…"), "info", 3000);
                try {
                    const text = await aiComplete(
`You are a video editor. Below is a transcript with line numbers and [MM:SS] start times. Find RE-TAKES: places where the speaker repeats nearly the same sentence (a failed take followed by a corrected one) or clear slips of the tongue. ${keep === "fastest"
    ? "Keep the shortest, most fluent read; the other takes get deleted."
    : "CRITICAL: the FINAL (last) occurrence always stays in the video — output ONLY the EARLIER failed attempts for deletion, NEVER the last one."}
For each take to DELETE output one line "MM:SS-MM:SS reason". If there are none, output "NONE".

Transcript:
${_plainTranscript()}`);
                    ranges = parseAiClipRanges(text).map(r => ({ start: r.start, end: r.end, dur: +(r.end - r.start).toFixed(1) }));
                    if (keep === "last") ranges = fixKeepLast(ranges, segments);
                    via = "AI";
                } catch (e) { showToast("AI: " + e.message, "warning", 4000); }
            }
            if (!ranges.length) {
                showToast(L("Tekrar çekim bulunamadı — kayıt temiz görünüyor ✓", "No repeated takes found — the recording looks clean ✓"), "success", 4000);
                return;
            }
            showRangePreview(L(`Tekrarları kes (${via})`, `Remove repeats (${via})`), ranges, async chosen => {
                if (DESK) {   // desktop: export a trimmed copy instead of timeline cuts
                    if (window.applyTextCutsDesktop) await window.applyTextCutsDesktop(chosen);
                    else showToast(L("Önce bir dosya aç", "Open a file first"), "info", 3000);
                    return;
                }
                await loadHostJSX();
                const sel = await ensureTrackSel();   // shared with the Silence page's track picks
                const r = await hostCut(chosen, sel);
                if (r && r.success && r.removed > 0) {
                    const holes = r.holes
                        ? L(` · ${r.holes} boşluk kapanamadı`, ` · ${r.holes} gap(s) could not close`)
                        : "";
                    showToast(L(`✓ ${r.removed} tekrar kesildi — Cmd/Ctrl+Z ile geri al`, `✓ Cut ${r.removed} repeat(s) — undo with Cmd/Ctrl+Z`) + holes, r.holes ? "warning" : "success", 5000);
                    if (r.holes && r.diag && r.diag.length) console.log("[Subsper] repeat cut diag:", r.diag);
                }
                else {
                    await namedMarkers(chosen.map((c, i) => ({ start: c.start, name: "Repeat " + (i + 1), color: 1 })));
                    showToast(L("Kesilemedi — marker olarak işaretlendi", "Couldn't cut — marked instead"), "warning", 5000);
                }
            });
        } finally { if (btn) btn.disabled = false; }
    }

    // ── Chapters ───────────────────────────────────────────────────────────
    function heuristicChapters(segs) {
        const total = segs[segs.length - 1].seqEnd - segs[0].seqStart;
        const minLen = Math.max(60, total / 8);
        const bounds = [0];
        for (let i = 1; i < segs.length; i++) {
            const last = bounds[bounds.length - 1];
            if (segs[i].seqStart - segs[last].seqStart < minLen) continue;
            const gap = segs[i].seqStart - segs[i - 1].seqEnd;
            const prev = tokens(segs.slice(Math.max(0, i - 4), i).map(s => s.text).join(" "));
            const next = tokens(segs.slice(i, i + 4).map(s => s.text).join(" "));
            if (gap >= 1.2 || jaccard(prev, next) < 0.06) bounds.push(i);
            if (bounds.length >= 10) break;
        }
        const lines = bounds.map((bi, k) => {
            const endI = (k + 1 < bounds.length) ? bounds[k + 1] : segs.length;
            const freq = {};
            tokens(segs.slice(bi, Math.min(endI, bi + 10)).map(s => s.text).join(" "))
                .forEach(w => { if (w.length >= 4) freq[w] = (freq[w] || 0) + 1; });
            const top = Object.keys(freq).sort((a, b) => freq[b] - freq[a]).slice(0, 2);
            const title = top.length ? top.map(w => w[0].toUpperCase() + w.slice(1)).join(" & ")
                                     : L("Bölüm ", "Chapter ") + (k + 1);
            return { start: k === 0 ? 0 : segs[bi].seqStart, title };
        });
        // merge consecutive chapters that ended up with the same title
        const merged = lines.filter((l, i) => i === 0 || l.title !== lines[i - 1].title);
        return merged.map(l => `${mmss(l.start)} ${l.title}`).join("\n");
    }
    window.__heuristicChapters = heuristicChapters; // unit-test hook

    async function chaptersRun() {
        if (needTranscript()) return;
        const out = $id("chapters-out"); if (out) out.value = "…";
        let text = null, via = "AI";
        if (aiAvailable()) {
            try {
                text = await aiComplete(
`Create YouTube chapters for this video transcript. Rules: 4-10 chapters, first one MUST be "00:00", format each line exactly "MM:SS Title" (or HH:MM:SS if over an hour), titles short and catchy, same language as the transcript. Output ONLY the chapter lines.

Transcript:
${_plainTranscript()}`);
            } catch (e) { showToast("AI: " + e.message, "warning", 4000); }
        }
        if (!text) { text = heuristicChapters(segments); via = L("cihaz içi", "on-device"); }
        if (out) out.value = text.trim();
        showToast(L(`Bölümler hazır (${via})`, `Chapters ready (${via})`), "success", 3500);
    }
    function parseChapterLines(text) {
        const out = [];
        (text || "").split(/\n/).forEach(line => {
            const m = line.match(/^\s*(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\s+(.+)$/);
            if (m) out.push({
                start: (m[1] ? +m[1] * 3600 : 0) + (+m[2]) * 60 + (+m[3]),
                name: m[4].trim().slice(0, 60),
            });
        });
        return out;
    }
    window.__parseChapterLines = parseChapterLines; // unit-test hook

    async function chaptersToMarkers() {
        const items = parseChapterLines(($id("chapters-out") || {}).value);
        if (!items.length) { showToast(L("Önce bölümleri oluştur", "Generate chapters first"), "info"); return; }
        const r = await namedMarkers(items.map(i => ({ start: i.start, name: i.name, color: 4 })));
        if (r && r.success) showToast(L(`✓ ${r.added} bölüm marker'ı eklendi`, `✓ ${r.added} chapter marker(s) added`), "success", 4000);
        else showToast((r && r.error) || L("Marker eklenemedi", "Could not add markers"), "error");
    }

    // ── Viral Clips ────────────────────────────────────────────────────────
    const HYPE = /(\!|\?|inanılmaz|asla|kimse|sır|şok|bedava|hata|kesinlikle|en iyi|never|nobody|secret|insane|crazy|free|mistake|best|worst|amazing)/gi;
    function heuristicViral(segs) {
        const wins = [];
        for (let i = 0; i < segs.length; i++) {
            let j = i, words = 0, hype = 0;
            while (j < segs.length && segs[j].seqEnd - segs[i].seqStart <= 55) {
                const t = segs[j].text || "";
                words += tokens(t).length;
                hype += (t.match(HYPE) || []).length;
                j++;
            }
            const dur = (j > i ? segs[j - 1].seqEnd : segs[i].seqEnd) - segs[i].seqStart;
            if (dur >= 15) wins.push({ start: segs[i].seqStart, end: segs[i].seqStart + Math.min(dur, 55),
                                       score: hype * 2 + words / Math.max(dur, 1) });
        }
        wins.sort((a, b) => b.score - a.score);
        const picked = [];
        for (const w of wins) {
            if (picked.length >= 3) break;
            if (picked.some(p => w.start < p.end && w.end > p.start)) continue;
            picked.push(w);
        }
        return picked.sort((a, b) => a.start - b.start);
    }
    window.__heuristicViral = heuristicViral; // unit-test hook

    async function viralRun() {
        if (needTranscript()) return;
        const out = $id("viral-out"); if (out) out.value = "…";
        let ranges = [], via = "AI", lines = null;
        if (aiAvailable()) {
            try {
                lines = await aiComplete(
`Analyze this transcript and pick the top 3 most engaging 15-60 second segments for viral short-form clips. For each output one line: "MM:SS-MM:SS Catchy title". Same language as the transcript. Output ONLY those lines.

Transcript:
${_plainTranscript()}`);
                ranges = parseAiClipRanges(lines);
            } catch (e) { showToast("AI: " + e.message, "warning", 4000); }
        }
        if (!ranges.length) { ranges = heuristicViral(segments); via = L("cihaz içi", "on-device"); }
        if (!ranges.length) { if (out) out.value = ""; showToast(L("Aday bulunamadı", "No candidates found"), "info"); return; }
        const txt = lines && via === "AI" ? lines.trim()
            : ranges.map((r, i) => `${mmss(r.start)}-${mmss(r.end)} ${L("Aday", "Candidate")} ${i + 1}`).join("\n");
        if (out) out.value = txt;
        const r = await namedMarkers(ranges.map((c, i) => ({ start: c.start, name: "Viral " + (i + 1),
            comment: mmss(c.start) + " → " + mmss(c.end), color: 2 })));
        if (r && r.success) showToast(L(`✓ ${r.added} viral marker eklendi (${via})`, `✓ ${r.added} viral marker(s) added (${via})`), "success", 4500);
    }

    // ── B-Roll suggestions ─────────────────────────────────────────────────
    function heuristicBroll(segs) {
        const firstAt = {}, freq = {};
        segs.forEach(s => tokens(s.text).forEach(w => {
            if (w.length < 5) return;
            freq[w] = (freq[w] || 0) + 1;
            if (!(w in firstAt)) firstAt[w] = s.seqStart;
        }));
        return Object.keys(freq).filter(w => freq[w] >= 2)
            .sort((a, b) => freq[b] - freq[a]).slice(0, 8)
            .map(w => `${mmss(firstAt[w])} — ${w[0].toUpperCase() + w.slice(1)}`).join("\n");
    }
    async function brollRun() {
        if (needTranscript()) return;
        const out = $id("broll-out"); if (out) out.value = "…";
        let text = null, via = "AI";
        if (aiAvailable()) {
            try {
                text = await aiComplete(
`Suggest B-roll shots for this video. For the 6-10 best moments output one line each: "MM:SS — what footage to show" (short, concrete, filmable or stock-searchable). Same language as the transcript. Output ONLY those lines.

Transcript:
${_plainTranscript()}`);
            } catch (e) { showToast("AI: " + e.message, "warning", 4000); }
        }
        if (!text) { text = heuristicBroll(segments); via = L("cihaz içi", "on-device"); }
        if (out) out.value = (text || "").trim();
        showToast(L(`B-Roll önerileri hazır (${via})`, `B-roll ideas ready (${via})`), "success", 3500);
    }
    async function brollToMarkers() {
        const items = parseChapterLines((($id("broll-out") || {}).value || "").replace(/ — /g, " "));
        if (!items.length) { showToast(L("Önce önerileri oluştur", "Generate ideas first"), "info"); return; }
        const r = await namedMarkers(items.map(i => ({ start: i.start, name: "B-Roll: " + i.name, color: 6 })));
        if (r && r.success) showToast(L(`✓ ${r.added} B-Roll marker'ı eklendi`, `✓ ${r.added} B-roll marker(s) added`), "success", 4000);
    }

    // ── Vertical resize ────────────────────────────────────────────────────
    async function resizeRun() {
        const sel = $id("resize-format");
        const [w, h] = (sel ? sel.value : "1080x1920").split("x").map(Number);
        const label = sel ? sel.options[sel.selectedIndex].text : "9:16";
        const aBtn = document.querySelector("#rs-anchor button.active");
        const anchor = aBtn ? +aBtn.getAttribute("data-a") : 4;
        const btn = $id("resize-btn"); if (btn) btn.disabled = true;
        try {
            await loadHostJSX();
            const r = await evalScript(`createResizedSequence('${JSON.stringify({ w, h, label, anchor }).replace(/'/g, "\\'")}')`);
            if (r && r.success) {
                const skip = r.skipped
                    ? L(` · ${r.skipped} klip atlandı (Scale'inde keyframe var — elle ölçekle)`,
                        ` · ${r.skipped} clip(s) skipped (keyframed Scale — resize those by hand)`)
                    : "";
                showToast(L(`✓ "${r.name}" oluşturuldu — ${r.count} klip ölçeklendi`, `✓ Created "${r.name}" — scaled ${r.count} clip(s)`) + skip, "success", 7000);
            } else showToast((r && r.error) || L("Dönüştürülemedi", "Resize failed"), "error", 6000);
        } finally { if (btn) btn.disabled = false; }
    }

    // ── Silence Pro ────────────────────────────────────────────────────────
    // Target selector (In/Out vs whole timeline), one-tap rhythm presets,
    // one-click analysis (auto threshold + schematic cut preview) and a
    // Cut / Mark / Mute action picker. Reuses main.js's pipeline:
    // extractTimelineWav / detectSilencesOnWav / findSilenceRanges /
    // cutSilences / detectSilences, plus host duckAudioRanges for Mute.
    const RHYTHM = {
        calm:      { dur: 1.2,  pad: 0.25 },
        measured:  { dur: 0.8,  pad: 0.15 },
        paced:     { dur: 0.5,  pad: 0.08 },
        energetic: { dur: 0.35, pad: 0.04 },
    };
    let _silWav = null, _silInfo = null;   // cached analysis audio

    function silTarget() {
        const seg = $id("sil-target");
        const b = seg && seg.querySelector("button.active");
        return b ? b.getAttribute("data-v") : "inout";
    }
    async function applyTarget() {
        if (silTarget() !== "all") return;
        await loadHostJSX();
        const r = await evalScript("wsSelectWholeRange()");
        if (!(r && r.success)) throw new Error((r && r.error) || L("Timeline okunamadı", "Could not read the timeline"));
    }
    function applyRhythm(key) {
        const p = RHYTHM[key]; if (!p) return;
        onSettingChange("silenceMinDur", p.dur);
        onSettingChange("silencePad", p.pad);
        const set = (id, v) => { const e = $id(id); if (e) e.value = v; };
        const txt = (id, v) => { const e = $id(id); if (e) e.textContent = v; };
        set("set-sildur", p.dur);  txt("sildur-val", p.dur.toFixed(1) + "s");
        set("set-silpad", p.pad);  txt("silpad-val", p.pad.toFixed(2) + "s");
        const wrap = $id("sil-rhythm");
        if (wrap) wrap.querySelectorAll("button").forEach(b =>
            b.classList.toggle("active", b.getAttribute("data-v") === key));
        if (_silWav) redrawStrip();   // instant re-preview on the cached audio
    }
    function drawStrip(ranges, info) {
        const wrap = $id("sil-strip-wrap"), strip = $id("sil-strip"), lab = $id("sil-strip-info");
        if (!wrap || !strip) return;
        wrap.style.display = "block";
        strip.innerHTML = "";
        const dur = Math.max(0.001, info.duration);
        let total = 0;
        ranges.forEach(r => {
            total += r.dur;
            const d = document.createElement("i");
            d.style.left = ((r.start / dur) * 100) + "%";
            d.style.width = (Math.max(0.4, (r.dur / dur) * 100)) + "%";
            strip.appendChild(d);
        });
        if (lab) lab.textContent = ranges.length
            ? L(`${ranges.length} boşluk · ${total.toFixed(1)}s (%${Math.round(total / dur * 100)}) kesilecek`,
                `${ranges.length} gap(s) · ${total.toFixed(1)}s (${Math.round(total / dur * 100)}%) to cut`)
            : L("Bu ayarlarla boşluk bulunamadı", "No gaps at these settings");
    }
    async function redrawStrip() {
        if (!_silWav || !_silInfo) return;
        try {
            const sil = await detectSilencesOnWav(_silWav);
            drawStrip(sil.map(s => ({ start: s.start, end: s.end, dur: s.dur })), _silInfo);
        } catch (e) {}
    }
    async function silAnalyze() {
        const btn = $id("sil-analyze"); if (btn) { btn.disabled = true; }
        setSilenceStatus(L("Ses analiz ediliyor…", "Analyzing audio…"), "info");
        showSilenceProgress(true);
        try {
            await applyTarget();
            await loadHostJSX();
            const seqInfo = await evalScript("getSequenceInfo()");
            if (!seqInfo.success) throw new Error(seqInfo.error || "Error reading timeline");
            if (!seqInfo.clips || !seqInfo.clips.length) throw new Error(L("Timeline'da ses klibi yok", "No audio clips on the timeline"));
            try { if (_silWav && fs.existsSync(_silWav)) fs.unlinkSync(_silWav); } catch (e) {}
            _silWav = await extractTimelineWav(seqInfo);
            _silInfo = seqInfo;
            // auto threshold: try levels, pick the one whose silence share
            // lands in a sensible band (8-40%) — no guessing dB by hand
            const saved = settings.silenceThreshold;
            let best = saved, bestScore = -1, bestSil = null;
            for (const th of [-45, -40, -35, -30, -25]) {
                settings.silenceThreshold = th;
                let sil = [];
                try { sil = await detectSilencesOnWav(_silWav); } catch (e) { continue; }
                const frac = sil.reduce((a, s) => a + s.dur, 0) / Math.max(0.001, seqInfo.duration);
                const score = (frac >= 0.08 && frac <= 0.40) ? 1 - Math.abs(frac - 0.20) : -Math.abs(frac - 0.20);
                if (score > bestScore) { bestScore = score; best = th; bestSil = sil; }
            }
            settings.silenceThreshold = saved;
            onSettingChange("silenceThreshold", best);
            const set = (id, v) => { const e = $id(id); if (e) e.value = v; };
            const txt = (id, v) => { const e = $id(id); if (e) e.textContent = v; };
            set("set-silthr", best); txt("silthr-val", best + " dB");
            drawStrip((bestSil || []).map(s => ({ start: s.start, end: s.end, dur: s.dur })), seqInfo);
            try { await loadTrackChecks(false); } catch (e2) {}
            setSilenceStatus(L(`✓ Eşik ${best} dB olarak ayarlandı — önizleme hazır`, `✓ Threshold set to ${best} dB — preview ready`), "success");
        } catch (e) {
            setSilenceStatus(e.message, "error");
            showToast(e.message, "error", 5000);
        } finally {
            showSilenceProgress(false);
            if (btn) btn.disabled = false;
        }
    }
    // ── track targeting: which tracks the cut/mute is allowed to touch ────
    // Defaults: every video track ON, only A1 ON (music beds usually live on
    // A2+). Selection persists in settings.silTrkSel = {v:[..], a:[..]}.
    async function loadTrackChecks(force) {
        const wrap = $id("sil-tracks"); if (!wrap) return;
        if (wrap.querySelector(".sil-trk") && !force) return;   // real checkboxes, not the hint
        const sel = await ensureTrackSel();                     // media-aware default / saved picks
        await loadHostJSX();
        const r = await evalScript("wsListAllTracks()");
        if (!(r && r.success)) { wrap.innerHTML = `<div class="setting-hint">${(r && r.error) || "?"}</div>`; return; }
        const on = (kind, i) => sel ? ((kind === "v" ? sel.v : sel.a) || []).includes(i)
                                    : (kind === "v" || i === 0);
        const row = (t, kind) => `
            <label class="ui2-check" style="opacity:${t.clips ? 1 : .45}">
              <input type="checkbox" class="sil-trk" data-kind="${kind}" data-i="${t.i}"${on(kind, t.i) ? " checked" : ""}>
              <span>${t.label}${t.clips ? "" : L(" (boş)", " (empty)")}</span></label>`;
        wrap.innerHTML =
            `<div class="ui2-checks" style="grid-template-columns:1fr 1fr">` +
            r.video.map(t => row(t, "v")).join("") + r.audio.map(t => row(t, "a")).join("") + `</div>` +
            `<div class="setting-hint" style="margin-top:6px">${L("İşaretli kanallar kesilir/susturulur; işaretsizlere (müzik, overlay, efekt katmanları) dokunulmaz.", "Checked tracks get cut/muted; unchecked ones (music, overlays, FX layers) are never touched.")}</div>`;
        wrap.querySelectorAll(".sil-trk").forEach(c => c.addEventListener("change", () => {
            onSettingChange("silTrkSel", Object.assign({ ver: 2 }, trackSel()));
        }));
    }
    function trackSel() {
        const boxes = document.querySelectorAll(".sil-trk");
        if (boxes.length) {
            const v = [], a = [];
            boxes.forEach(c => {
                if (!c.checked) return;
                (c.getAttribute("data-kind") === "v" ? v : a).push(+c.getAttribute("data-i"));
            });
            return { v, a };
        }
        return settings.silTrkSel || null;
    }
    // Guarantee a selection BEFORE any cut, even if the user never opened the
    // track list: default = every video track + A1 only, so music beds and FX
    // audio survive out of the box. Saved once, reused everywhere.
    async function ensureTrackSel() {
        // live checkboxes are the source of truth once rendered
        if (document.querySelector(".sil-trk")) return trackSel();
        // saved picks count only if made by the working UI (ver 2) — older
        // auto-saves came from a broken list that selected every video track
        const saved = settings.silTrkSel;
        if (saved && saved.ver === 2 && (saved.v || saved.a)) return saved;
        try {
            await loadHostJSX();
            // default video selection = only tracks that carry real MEDIA clips
            // (adjustment layers / titles / graphic overlays have no media path
            // and are skipped by getSequenceInfo, so they stay untouched)
            const info = await evalScript("getSequenceInfo()");
            if (info && info.success && info.clips && info.clips.length) {
                const v = [...new Set(info.clips
                    .filter(c => /^video/i.test(String(c.track)))
                    .map(c => parseInt(String(c.track).replace(/\D/g, ""), 10))
                    .filter(n => !isNaN(n)))].sort((x, y) => x - y);
                const def = { v, a: [0], ver: 2 };
                onSettingChange("silTrkSel", def);
                return def;
            }
            const r = await evalScript("wsListAllTracks()");
            if (r && r.success) {
                const def = { v: r.video.map(t => t.i), a: [0], ver: 2 };
                onSettingChange("silTrkSel", def);
                return def;
            }
        } catch (e) {}
        return null; // couldn't read tracks — fall back to old all-tracks behavior
    }
    // cut through host: sync-safe targeted cutter when a selection exists,
    // the battle-tested all-tracks ripple otherwise
    async function hostCut(chosen, sel) {
        const fn = sel ? "wsCutRangesSync" : "rippleDeleteRanges";
        const arg = JSON.stringify(sel ? { ranges: chosen, v: sel.v, a: sel.a } : chosen).replace(/'/g, "\\'");
        return evalScript(`${fn}('${arg}')`);
    }

    // Cut with track targeting (the stock cutSilences razors EVERY track —
    // music beds and graphics included; this one only touches selected ones)
    async function cutSilencesPro() {
        setSilenceStatus(L("Kesilecek boşluklar aranıyor…", "Finding gaps to cut…"), "info");
        showSilenceProgress(true);
        try {
            const { ranges } = await findSilenceRanges();
            const pad = Math.max(0, parseFloat(settings.silencePad) || 0);
            const padded = ranges
                .map(r => ({ start: r.start + pad, end: r.end - pad, dur: +(r.end - r.start - 2 * pad).toFixed(2) }))
                .filter(r => r.dur > 0.05);
            if (!padded.length) {
                setSilenceStatus(L("Kesilecek boşluk yok — eşiği yükseltmeyi dene", "Nothing to cut — try raising the threshold"), "warning");
                return;
            }
            const sel = await ensureTrackSel();
            const selNote = sel && (sel.v || sel.a)
                ? L(` (${(sel.v || []).length} video + ${(sel.a || []).length} ses kanalı)`, ` (${(sel.v || []).length} video + ${(sel.a || []).length} audio track(s))`)
                : "";
            showRangePreview(L("Sessizlikleri kes", "Cut silences") + selNote, padded, async chosen => {
                setSilenceStatus(L(`${chosen.length} boşluk kesiliyor…`, `Cutting ${chosen.length} gap(s)…`), "info");
                showSilenceProgress(true);
                try {
                    await evalScript("clearSilenceMarkers()");
                    const r = await hostCut(chosen, sel);
                    if (r && r.success && r.removed > 0) {
                        const holes = r.holes
                            ? L(` · ${r.holes} boşluk kapanamadı (timeline'a bak)`, ` · ${r.holes} gap(s) could not close (check the timeline)`)
                            : "";
                        setSilenceStatus(L(`✓ ${r.removed} parça kesildi — Cmd/Ctrl+Z geri alır`, `✓ Cut ${r.removed} item(s) — undo with Cmd/Ctrl+Z`) + holes, r.holes ? "warning" : "success");
                        if (r.holes && r.diag && r.diag.length) {
                            console.log("[Subsper] cut diag:", r.diag);
                            showToast(L("Teşhis: ", "Diag: ") + r.diag.slice(0, 2).join(" | "), "warning", 9000);
                        }
                        await maybeAddTransitions(chosen, sel);
                    }
                    else {
                        await evalScript(`addSilenceMarkers('${JSON.stringify(chosen).replace(/'/g, "\\'")}')`);
                        setSilenceStatus(L("Kesilemedi — marker olarak işaretlendi", "Couldn't cut — marked instead"), "warning");
                    }
                } finally { showSilenceProgress(false); }
            });
        } catch (e) {
            setSilenceStatus(e.message, "error");
        } finally { showSilenceProgress(false); }
    }

    async function muteSilencesPro() {
        setSilenceStatus(L("Susturulacak boşluklar aranıyor…", "Finding gaps to mute…"), "info");
        showSilenceProgress(true);
        try {
            const { ranges } = await findSilenceRanges();
            const pad = Math.max(0, parseFloat(settings.silencePad) || 0);
            const padded = ranges
                .map(r => ({ start: r.start + pad, end: r.end - pad, dur: +(r.end - r.start - 2 * pad).toFixed(2) }))
                .filter(r => r.dur > 0.05);
            if (!padded.length) {
                setSilenceStatus(L("Susturulacak boşluk yok", "Nothing to mute"), "warning");
                return;
            }
            showRangePreview(L("Sessizlikleri sustur (silmeden)", "Mute silences (keep timing)"), padded, async chosen => {
                await loadHostJSX();
                const sel = await ensureTrackSel();
                if (sel && sel.a && !sel.a.length) {
                    setSilenceStatus(L("Hiç ses kanalı seçili değil — kanal listesinden en az birini işaretle", "No audio track selected — tick at least one in the track list"), "warning");
                    return;
                }
                const payload = JSON.stringify({ ranges: chosen, level: 0, tracks: sel ? sel.a : null }).replace(/'/g, "\\'");
                const r = await evalScript(`duckAudioRanges('${payload}')`);
                if (r && r.success)
                    setSilenceStatus(L(`✓ ${chosen.length} boşluk susturuldu (keyframe) — Cmd/Ctrl+Z geri alır`, `✓ Muted ${chosen.length} gap(s) with keyframes — undo with Cmd/Ctrl+Z`), "success");
                else setSilenceStatus((r && r.error) || L("Susturulamadı", "Mute failed"), "error");
            });
        } catch (e) {
            setSilenceStatus(e.message, "error");
        } finally { showSilenceProgress(false); }
    }
    async function silRun() {
        const seg = $id("sil-action");
        const mode = (seg && seg.querySelector("button.active") || {}).getAttribute
            ? seg.querySelector("button.active").getAttribute("data-v") : "cut";
        try { await applyTarget(); } catch (e) { showToast(e.message, "error", 4000); return; }
        if (mode === "mark") return detectSilences();
        if (mode === "mute") return muteSilencesPro();
        if (mode === "speed") return speedSilencesPro();
        return cutSilencesPro();
    }
    function segControl(id, items, activeIdx) {
        return `<div class="ui2-seg" id="${id}">` + items.map((it, i) =>
            `<button data-v="${it[0]}" class="${i === (activeIdx || 0) ? "active" : ""}">${it[1]}</button>`).join("") + `</div>`;
    }
    function wireSeg(id, onPick) {
        const seg = $id(id); if (!seg) return;
        seg.querySelectorAll("button").forEach(b => b.addEventListener("click", () => {
            seg.querySelectorAll("button").forEach(x => x.classList.remove("active"));
            b.classList.add("active");
            if (onPick) onPick(b.getAttribute("data-v"));
        }));
    }

    function injectSilencePro() {
        if (DESK) return;   // desktop keeps the classic file-based Cut Silences card
        const oldBtn = $id("silence-btn");
        const item = oldBtn && oldBtn.closest(".setting-item");
        if (!item || $id("sil-run")) return;
        const box = document.createElement("div");
        box.innerHTML = `
          <div class="ui2-row-label">${L("Hedef", "Target")}</div>
          ${segControl("sil-target", [["inout", "In/Out"], ["all", L("Tüm Timeline", "Whole timeline")]])}
          <div class="ui2-row-label">${L("Ritim — kesim ne kadar sıkı olsun", "Rhythm — how tight the cut feels")}</div>
          ${segControl("sil-rhythm", [
            ["calm", L("Sakin", "Calm")], ["measured", L("Ölçülü", "Measured")],
            ["paced", L("Tempolu", "Paced")], ["energetic", L("Enerjik", "Energetic")]], 1)}
          <button class="btn-load-srt" id="sil-analyze" style="width:100%; margin-top:10px">${L("Analiz Et — eşiği otomatik ayarla", "Analyze — set the threshold automatically")}</button>
          <div id="sil-strip-wrap" style="display:none; margin-top:8px">
            <div id="sil-strip"></div>
            <div id="sil-strip-info" class="setting-hint" style="margin-top:4px"></div>
          </div>
          <div class="ui2-row-label">${L("Dokunulacak kanallar", "Tracks to touch")}</div>
          <div id="sil-tracks"><div class="setting-hint">${L("Analiz Et'e basınca ya da buraya tıklayınca kanallar listelenir — müzik/efekt kanallarının işaretini kaldır, onlara dokunulmaz.", "Tracks appear after Analyze (or click here) — untick music/FX tracks and they won't be touched.")}</div></div>
          <div class="ui2-row-label">${L("İşlem", "Action")}</div>
          ${segControl("sil-action", [
            ["cut", L("Kes", "Cut")], ["mark", L("İşaretle", "Mark")], ["mute", L("Sustur", "Mute")], ["speed", L("Hızlandır", "Speed up")]])}
          <div class="ui2-row-label">${L("Kesim geçişi", "Cut transition")}</div>
          ${segControl("sil-trans", [["none", L("Yok", "None")], ["cp", "Constant Power"]])}
          <button class="btn-transcribe btn-compact" id="sil-run" style="margin-top:10px">${L("Sessizlikleri Temizle", "Clean Up Silences")}</button>
          <div class="setting-hint" style="margin-top:8px">${L("Kes: ripple-delete (onaylı liste) · İşaretle: marker · Sustur: sesi kapatır · Hızlandır: 4x (deneysel). Constant Power seçiliyse kesim noktalarına ses geçişi denenir.", "Cut: ripple-delete with review · Mark: markers · Mute: silences audio · Speed up: 4x (experimental). With Constant Power on, audio transitions are attempted at cut points.")}</div>`;
        item.appendChild(box);
        wireSeg("sil-target");
        wireSeg("sil-trans");
        wireSeg("sil-rhythm", applyRhythm);
        wireSeg("sil-action", v => {
            const run = $id("sil-run");
            if (run) run.textContent = v === "mark" ? L("Sessizlikleri İşaretle", "Mark Silences")
                : v === "mute" ? L("Sessizlikleri Sustur", "Mute Silences")
                : L("Sessizlikleri Temizle", "Clean Up Silences");
        });
        $id("sil-analyze").onclick = silAnalyze;
        $id("sil-run").onclick = silRun;
        // click the schematic strip → move the Premiere playhead there
        $id("sil-strip").style.cursor = "pointer";
        $id("sil-strip").addEventListener("click", ev => {
            if (!_silInfo) return;
            const rect = ev.currentTarget.getBoundingClientRect();
            const frac = Math.min(1, Math.max(0, (ev.clientX - rect.left) / Math.max(1, rect.width)));
            const t = (_silInfo.inTime || 0) + frac * _silInfo.duration;
            loadHostJSX().then(() => evalScript(`seekToTime(${t.toFixed(3)})`)).catch(() => {});
        });
        $id("sil-tracks").addEventListener("click", () => loadTrackChecks(false));
        // ui-v2 calls this when the Silence page opens → list is there instantly
        window.__silPageOpen = () => { loadTrackChecks(false).catch(() => {}); };
        document.body.classList.add("ui2-silpro");   // hides the two legacy buttons
    }

    // ── Zoom Pro ───────────────────────────────────────────────────────────
    // Triggers (cuts / speech starts / emotion / emphasis) produce moments;
    // host wsZoomPro keyframes Scale+Position per moment with anchor, style
    // (smooth/jump/snap) and optional handheld jitter. Emotion & emphasis use
    // AI when available, otherwise on-device transcript cues.
    const EMO = /(!|inanılmaz|şok|asla|kimse|müthiş|harika|delice|çılgın|insane|crazy|amazing|unbelievable|wow|never|nobody)/i;
    function emphasisTimes(kind) {
        const out = [];
        segments.forEach((s, i) => {
            const t = s.text || "";
            const pause = i > 0 && (s.seqStart - segments[i - 1].seqEnd) > 0.8;
            if (kind === "emotion" ? EMO.test(t) : (pause || /\?/.test(t)))
                out.push(s.seqStart);
        });
        return out;
    }
    window.__emphasisTimes = emphasisTimes; // unit-test hook

    async function aiMomentTimes(kind) {
        const text = await aiComplete(
`From this transcript list the ${kind === "emotion" ? "emotionally charged moments (excitement, surprise, tension)" : "moments where something important is emphasized or a key point lands"}. Output ONLY one "MM:SS" per line, 3-12 lines.

Transcript:
${_plainTranscript()}`);
        const out = [];
        (text || "").split(/\n/).forEach(l => {
            const m = l.match(/(?:(\d{1,2}):)?(\d{1,2}):(\d{2})/);
            if (m) out.push((m[1] ? +m[1] * 3600 : 0) + (+m[2]) * 60 + (+m[3]));
        });
        return out;
    }
    async function zoomProRun() {
        const btn = $id("zoompro-run"); if (btn) btn.disabled = true;
        try {
            const on = id => { const e = $id(id); return !!(e && e.checked); };
            const useCuts = on("zp-cut"), useSpeech = on("zp-speech"),
                  useEmotion = on("zp-emotion"), useEmph = on("zp-emph");
            if (!useCuts && !useSpeech && !useEmotion && !useEmph) {
                showToast(L("En az bir tetikleyici seç", "Pick at least one trigger"), "info"); return;
            }
            if ((useSpeech || useEmotion || useEmph) && !(segments && segments.length)) {
                showToast(L("Konuşma/Duygu/Vurgu tetikleyicileri transcript ister — önce Transcribe (ya da sadece Kesim'i kullan)",
                            "Speech/Emotion/Emphasis triggers need a transcript — Transcribe first (or use Cuts only)"), "info", 5000);
                return;
            }
            let times = [], via = null;
            if (useSpeech) times = times.concat(segments.map(s => s.seqStart));
            for (const [flag, kind] of [[useEmotion, "emotion"], [useEmph, "emphasis"]]) {
                if (!flag) continue;
                let got = [];
                if (aiAvailable()) { try { got = await aiMomentTimes(kind); via = "AI"; } catch (e) { showToast("AI: " + e.message, "warning", 3500); } }
                if (!got.length) { got = emphasisTimes(kind); via = via || L("cihaz içi", "on-device"); }
                times = times.concat(got);
            }
            try { await applyTargetOf("zp-target"); } catch (e) { showToast(e.message, "error", 4000); return; }
            const anchorBtn = document.querySelector("#zp-anchor button.active");
            const styleBtn = document.querySelector("#zp-style button.active");
            const opt = {
                times, useCuts,
                amount: +($id("zp-amount") || {}).value || 120,
                anchor: anchorBtn ? +anchorBtn.getAttribute("data-a") : 4,
                style: styleBtn ? styleBtn.getAttribute("data-v") : "smooth",
                handheld: on("zp-hand"),
            };
            await loadHostJSX();
            const r = await evalScript(`wsZoomPro('${JSON.stringify(opt).replace(/'/g, "\\'")}')`);
            if (r && r.success)
                showToast(L(`✓ ${r.count} noktaya zoom eklendi${via ? ` (${via})` : ""} — Cmd/Ctrl+Z geri alır`,
                            `✓ Zoomed at ${r.count} moment(s)${via ? ` (${via})` : ""} — undo with Cmd/Ctrl+Z`), "success", 5000);
            else {
                showToast((r && r.error) || L("Zoom uygulanamadı", "Zoom failed"), "error", 5000);
                if (r && r.diag && r.diag.length) console.log("[Subsper] zoom diag:", r.diag);
            }
        } finally { if (btn) btn.disabled = false; }
    }
    async function applyTargetOf(segId) {
        const seg = $id(segId);
        const b = seg && seg.querySelector("button.active");
        if (!b || b.getAttribute("data-v") !== "all") return;
        await loadHostJSX();
        const r = await evalScript("wsSelectWholeRange()");
        if (!(r && r.success)) throw new Error((r && r.error) || L("Timeline okunamadı", "Could not read the timeline"));
    }

    function injectZoomPro() {
        if (DESK) return;   // needs Premiere Motion keyframes
        const oldBtn = $id("zoom-btn");
        const item = oldBtn && oldBtn.closest(".setting-item");
        if (!item || $id("zoompro-run")) return;
        const chk = (id, label, checked) => `
          <label class="ui2-check"><input type="checkbox" id="${id}"${checked ? " checked" : ""}>
            <span>${label}</span></label>`;
        const box = document.createElement("div");
        box.innerHTML = `
          <div class="ui2-row-label">${L("Hedef", "Target")}</div>
          ${segControl("zp-target", [["inout", "In/Out"], ["all", L("Tüm Timeline", "Whole timeline")]])}
          <div class="ui2-row-label">${L("Ne zaman zoom yapılsın", "When to zoom")}</div>
          <div class="ui2-checks">
            ${chk("zp-cut", L("Kesimlerde", "On cuts"), true)}
            ${chk("zp-speech", L("Konuşma başlarında", "On speech starts"), false)}
            ${chk("zp-emotion", L("Duygusal anlarda", "On emotional moments"), false)}
            ${chk("zp-emph", L("Vurgu anlarında", "On emphasis"), false)}
          </div>
          <div class="setting-slider-header" style="margin-top:12px">
            <span>${L("Zoom miktarı", "Zoom amount")}</span><span class="setting-value" id="zp-amount-val">120%</span>
          </div>
          <input type="range" class="setting-slider" id="zp-amount" min="105" max="150" step="1" value="120">
          <div class="ui2-row-label">${L("Merkez", "Anchor")}</div>
          <div id="zp-anchor">${[0,1,2,3,4,5,6,7,8].map(a =>
              `<button data-a="${a}" class="${a === 4 ? "active" : ""}"></button>`).join("")}</div>
          <div class="ui2-row-label">${L("Stil", "Style")}</div>
          ${segControl("zp-style", [["smooth", L("Yumuşak", "Smooth")], ["jump", L("Anında", "Jump")], ["snap", L("Vuruşlu", "Snap")]])}
          <label class="ui2-check" style="margin-top:10px"><input type="checkbox" id="zp-hand">
            <span>${L("El kamerası hissi (hafif titreme)", "Handheld feel (subtle shake)")}</span></label>
          <button class="btn-transcribe btn-compact" id="zoompro-run" style="margin-top:12px">${L("Zoom'ları Uygula", "Apply Zooms")}</button>
          <div class="setting-hint" style="margin-top:8px">${L("Duygu/Vurgu: AI anahtarı varsa AI, yoksa cihaz içi ipuçları. Cmd/Ctrl+Z geri alır.", "Emotion/Emphasis: AI when a key is set, on-device cues otherwise. Undo with Cmd/Ctrl+Z.")}</div>`;
        item.appendChild(box);
        wireSeg("zp-target"); wireSeg("zp-style");
        const amt = $id("zp-amount");
        amt.oninput = () => { $id("zp-amount-val").textContent = amt.value + "%"; };
        const grid = $id("zp-anchor");
        grid.querySelectorAll("button").forEach(b => b.addEventListener("click", () => {
            grid.querySelectorAll("button").forEach(x => x.classList.remove("active"));
            b.classList.add("active");
        }));
        $id("zoompro-run").onclick = zoomProRun;
        document.body.classList.add("ui2-zoompro");   // hides the legacy zoom button/intro
    }

    // ── Style Pro + Preset Gallery ─────────────────────────────────────────
    // Extends the caption style system with italic, vertical position
    // (MarginV), glow (outline alpha halo) and box color/opacity controls in
    // a tabbed editor; adds a built-in preset gallery with share codes.
    // main.js's buildASSStyle is replaced (same signature) so every .ass /
    // burn-in export picks the new fields up; .ass has no corner radius or
    // true glow — the halo is an honest approximation.
    function styleLineV2(p, karaoke, colorFn, karaokeHi) {
        const base = colorFn(p.primary, 0);
        const highlight = colorFn(karaokeHi || "FFE000", 0);
        const outlineCol = colorFn(p.outline, p.glow ? Math.min(200, +p.glow) : 0);
        const back = colorFn(p.boxColor, p.box ? p.boxAlpha : 0);
        const border = p.box ? 3 : 1;
        const marginV = (p.marginV != null && p.marginV !== "") ? +p.marginV : ((p.align === 5) ? 0 : 50);
        // max line-box width (Premiere-style safe box): % of PlayResX → L/R margins
        const mLR = (settings.subMaxW != null)
            ? Math.max(0, Math.round((100 - settings.subMaxW) / 2 * (PR().w / 100)))
            : Math.round(PR().w / 32);
        const primaryCol = karaoke ? highlight : base;
        const secondaryCol = karaoke ? base : "&H000000FF";
        return `Style: Default,${p.font},${p.size},${primaryCol},${secondaryCol},${outlineCol},${back},${p.bold ? -1 : 0},${p.italic ? -1 : 0},0,0,100,100,0,0,${border},${p.outlineW},${p.shadow},${p.align},${mLR},${mLR},${marginV},1`;
    }
    window.__styleLineV2 = styleLineV2; // unit-test hook

    const GALLERY = [
        { name: "Klasik Beyaz",  s: { font: "Arial", size: 54, primary: "FFFFFF", outline: "000000", outlineW: 3, shadow: 1, bold: false, italic: false, align: 2, box: false, boxColor: "000000", boxAlpha: 96, glow: 0 } },
        { name: "Kalın Sosyal",  s: { font: "Arial", size: 66, primary: "FFFFFF", outline: "000000", outlineW: 6, shadow: 0, bold: true,  italic: false, align: 2, box: false, boxColor: "000000", boxAlpha: 96, glow: 0 } },
        { name: "Sarı Vurgu",    s: { font: "Arial", size: 60, primary: "FFE000", outline: "000000", outlineW: 4, shadow: 1, bold: true,  italic: false, align: 2, box: false, boxColor: "000000", boxAlpha: 96, glow: 0 } },
        { name: "Kutu Siyah",    s: { font: "Arial", size: 58, primary: "FFFFFF", outline: "000000", outlineW: 0, shadow: 0, bold: true,  italic: false, align: 2, box: true,  boxColor: "000000", boxAlpha: 40, glow: 0 } },
        { name: "Kutu Beyaz",    s: { font: "Arial", size: 56, primary: "111111", outline: "FFFFFF", outlineW: 0, shadow: 0, bold: true,  italic: false, align: 2, box: true,  boxColor: "FFFFFF", boxAlpha: 30, glow: 0 } },
        { name: "Sarı Kutu",     s: { font: "Arial", size: 56, primary: "111111", outline: "FFE000", outlineW: 0, shadow: 0, bold: true,  italic: false, align: 2, box: true,  boxColor: "FFE000", boxAlpha: 20, glow: 0 } },
        { name: "Neon Yeşil",    s: { font: "Arial", size: 58, primary: "FFFFFF", outline: "00FF7F", outlineW: 4, shadow: 0, bold: true,  italic: false, align: 2, box: false, boxColor: "000000", boxAlpha: 96, glow: 120 } },
        { name: "Neon Pembe",    s: { font: "Arial", size: 58, primary: "FFFFFF", outline: "FF2D95", outlineW: 4, shadow: 0, bold: true,  italic: false, align: 2, box: false, boxColor: "000000", boxAlpha: 96, glow: 120 } },
        { name: "Buz Mavisi",    s: { font: "Arial", size: 56, primary: "66D4FF", outline: "003355", outlineW: 3, shadow: 1, bold: true,  italic: false, align: 2, box: false, boxColor: "000000", boxAlpha: 96, glow: 0 } },
        { name: "Kırmızı Enerji",s: { font: "Arial", size: 60, primary: "FF453A", outline: "1A0000", outlineW: 4, shadow: 1, bold: true,  italic: false, align: 2, box: false, boxColor: "000000", boxAlpha: 96, glow: 0 } },
        { name: "Sinematik",     s: { font: "Georgia", size: 48, primary: "F5F5DC", outline: "000000", outlineW: 2, shadow: 2, bold: false, italic: false, align: 2, box: false, boxColor: "000000", boxAlpha: 96, glow: 0 } },
        { name: "Retro Krem",    s: { font: "Georgia", size: 50, primary: "F5E6C8", outline: "3A2A10", outlineW: 2, shadow: 1, bold: false, italic: true,  align: 2, box: false, boxColor: "000000", boxAlpha: 96, glow: 0 } },
        { name: "Minimal İnce",  s: { font: "Arial", size: 44, primary: "FFFFFF", outline: "000000", outlineW: 1, shadow: 0, bold: false, italic: false, align: 2, box: false, boxColor: "000000", boxAlpha: 96, glow: 0 } },
        { name: "Gölgeli",       s: { font: "Arial", size: 56, primary: "FFFFFF", outline: "000000", outlineW: 0, shadow: 3, bold: true,  italic: false, align: 2, box: false, boxColor: "000000", boxAlpha: 96, glow: 0 } },
        { name: "Üst Başlık",    s: { font: "Arial", size: 50, primary: "FFFFFF", outline: "000000", outlineW: 3, shadow: 1, bold: true,  italic: false, align: 8, box: false, boxColor: "000000", boxAlpha: 96, glow: 0 } },
        { name: "Alt Bant",      s: { font: "Arial", size: 46, primary: "FFFFFF", outline: "000000", outlineW: 0, shadow: 0, bold: false, italic: false, align: 2, box: true,  boxColor: "101014", boxAlpha: 60, glow: 0, marginV: 24 } },
    ];

    function styleCode(s) { return "SUBSTYLE1." + btoa(unescape(encodeURIComponent(JSON.stringify(s)))); }
    function parseStyleCode(code) {
        const m = String(code || "").trim().match(/^SUBSTYLE1\.(.+)$/);
        if (!m) return null;
        try {
            const o = JSON.parse(decodeURIComponent(escape(atob(m[1]))));
            return (o && typeof o === "object" && o.primary && o.size) ? o : null;
        } catch (e) { return null; }
    }
    window.__styleCode = styleCode; window.__parseStyleCode = parseStyleCode; // unit-test hooks

    function applyGalleryStyle(s) {
        settings.stylePreset = "custom";
        settings.customStyle = { ...s };
        saveSettings();
        renderStyleChips();
        updateStylePreview();
    }
    function chipPreviewSpan(s, small) {
        const sh = [];
        const ow = Math.max(1, Math.min(3, s.outlineW));
        if (s.outlineW > 0 || s.glow) {
            const g = s.glow ? 5 : 0;
            for (const [dx, dy] of [[-ow, 0], [ow, 0], [0, -ow], [0, ow]])
                sh.push(`${dx}px ${dy}px ${g}px #${s.outline}`);
        }
        if (s.shadow) sh.push(`2px 2px 3px rgba(0,0,0,.9)`);
        const bg = s.box ? `background:#${s.boxColor}${Math.round(255 - s.boxAlpha).toString(16).padStart(2, "0")}; padding:2px 8px; border-radius:3px;` : "";
        return `<span style="font-family:${s.font},sans-serif; font-size:${small ? 15 : 20}px; line-height:1.3;
            font-weight:${s.bold ? 700 : 400}; font-style:${s.italic ? "italic" : "normal"};
            color:#${s.primary}; ${bg} text-shadow:${sh.join(",") || "none"}">Örnek altyazı</span>`;
    }
    function galleryItems() {
        return GALLERY.concat((settings.galleryMine || []).map(x => ({ name: x.name, s: x.s, mine: true })));
    }
    function openGallery() {
        const prev = $id("ui2-gal-ov"); if (prev) prev.remove();
        const items = galleryItems();
        const ov = document.createElement("div");
        ov.id = "ui2-gal-ov";
        ov.innerHTML = `
          <div class="ui2-gal-card">
            <div class="ui2-gal-head">
              <span>${L("Preset Galerisi", "Preset Gallery")}</span>
              <button class="btn-secondary" id="ui2-gal-close">${L("Kapat", "Close")}</button>
            </div>
            <div class="ui2-gal-grid">
              ${items.map((g, i) => `
                <button class="ui2-gal-chip" data-i="${i}">
                  ${g.mine ? `<span class="ui2-gal-del" data-i="${i}" title="${L("Sil", "Delete")}">✕</span>` : ""}
                  <span class="ui2-gal-prev">${chipPreviewSpan(g.s, true)}</span>
                  <span class="ui2-gal-name">${g.mine ? "★ " : ""}${g.name}</span>
                </button>`).join("")}
            </div>
            <div class="ui2-gal-share">
              <button class="btn-secondary" id="ui2-gal-mine">${L("➕ Aktif stili galeriye kaydet", "➕ Save current style to gallery")}</button>
              <button class="btn-secondary" id="ui2-gal-copy">${L("Stil kodunu kopyala", "Copy style code")}</button>
              <div style="display:flex; gap:6px; flex:1; min-width:200px">
                <input type="text" id="ui2-gal-paste" class="settings-textarea" style="height:30px; flex:1; margin:0"
                       placeholder="${L("Stil kodu yapıştır (SUBSTYLE1.…)", "Paste a style code (SUBSTYLE1.…)")}">
                <button class="btn-secondary" id="ui2-gal-import">${L("İçe aktar", "Import")}</button>
              </div>
            </div>
          </div>`;
        document.body.appendChild(ov);
        ov.addEventListener("click", e => { if (e.target === ov) ov.remove(); });
        $id("ui2-gal-close").onclick = () => ov.remove();
        ov.querySelectorAll(".ui2-gal-del").forEach(x => x.addEventListener("click", ev => {
            ev.stopPropagation();
            const i = +x.getAttribute("data-i") - GALLERY.length;
            const mine = settings.galleryMine || [];
            if (i >= 0 && i < mine.length) {
                mine.splice(i, 1);
                settings.galleryMine = mine;
                saveSettings();
                openGallery();   // re-render
            }
        }));
        ov.querySelectorAll(".ui2-gal-chip").forEach(b => b.addEventListener("click", () => {
            applyGalleryStyle(items[+b.getAttribute("data-i")].s);
            ov.querySelectorAll(".ui2-gal-chip").forEach(x => x.classList.remove("active"));
            b.classList.add("active");
            showToast(L("Stil uygulandı — favorilere de kaydedebilirsin", "Style applied — you can also save it as a favorite"), "success", 3000);
        }));
        $id("ui2-gal-mine").onclick = () => {
            const name = prompt(L("Preset adı:", "Preset name:"), L("Benim Stilim", "My Style"));
            if (!name) return;
            const mine = settings.galleryMine || [];
            mine.push({ name: name.slice(0, 22), s: { ...DEFAULT_CUSTOM_STYLE, glow: 0, italic: false, marginV: null, ...(settings.customStyle || {}) } });
            settings.galleryMine = mine.slice(-12);
            saveSettings();
            openGallery();   // re-render with the new card
        };
        $id("ui2-gal-copy").onclick = () => copyText(styleCode({ ...DEFAULT_CUSTOM_STYLE, ...(settings.customStyle || {}) }));
        $id("ui2-gal-import").onclick = () => {
            const s = parseStyleCode(($id("ui2-gal-paste") || {}).value);
            if (!s) { showToast(L("Kod çözülemedi", "Couldn't read that code"), "error"); return; }
            applyGalleryStyle(s);
            showToast(L("Stil içe aktarıldı ve uygulandı", "Style imported and applied"), "success");
        };
    }

    function buildStyleTabs() {
        const form = $id("custom-style-form");
        if (!form || $id("stab-bar")) return;
        const cs = () => ({ ...DEFAULT_CUSTOM_STYLE, glow: 0, italic: false, marginV: null, ...(settings.customStyle || {}) });
        const bar = document.createElement("div");
        bar.className = "ui2-seg"; bar.id = "stab-bar"; bar.style.marginBottom = "10px";
        const tabs = [["text", L("Yazı", "Text")], ["stroke", L("Kontur", "Stroke")], ["box", L("Kutu", "Box")], ["pos", L("Konum", "Position")]];
        bar.innerHTML = tabs.map(([v, l], i) => `<button data-v="${v}" class="${i === 0 ? "active" : ""}">${l}</button>`).join("");
        const panes = {};
        tabs.forEach(([v]) => {
            const d = document.createElement("div");
            d.className = "stab-pane"; d.setAttribute("data-pane", v);
            d.style.display = v === "text" ? "block" : "none";
            panes[v] = d;
        });
        // move existing controls into their tabs (IDs & listeners survive)
        const grab = sel => { const e = form.querySelector(sel); return e; };
        const moveWithHeader = (inputSel, pane) => {
            const inp = grab(inputSel); if (!inp) return;
            const head = inp.previousElementSibling;
            if (head && head.classList.contains("setting-slider-header")) pane.appendChild(head);
            pane.appendChild(inp);
        };
        const pf = grab("#cust-primary"); if (pf) panes.text.appendChild(pf.closest(".custom-field"));
        const of = grab("#cust-outline"); if (of) panes.stroke.appendChild(of.closest(".custom-field"));
        moveWithHeader("#cust-size", panes.text);
        moveWithHeader("#cust-ow", panes.stroke);
        const bold = grab("#cust-bold"); if (bold) panes.text.appendChild(bold.closest("label"));
        const box = grab("#cust-box"); if (box) panes.box.appendChild(box.closest("label"));
        const align = grab("#cust-align"); if (align) panes.pos.appendChild(align);
        // clear leftovers, then assemble
        form.querySelectorAll(".custom-row").forEach(r => { if (!r.querySelector("input,select")) r.remove(); });
        form.insertBefore(bar, form.firstChild);
        tabs.forEach(([v]) => form.appendChild(panes[v]));
        wireSeg("stab-bar", v => {
            form.querySelectorAll(".stab-pane").forEach(p =>
                p.style.display = p.getAttribute("data-pane") === v ? "block" : "none");
        });
        // new fields
        panes.text.insertAdjacentHTML("beforeend", `
          <div class="setting-slider-header" style="margin-top:10px"><span>${L("Yazı tipi", "Font")}</span></div>
          <input type="text" id="cust-font" class="settings-textarea" style="height:30px; font-family:var(--font)"
                 placeholder="Arial">
          <label class="ui2-check" style="margin-top:8px"><input type="checkbox" id="cust-italic"><span>${L("İtalik", "Italic")}</span></label>`);
        panes.stroke.insertAdjacentHTML("beforeend", `
          <div class="setting-slider-header" style="margin-top:10px"><span>${L("Parlama (glow — yaklaşık)", "Glow (approximate)")}</span><span class="setting-value" id="cust-glow-val">0</span></div>
          <input type="range" class="setting-slider" id="cust-glow" min="0" max="200" step="10" value="0">
          <div class="setting-slider-header" style="margin-top:10px"><span>${L("Gölge", "Shadow")}</span><span class="setting-value" id="cust-shadow-val">1</span></div>
          <input type="range" class="setting-slider" id="cust-shadow" min="0" max="4" step="1" value="1">`);
        panes.box.insertAdjacentHTML("beforeend", `
          <div class="custom-row" style="margin-top:10px">
            <div class="custom-field">
              <label class="custom-label">${L("Kutu rengi", "Box color")}</label>
              <input type="color" id="cust-boxcolor" value="#000000">
            </div>
          </div>
          <div class="setting-slider-header" style="margin-top:10px"><span>${L("Kutu şeffaflığı", "Box transparency")}</span><span class="setting-value" id="cust-boxalpha-val">96</span></div>
          <input type="range" class="setting-slider" id="cust-boxalpha" min="0" max="220" step="4" value="96">
          <div class="setting-hint">${L("0 = tam opak. Not: .ass köşe yuvarlama desteklemez.", "0 = fully opaque. Note: .ass has no corner radius.")}</div>`);
        panes.pos.insertAdjacentHTML("beforeend", `
          <div class="setting-slider-header" style="margin-top:10px"><span>${L("Dikey konum (kenardan)", "Vertical offset (from edge)")}</span><span class="setting-value" id="cust-mv-val">50</span></div>
          <input type="range" class="setting-slider" id="cust-mv" min="0" max="320" step="5" value="50">`);
        const wire = (id, key, valId, fmt) => {
            const e = $id(id); if (!e) return;
            e.addEventListener(e.type === "checkbox" || e.type === "color" || e.type === "text" ? "change" : "input", () => {
                const v = e.type === "checkbox" ? e.checked
                        : e.type === "color" ? e.value.slice(1).toUpperCase()
                        : e.type === "text" ? (e.value.trim() || "Arial")
                        : +e.value;
                updateCustomStyle(key, v);
                if (valId) { const ve = $id(valId); if (ve) ve.textContent = fmt ? fmt(v) : v; }
            });
        };
        wire("cust-font", "font");
        wire("cust-italic", "italic");
        wire("cust-glow", "glow", "cust-glow-val");
        wire("cust-shadow", "shadow", "cust-shadow-val");
        wire("cust-boxcolor", "boxColor");
        wire("cust-boxalpha", "boxAlpha", "cust-boxalpha-val");
        wire("cust-mv", "marginV", "cust-mv-val");
        // keep new fields in sync when the form is (re)populated
        const _pop = window.populateCustomForm;
        window.populateCustomForm = function () {
            _pop();
            const s = cs();
            const set = (id, v) => { const e = $id(id); if (e) e.value = v; };
            set("cust-font", s.font); set("cust-glow", s.glow || 0);
            set("cust-shadow", s.shadow); set("cust-boxcolor", "#" + s.boxColor);
            set("cust-boxalpha", s.boxAlpha); set("cust-mv", s.marginV != null ? s.marginV : 50);
            const chk = $id("cust-italic"); if (chk) chk.checked = !!s.italic;
            ["glow", "shadow", "boxalpha"].forEach(k => {
                const ve = $id("cust-" + k + "-val"); if (ve) ve.textContent = s[k === "boxalpha" ? "boxAlpha" : k] || 0;
            });
            const mv = $id("cust-mv-val"); if (mv) mv.textContent = s.marginV != null ? s.marginV : 50;
        };
        // italic reflected in the live preview
        const _upd = window.updateStylePreview;
        window.updateStylePreview = function () {
            _upd();
            const t = $id("style-preview-text");
            if (t) t.style.fontStyle = getActivePreset().italic ? "italic" : "normal";
        };
    }

    function injectGalleryButton() {
        const chips = $id("style-chips");
        if (!chips || $id("ui2-gal-btn")) return;
        const b = document.createElement("button");
        b.id = "ui2-gal-btn";
        b.className = "btn-load-srt";
        b.style.cssText = "width:100%; margin-top:8px";
        b.textContent = L("Preset Galerisi — 16 hazır stil + kod paylaşımı", "Preset Gallery — 16 styles + share codes");
        b.onclick = openGallery;
        chips.parentNode.insertBefore(b, chips.nextSibling);
    }

    const EXTRA_LANGS = [
        ["az", "Azərbaycanca"], ["uk", "Українська"], ["cs", "Čeština"], ["sv", "Svenska"],
        ["da", "Dansk"], ["no", "Norsk"], ["fi", "Suomi"], ["el", "Ελληνικά"], ["he", "עברית"],
        ["hi", "हिन्दी"], ["id", "Bahasa Indonesia"], ["ms", "Bahasa Melayu"], ["vi", "Tiếng Việt"],
        ["th", "ไทย"], ["ro", "Română"], ["hu", "Magyar"], ["bg", "Български"], ["sr", "Srpski"],
        ["hr", "Hrvatski"], ["sk", "Slovenčina"], ["sl", "Slovenščina"], ["lt", "Lietuvių"],
        ["lv", "Latviešu"], ["et", "Eesti"], ["ka", "ქართული"], ["hy", "Հայերեն"], ["fa", "فارسی"],
        ["ur", "اردو"], ["bn", "বাংলা"], ["ta", "தமிழ்"], ["te", "తెలుగు"], ["ml", "മലയാളം"],
        ["kn", "ಕನ್ನಡ"], ["mr", "मराठी"], ["pa", "ਪੰਜਾਬੀ"], ["gu", "ગુજરાતી"], ["sw", "Kiswahili"],
        ["af", "Afrikaans"], ["ca", "Català"], ["eu", "Euskara"], ["gl", "Galego"], ["is", "Íslenska"],
        ["mk", "Македонски"], ["sq", "Shqip"], ["bs", "Bosanski"], ["kk", "Қазақша"], ["uz", "Oʻzbekcha"],
        ["mn", "Монгол"], ["ne", "नेपाली"], ["si", "සිංහල"], ["km", "ខ្មែរ"], ["my", "မြန်မာ"],
    ];
    function extendLangList() {
        const sel = $id("lang-select"); if (!sel) return;
        const have = new Set([...sel.options].map(o => o.value));
        EXTRA_LANGS.forEach(([code, name]) => {
            if (have.has(code)) return;
            const o = document.createElement("option");
            o.value = code; o.textContent = name;
            sel.appendChild(o);
        });
        if (settings.spokenLang) sel.value = settings.spokenLang;
    }

    // ── live elapsed counter on Pro/Python transcription status ───────────
    // WhisperX/openai-whisper run batched and report no incremental progress,
    // so a real % is only possible on the bundled engine — show a ticking
    // elapsed clock instead of the frozen "Transcribing with X…" line.
    function patchStatusTimer() {
        if (typeof window.setStatus !== "function") return;
        const _set = window.setStatus;
        let timer = null;
        window.setStatus = function (msg, type) {
            const m = String(msg || "");
            if (/Transcribing with .*(Pro|Python)/.test(m)) {
                if (!timer) {
                    const t0 = Date.now();
                    const base = m.replace(/…\s*$/, "");
                    timer = setInterval(() => {
                        const s = Math.floor((Date.now() - t0) / 1000);
                        _set(`${base}… ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`, "info");
                    }, 1000);
                }
                _set(m, type);
                return;
            }
            if (timer) { clearInterval(timer); timer = null; }
            _set(msg, type);
        };
    }

    // Turkish users saw English strings in the range-review modal — localize
    // it after the stock builder runs (title is already localized by callers)
    function patchRangePreviewI18n() {
        if (typeof window.showRangePreview !== "function") return;
        const _orig = window.showRangePreview;
        window.showRangePreview = function (title, ranges, onApply) {
            _orig(title, ranges, onApply);
            if (settings.uiLang !== "tr") return;
            const ov = $id("range-preview-ov"); if (!ov) return;
            ov.querySelectorAll("div").forEach(d => {
                if (d.children.length === 0 && /range\(s\)/.test(d.textContent)) {
                    const total = ranges.reduce((a, r) => a + (r.end - r.start), 0);
                    d.textContent = `${ranges.length} aralık · ~${total.toFixed(1)}s — kalmasını istediklerinin işaretini kaldır`;
                }
            });
            const c = $id("rp-cancel"); if (c) c.textContent = "Vazgeç";
            const a = $id("rp-apply"); if (a) a.textContent = "Uygula";
        };
    }

    function stylePro() {
        patchStatusTimer();
        patchRangePreviewI18n();
        if (typeof window.buildASSStyle === "function" && typeof assColor === "function")
            window.buildASSStyle = (p, k) => styleLineV2(p, k, assColor, settings.karaokeHi);
        buildStyleTabs();
        injectGalleryButton();
        extendLangList();
    }

    // ── Podcast Multicam ───────────────────────────────────────────────────
    // No AI/diarization needed: each mapped audio track is rendered to a
    // timeline-length WAV (extractClipsToWav places clips at their offsets),
    // speech intervals come from inverting silence detection per track, a
    // switch timeline is built with a minimum shot hold, and host
    // wsMulticamApply razors + disables the other speakers' video clips.
    function mcInvert(silences, dur) {
        const speech = []; let t = 0;
        for (const s of silences) {
            if (s.start > t + 0.05) speech.push({ start: t, end: s.start });
            t = Math.max(t, s.end);
        }
        if (dur > t + 0.05) speech.push({ start: t, end: dur });
        return speech;
    }
    function mcSwitch(speech, dur, hold) {
        const spks = Object.keys(speech);
        const pts = new Set([0, dur]);
        spks.forEach(k => speech[k].forEach(r => { pts.add(r.start); pts.add(r.end); }));
        const times = [...pts].filter(t => t >= 0 && t <= dur).sort((a, b) => a - b);
        const talking = (k, t) => speech[k].some(r => t >= r.start - 0.01 && t < r.end);
        let cur = spks[0] || null;
        const raw = [];
        for (let i = 0; i + 1 < times.length; i++) {
            const mid = (times[i] + times[i + 1]) / 2;
            const active = spks.filter(k => talking(k, mid));
            let spk = cur;
            if (active.length && !active.includes(cur)) spk = active[0];
            else if (active.includes(cur)) spk = cur;
            cur = spk;
            if (raw.length && raw[raw.length - 1].spk === spk) raw[raw.length - 1].end = times[i + 1];
            else raw.push({ start: times[i], end: times[i + 1], spk });
        }
        // enforce minimum shot length by absorbing short shots into the previous one
        const out = [];
        for (const s of raw) {
            if (out.length && (s.end - s.start) < hold) { out[out.length - 1].end = s.end; continue; }
            if (out.length && out[out.length - 1].spk === s.spk) { out[out.length - 1].end = s.end; continue; }
            out.push({ ...s });
        }
        return out;
    }
    window.__mcInvert = mcInvert; window.__mcSwitch = mcSwitch; // unit-test hooks

    let _mcInfo = null;
    async function mcScan() {
        const btn = $id("mc-scan"); if (btn) btn.disabled = true;
        try {
            await loadHostJSX();
            const info = await evalScript("getSequenceInfo()");
            if (!info.success) throw new Error(info.error || "Error reading timeline");
            if (!info.clips || !info.clips.length) throw new Error(L("Timeline'da klip yok", "No clips on the timeline"));
            _mcInfo = info;
            const labels = [...new Set(info.clips.map(c => c.track))];
            const auds = labels.filter(l => /^a/i.test(String(l)));
            const vids = labels.filter(l => /^v/i.test(String(l)));
            if (auds.length < 2 || vids.length < 2)
                throw new Error(L("En az 2 ses ve 2 video kanalı gerekir (her konuşmacının kendi mikrofonu + kamerası)",
                                  "Needs at least 2 audio and 2 video tracks (each speaker on their own mic + camera)"));
            const spkOpts = n => [0, 1, 2, 3].map(i =>
                `<option value="${i === 0 ? "" : "S" + i}"${("S" + n) === ("S" + i) ? " selected" : ""}>${i === 0 ? L("— kullanma", "— unused") : L("Konuşmacı ", "Speaker ") + i}</option>`).join("");
            const pretty = l => String(l).replace(/^video(\d+)$/i, (m, n) => "V" + (+n + 1))
                                         .replace(/^audio(\d+)$/i, (m, n) => "A" + (+n + 1));
            const rows = (arr, cls) => arr.map((l, i) =>
                `<div class="setting-row" style="min-height:36px; padding:6px 0">
                   <div class="setting-info"><div class="setting-name" style="font-weight:500">${pretty(l)}</div></div>
                   <select class="${cls}" data-track="${l}" style="max-width:150px">${spkOpts(Math.min(i + 1, 3))}</select>
                 </div>`).join("");
            $id("mc-map").innerHTML =
                `<div class="ui2-row-label">${L("Ses kanalları", "Audio tracks")}</div>${rows(auds, "mc-a")}
                 <div class="ui2-row-label">${L("Video kanalları", "Video tracks")}</div>${rows(vids, "mc-v")}`;
            $id("mc-run").style.display = "";
        } catch (e) { showToast(e.message, "error", 5500); }
        finally { if (btn) btn.disabled = false; }
    }
    async function mcRun() {
        const btn = $id("mc-run"); if (btn) btn.disabled = true;
        try {
            const info = _mcInfo;
            if (!info) throw new Error(L("Önce kanalları tara", "Scan tracks first"));
            const pick = cls => {
                const m = {};
                document.querySelectorAll("select." + cls).forEach(s => { if (s.value) m[s.getAttribute("data-track")] = s.value; });
                return m;
            };
            const aMap = pick("mc-a"), vMap = pick("mc-v");
            const spks = [...new Set(Object.values(aMap))];
            if (spks.length < 2 || !Object.keys(vMap).length)
                throw new Error(L("En az 2 konuşmacıya ses VE video kanalı eşleştir", "Map audio AND video tracks to at least 2 speakers"));
            const W = wcpp();
            if (!W) throw new Error(L("Yerleşik motor bulunamadı — Kurulum sekmesine bak", "Bundled engine not found — see Setup"));
            const speech = {};
            let n = 0;
            for (const spk of spks) {
                n++;
                setSilenceStatus(L(`Konuşmacı ${n}/${spks.length} sesi analiz ediliyor…`, `Analyzing speaker ${n}/${spks.length}…`), "info");
                const clips = info.clips.filter(c => aMap[c.track] === spk);
                if (!clips.length) continue;
                const tmp = path.join(os.tmpdir(), `subsper_mc_${spk}_${Date.now()}.wav`);
                await W.extractClipsToWav(extDir(), { clips, duration: info.duration }, tmp, { env: spawnEnv() });
                const sil = await W.detectSilence(extDir(), tmp, -38, 0.35, { env: spawnEnv() });
                try { fs.unlinkSync(tmp); } catch (e) {}
                speech[spk] = mcInvert(sil, info.duration);
            }
            const segs = mcSwitch(speech, info.duration, 1.2)
                .map(s => ({ start: s.start + info.inTime, end: s.end + info.inTime, spk: s.spk }));
            const videoMap = {};
            Object.keys(vMap).forEach(l => {
                const idx = parseInt(String(l).replace(/\D/g, ""), 10);   // labels are 0-based ("video0")
                if (!isNaN(idx) && idx >= 0) videoMap[idx] = vMap[l];
            });
            setSilenceStatus(L("Kamera geçişleri uygulanıyor…", "Applying camera switches…"), "info");
            await loadHostJSX();
            const payload = JSON.stringify({ segs, videoMap }).replace(/'/g, "\\'");
            const r = await evalScript(`wsMulticamApply('${payload}')`);
            if (r && r.success)
                setSilenceStatus(L(`✓ ${r.tracks} kamera kanalında ${r.disabled} klip kapatıldı — Cmd/Ctrl+Z geri alır`,
                                   `✓ Disabled ${r.disabled} clip(s) across ${r.tracks} camera track(s) — undo with Cmd/Ctrl+Z`), "success");
            else {
                setSilenceStatus((r && r.error) || L("Uygulanamadı", "Could not apply"), "error");
                if (r && r.diag && r.diag.length) console.log("[Subsper] multicam diag:", r.diag);
            }
        } catch (e) {
            setSilenceStatus(e.message, "error");
            showToast(e.message, "error", 5500);
        } finally { if (btn) btn.disabled = false; }
    }

    // ── Card injection into panel-ed-work (ui-v2 isolates them per page) ──
    function card(html) {
        const d = document.createElement("div");
        d.className = "setting-item tool-card";
        d.innerHTML = html;
        return d;
    }
    const OUT = 'class="settings-textarea" rows="6" readonly style="margin-top:8px; font-family:var(--font); font-size:12px"';

    function injectAll() {
        const sc = document.querySelector("#panel-ed-work .setup-scroll");
        if (!sc || $id("repeat-btn")) return;

        injectSilencePro();
        injectZoomPro();
        stylePro();

        const rep = card(`
          <div class="setting-row"><div class="setting-info">
            <div class="setting-name">${L("Tekrarları Sil", "Remove Repeats")}</div>
            <div class="setting-desc">${DESK
                ? L("Aynı cümlenin tekrar çekimlerini bulur, kötü take'ler çıkarılmış kırpılmış dosya üretir. Önce Transcribe.", "Finds re-taken sentences and exports a trimmed file with the bad takes removed. Transcribe first.")
                : L("Aynı cümlenin tekrar çekimlerini bulur, kötü take'leri kesip atar. Önce Transcribe.", "Finds re-taken sentences and ripple-deletes the bad takes. Transcribe first.")}</div>
          </div></div>
          <div class="setting-row">
            <div class="setting-info"><div class="setting-name" style="font-weight:500">${L("Hangisi kalsın?", "Which take to keep?")}</div></div>
            <select id="repeat-keep" style="max-width:170px">
              <option value="last">${L("Son take", "Last take")}</option>
              <option value="fastest">${L("En akıcı (kısa)", "Fastest read")}</option>
            </select>
          </div>
          <button class="btn-transcribe btn-compact" id="repeat-btn" style="margin-top:8px">${L("Tekrarları Bul ve Kes", "Find & Cut Repeats")}</button>
          <div class="setting-hint" style="margin-top:8px">${DESK
            ? L("Kesmeden önce liste gösterilir, onaylarsın. Sonuç, tekrarlar çıkarılmış yeni bir dosya olarak kaydedilir. AI anahtarı varsa dil sürçmelerini de yakalar.", "You review the list before anything is cut. The result is saved as a new file with the repeats removed. With an AI key it also catches slips.")
            : L("Kesmeden önce liste gösterilir, onaylarsın. Kesim sadece seçili kanallara dokunur (varsayılan: videolar + A1 — müzik kanalları güvende; listeyi Sessizlik sayfasında düzenlersin). AI anahtarı varsa dil sürçmelerini de yakalar.", "You review the list before anything is cut. Cutting only touches selected tracks (default: video + A1 — music tracks are safe; edit the list on the Silence page). With an AI key it also catches slips.")}</div>`);
        sc.appendChild(rep); $id("repeat-btn").onclick = findRepeats;

        const ch = card(`
          <div class="setting-row"><div class="setting-info">
            <div class="setting-name">${L("Bölümler", "Chapters")}</div>
            <div class="setting-desc">${DESK
                ? L("Videoyu bölümlere ayırır: YouTube açıklaması için hazır metin üretir.", "Splits the video into chapters: ready-to-paste YouTube text.")
                : L("Videoyu bölümlere ayırır: timeline'a isimli marker + YouTube açıklaması için hazır metin.", "Splits the video into chapters: named timeline markers + ready-to-paste YouTube text.")}</div>
          </div></div>
          <button class="btn-transcribe btn-compact" id="chapters-btn" style="margin-top:4px">${L("Bölümleri Oluştur", "Generate Chapters")}</button>
          <textarea id="chapters-out" ${OUT} placeholder="00:00 …"></textarea>
          <div style="display:flex; gap:8px; margin-top:6px; margin-bottom:6px">
            <button class="btn-secondary" id="chapters-mark" style="flex:1">${L("Marker olarak ekle", "Add as markers")}</button>
            <button class="btn-secondary" id="chapters-copy" style="flex:1">${L("Metni kopyala", "Copy text")}</button>
          </div>`);
        sc.appendChild(ch);
        $id("chapters-btn").onclick = chaptersRun;
        $id("chapters-mark").onclick = chaptersToMarkers;
        $id("chapters-copy").onclick = () => copyText(($id("chapters-out") || {}).value || "");
        if (DESK) $id("chapters-mark").style.display = "none";   // markers are Premiere-only

        const vi = card(`
          <div class="setting-row"><div class="setting-info">
            <div class="setting-name">${L("Viral Klipler", "Viral Clips")}</div>
            <div class="setting-desc">${DESK
                ? L("Uzun videodan kısa içerik için en güçlü 15-60 saniyelik anları bulur ve listeler.", "Finds and lists the strongest 15-60s moments for short-form content.")
                : L("Uzun videodan kısa içerik için en güçlü 15-60 saniyelik anları bulur ve timeline'a marker koyar.", "Finds the strongest 15-60s moments for short-form content and drops markers on the timeline.")}</div>
          </div></div>
          <button class="btn-transcribe btn-compact" id="viral-btn" style="margin-top:4px">${L("Viral Anları Bul", "Find Viral Moments")}</button>
          <textarea id="viral-out" ${OUT} placeholder="MM:SS-MM:SS …"></textarea>`);
        sc.appendChild(vi); $id("viral-btn").onclick = viralRun;

        const br = card(`
          <div class="setting-row"><div class="setting-info">
            <div class="setting-name">B-Roll</div>
            <div class="setting-desc">${L("Anlatılan konulara uygun ara görüntü (B-Roll) önerileri üretir; istersen anlarına marker koyar.", "Suggests B-roll footage for what's being said; optionally drops markers at those moments.")}</div>
          </div></div>
          <button class="btn-transcribe btn-compact" id="broll-btn" style="margin-top:4px">${L("B-Roll Önerileri", "Suggest B-Roll")}</button>
          <textarea id="broll-out" ${OUT} placeholder="MM:SS — …"></textarea>
          <button class="btn-secondary" id="broll-mark" style="width:100%; margin-top:6px; margin-bottom:6px">${L("Marker olarak ekle", "Add as markers")}</button>`);
        sc.appendChild(br);
        $id("broll-btn").onclick = brollRun;
        $id("broll-mark").onclick = brollToMarkers;
        if (DESK) $id("broll-mark").style.display = "none";   // markers are Premiere-only

        if (DESK) return;   // Vertical Resize + Multicam need a Premiere sequence
        const rs = card(`
          <div class="setting-row"><div class="setting-info">
            <div class="setting-name">${L("Dikey Kes", "Vertical Resize")}</div>
            <div class="setting-desc">${L("Sekansın kopyasını sosyal formata çevirir; klipleri kadrajı dolduracak şekilde ölçekler (merkez kadraj — kişi takibi yok).", "Creates a social-format copy of the sequence and scales clips to fill (center framing — no subject tracking).")}</div>
          </div></div>
          <div class="setting-row">
            <div class="setting-info"><div class="setting-name" style="font-weight:500">${L("Hedef format", "Target format")}</div></div>
            <select id="resize-format" style="max-width:170px">
              <option value="1080x1920">9:16 — TikTok / Reels</option>
              <option value="1080x1080">1:1 — ${L("Kare", "Square")}</option>
              <option value="1080x1350">4:5 — Instagram</option>
            </select>
          </div>
          <div class="ui2-row-label">${L("Kadraj merkezi", "Framing anchor")}</div>
          <div class="ui2-anchor" id="rs-anchor">${[0,1,2,3,4,5,6,7,8].map(a =>
              `<button data-a="${a}" class="${a === 4 ? "active" : ""}"></button>`).join("")}</div>
          <button class="btn-transcribe btn-compact" id="resize-btn" style="margin-top:10px">${L("Kopya Sekans Oluştur", "Create Resized Copy")}</button>
          <div class="setting-hint" style="margin-top:8px">${L("Deneysel — Premiere 2019+ gerekir. Orijinal sekans değişmez.", "Experimental — needs Premiere 2019+. The original sequence is untouched.")}</div>`);
        sc.appendChild(rs); $id("resize-btn").onclick = resizeRun;
        const rsGrid = $id("rs-anchor");
        rsGrid.querySelectorAll("button").forEach(b => b.addEventListener("click", () => {
            rsGrid.querySelectorAll("button").forEach(x => x.classList.remove("active"));
            b.classList.add("active");
        }));

        const mc = card(`
          <div class="setting-row"><div class="setting-info">
            <div class="setting-name">Podcast Multicam</div>
            <div class="setting-desc">${L("Kim konuşuyorsa görüntüyü ona geçirir. Her konuşmacının kendi mikrofon kanalı ve kamerası olmalı. Hiçbir şey silinmez — diğer kameralar kapatılır (disable), Cmd/Ctrl+Z geri alır.", "Switches the picture to whoever is talking. Each speaker needs their own mic track and camera. Nothing is deleted — other cameras are disabled; Cmd/Ctrl+Z undoes.")}</div>
          </div></div>
          <button class="btn-load-srt" id="mc-scan" style="width:100%; margin-top:4px">${L("1 · Kanalları Tara", "1 · Scan Tracks")}</button>
          <div id="mc-map"></div>
          <div id="multicam-btn"></div>
          <button class="btn-transcribe btn-compact" id="mc-run" style="display:none; margin-top:10px; margin-bottom:6px">${L("2 · Kamerayı Otomatik Kes", "2 · Auto-Switch Cameras")}</button>`);
        sc.appendChild(mc);
        $id("mc-scan").onclick = mcScan;
        $id("mc-run").onclick = mcRun;
    }

    /* ═══ Faz A — quick wins ═══════════════════════════════════════════ */

    // #21 session history: log every timeline-mutating host call
    const HIST_KEYS = {
        rippleDeleteRanges: ["Kesim (tüm kanallar)", "Cut (all tracks)"],
        wsCutRangesSync: ["Kanal hedefli kesim", "Targeted cut"],
        duckAudioRanges: ["Ses kısma/susturma", "Duck/mute audio"],
        wsZoomPro: ["Otomatik zoom", "Auto zoom"],
        applyAutoZoom: ["Otomatik zoom", "Auto zoom"],
        wsMulticamApply: ["Multicam geçişleri", "Multicam switches"],
        createResizedSequence: ["Dikey kopya sekans", "Resized sequence"],
        addNamedMarkers: ["İsimli markerlar", "Named markers"],
        addSilenceMarkers: ["Sessizlik markerları", "Silence markers"],
        insertAudioAtStart: ["Bip kanalı eklendi", "Beep track added"],
        importSRTToProject: ["Altyazı timeline'a gönderildi", "Captions sent to timeline"],
    };
    function histAll() {
        try { return JSON.parse(localStorage.getItem("ws_hist") || "[]"); } catch (e) { return []; }
    }
    function histPush(key) {
        const arr = histAll();
        arr.push({ t: Date.now(), k: key });
        localStorage.setItem("ws_hist", JSON.stringify(arr.slice(-15)));
        renderHist();
    }
    function renderHist() {
        const box = $id("ui2-hist-list"); if (!box) return;
        const arr = histAll().slice().reverse();
        box.innerHTML = arr.length ? arr.map(e => {
            const d = new Date(e.t);
            const hh = String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
            const lab = HIST_KEYS[e.k] ? L(HIST_KEYS[e.k][0], HIST_KEYS[e.k][1]) : e.k;
            return `<div class="ui2-hist-row"><span>${lab}</span><span>${hh}</span></div>`;
        }).join("") : `<div class="setting-hint">${L("Henüz işlem yok.", "Nothing yet.")}</div>`;
    }
    function injectHistory() {
        const sc = document.querySelector("#panel-su-main .setup-scroll");
        if (!sc || $id("ui2-hist-list")) return;
        const d = document.createElement("div");
        d.innerHTML = `
          <div class="setup-section-title" style="margin-top:16px">${L("Son İşlemler", "Recent Actions")}</div>
          <div class="setting-item" style="padding-top:10px; padding-bottom:10px">
            <div id="ui2-hist-list"></div>
            <button class="btn-secondary" id="ui2-hist-clear" style="width:100%; margin-top:8px">${L("Geçmişi temizle", "Clear history")}</button>
            <div class="setting-hint" style="margin-top:6px">${L("Timeline'ı değiştiren işlemlerin kaydı. Geri almak için Premiere'de Cmd/Ctrl+Z.", "A log of timeline-changing actions. Undo with Cmd/Ctrl+Z in Premiere.")}</div>
          </div>`;
        sc.appendChild(d);
        $id("ui2-hist-clear").onclick = () => { localStorage.setItem("ws_hist", "[]"); renderHist(); };
        renderHist();
    }
    function patchEvalHistory() {
        if (typeof window.evalScript !== "function" || window.__evalPatched) return;
        window.__evalPatched = true;
        const _ev = window.evalScript;
        window.evalScript = function (code) {
            try {
                const m = String(code).match(/^(\w+)\(/);
                if (m && HIST_KEYS[m[1]]) histPush(m[1]);
            } catch (e) {}
            return _ev.apply(this, arguments);
        };
    }

    // #13 text-based editing routed through the track-targeted cutter
    async function applyTextCutsPro() {
        if (!_originalSegments) { showToast(L("Önce Transcribe — sonra istemediğin satırları sil", "Transcribe first — then delete the rows you don't want"), "info", 4000); return; }
        const removed = computeDeletedRanges();
        if (!removed.length) { showToast(L("Silinmiş satır yok. Satır sil (✕), sonra tekrar dene", "No deleted rows yet. Delete rows (✕), then retry"), "info", 4500); return; }
        showRangePreview(L("Silinen satırları videodan kes", "Cut deleted rows from the video"), removed, async chosen => {
            setEditStatus(L(`${chosen.length} aralık kesiliyor…`, `Cutting ${chosen.length} range(s)…`), "info");
            await loadHostJSX();
            const sel = await ensureTrackSel();
            const r = await hostCut(chosen, sel);
            if (r && r.success) {
                snapshotOriginalSegments();
                const holes = r.holes ? L(` · ${r.holes} boşluk kapanamadı`, ` · ${r.holes} gap(s) open`) : "";
                setEditStatus(L(`✓ ${r.removed} parça kesildi — video metnini takip etti`, `✓ Removed ${r.removed} item(s) — timeline follows your text`) + holes, r.holes ? "warning" : "success");
                showToast(L("Video metnini takip etti ✂ (geri: Cmd/Ctrl+Z)", "Video follows your text ✂ (undo: Cmd/Ctrl+Z)"), "success", 5000);
            } else setEditStatus((r && r.error) || L("Kesilemedi", "Cut failed"), "error");
        });
    }

    // #4 chapters: save to file + YouTube description template
    function chaptersSaveFile() {
        const t = (($id("chapters-out") || {}).value || "").trim();
        if (!t) { showToast(L("Önce bölümleri oluştur", "Generate chapters first"), "info"); return; }
        try {
            const f = path.join(os.homedir(), "Desktop", `chapters_${Date.now()}.txt`);
            fs.writeFileSync(f, t, "utf8");
            showToast(L("Masaüstüne kaydedildi", "Saved to Desktop"), "success");
            try { revealInFolder(f); } catch (e) {}
        } catch (e) { showToast(e.message, "error", 4000); }
    }
    function chaptersYtTemplate() {
        const t = (($id("chapters-out") || {}).value || "").trim();
        if (!t) { showToast(L("Önce bölümleri oluştur", "Generate chapters first"), "info"); return; }
        copyText(L(
`{Videonun kısa açıklaması buraya}

⏱ Bölümler:
${t}

📌 Beğenmeyi ve abone olmayı unutma!
#etiket1 #etiket2 #etiket3`,
`{Short video description here}

⏱ Chapters:
${t}

📌 Like & subscribe for more!
#tag1 #tag2 #tag3`));
    }
    function injectChapterExtras() {
        const markBtn = $id("chapters-mark");
        if (!markBtn || $id("chapters-save")) return;
        const row = markBtn.parentElement;
        const wrap = document.createElement("div");
        wrap.style.cssText = "display:flex; gap:8px; margin-top:6px; margin-bottom:6px";
        wrap.innerHTML = `
          <button class="btn-secondary" id="chapters-save" style="flex:1">${L("Dosyaya kaydet (.txt)", "Save as .txt")}</button>
          <button class="btn-secondary" id="chapters-yt" style="flex:1">${L("YouTube şablonu kopyala", "Copy YouTube template")}</button>`;
        row.parentNode.insertBefore(wrap, row.nextSibling);
        $id("chapters-save").onclick = chaptersSaveFile;
        $id("chapters-yt").onclick = chaptersYtTemplate;
    }

    // #20 censorship report: timestamped list of what got beeped/muted
    function profanityReport() {
        if (needTranscript()) return;
        const ranges = computeProfanityRanges();
        if (!ranges.length) { showToast(L("Küfür bulunamadı — filtre listesi boş olabilir", "No profanity found — the filter list may be empty"), "info", 4000); return; }
        const lineFor = r => {
            const seg = segments.find(sg => r.start < sg.seqEnd && r.end > sg.seqStart);
            const txt = seg ? String(seg.text || "").replace(/\s+/g, " ").trim().slice(0, 70) : "";
            return `${mmss(r.start)} – ${mmss(r.end)}  ${txt ? "· \"" + txt + "\"" : ""}`;
        };
        const head = L(`SANSÜR RAPORU · ${new Date().toLocaleString()} · ${ranges.length} aralık`,
                       `CENSORSHIP REPORT · ${new Date().toLocaleString()} · ${ranges.length} range(s)`);
        const body = head + "\n" + "-".repeat(48) + "\n" + ranges.map(lineFor).join("\n");
        const out = $id("prof-report-out");
        if (out) { out.value = body; out.style.display = "block"; }
        const btns = $id("prof-report-btns"); if (btns) btns.style.display = "flex";
    }
    function injectProfanityReport() {
        const beepBtn = document.querySelector("#panel-au-work button[onclick^='beepProfanityAction']");
        const item = beepBtn && beepBtn.closest(".setting-item");
        if (!item || $id("prof-report-btn")) return;
        const d = document.createElement("div");
        d.innerHTML = `
          <button class="btn-secondary" id="prof-report-btn" style="width:100%; margin-top:8px">${L("Sansür Raporu — ne, ne zaman biplendi", "Censorship Report — what got beeped, when")}</button>
          <textarea id="prof-report-out" class="settings-textarea" rows="7" readonly style="display:none; margin-top:8px; font-size:11px"></textarea>
          <div id="prof-report-btns" style="display:none; gap:8px; margin-top:6px; margin-bottom:6px">
            <button class="btn-secondary" id="prof-report-copy" style="flex:1">${L("Kopyala", "Copy")}</button>
            <button class="btn-secondary" id="prof-report-save" style="flex:1">${L("Dosyaya kaydet", "Save to file")}</button>
          </div>`;
        item.appendChild(d);
        $id("prof-report-btn").onclick = profanityReport;
        $id("prof-report-copy").onclick = () => copyText(($id("prof-report-out") || {}).value || "");
        $id("prof-report-save").onclick = () => {
            const t = ($id("prof-report-out") || {}).value || "";
            if (!t) return;
            try {
                const f = path.join(os.homedir(), "Desktop", `censorship_report_${Date.now()}.txt`);
                fs.writeFileSync(f, t, "utf8");
                showToast(L("Masaüstüne kaydedildi", "Saved to Desktop"), "success");
                try { revealInFolder(f); } catch (e) {}
            } catch (e) { showToast(e.message, "error", 4000); }
        };
    }

    // #5 one-click error report copy (support burden killer)
    function injectErrorCopy() {
        const header = document.querySelector("#error-panel .error-header");
        if (!header || $id("error-copy-btn")) return;
        const b = document.createElement("button");
        b.id = "error-copy-btn";
        b.className = "error-close";
        b.textContent = "⧉";
        b.title = L("Hata raporunu kopyala", "Copy error report");
        b.style.marginRight = "6px";
        header.insertBefore(b, header.lastElementChild);
        b.onclick = () => {
            const g = id => (($id(id) || {}).textContent || "").trim();
            copyText([
                "Subsper v" + (typeof APP_VERSION !== "undefined" ? APP_VERSION : "?"),
                "OS: " + navigator.platform + " · Engine: " + (settings.engine || "cpp") + " · UI: " + settings.uiLang,
                "What: " + g("error-what"),
                "Why: " + g("error-why-text"),
                "Fix: " + g("error-fix-text"),
            ].join("\n"));
        };
    }

    /* ═══ Faz B — audio & editing engine ═══════════════════════════════ */

    // #1 Constant Power at cut points (positions shifted by earlier cuts)
    async function maybeAddTransitions(chosen, sel) {
        const seg = $id("sil-trans");
        const b = seg && seg.querySelector("button.active");
        if (!b || b.getAttribute("data-v") !== "cp") return;
        if (!sel || !sel.a || !sel.a.length) return;
        const sorted = chosen.slice().sort((x, y) => x.start - y.start);
        let shift = 0;
        const times = sorted.map(r => { const t = r.start - shift; shift += (r.end - r.start); return t; });
        try {
            const r = await evalScript(`wsAddCPTransitions('${JSON.stringify({ times, a: sel.a }).replace(/'/g, "\\'")}')`);
            if (r && r.success) showToast(L(`✓ ${r.applied} kesime Constant Power eklendi`, `✓ Constant Power on ${r.applied} cut(s)`), "success", 4000);
            else showToast(L("Geçiş eklenemedi (deneysel): ", "Transitions failed (experimental): ") + ((r && r.error) || "?"), "warning", 5000);
        } catch (e) {}
    }

    // #11 speed up silences instead of deleting them
    async function speedSilencesPro() {
        setSilenceStatus(L("Hızlandırılacak boşluklar aranıyor…", "Finding gaps to speed up…"), "info");
        showSilenceProgress(true);
        try {
            const { ranges } = await findSilenceRanges();
            const pad = Math.max(0, parseFloat(settings.silencePad) || 0);
            const padded = ranges
                .map(r => ({ start: r.start + pad, end: r.end - pad, dur: +(r.end - r.start - 2 * pad).toFixed(2) }))
                .filter(r => r.dur > 0.35);
            if (!padded.length) { setSilenceStatus(L("Uygun boşluk yok (min 0.35s)", "No suitable gaps (min 0.35s)"), "warning"); return; }
            const sel = await ensureTrackSel();
            showRangePreview(L("Sessizlikleri 4x hızlandır (deneysel)", "Speed silences 4x (experimental)"), padded, async chosen => {
                showSilenceProgress(true);
                try {
                    const payload = JSON.stringify({ ranges: chosen, v: sel ? sel.v : [], a: sel ? sel.a : [], speed: 400 }).replace(/'/g, "\\'");
                    const r = await evalScript(`wsSpeedUpRanges('${payload}')`);
                    if (r && r.success) {
                        const holes = r.holes ? L(` · ${r.holes} boşluk sorunlu`, ` · ${r.holes} gap(s) had issues`) : "";
                        setSilenceStatus(L(`✓ ${r.sped} parça 4x hızlandırıldı — Cmd/Ctrl+Z geri alır`, `✓ Sped up ${r.sped} chunk(s) 4x — undo with Cmd/Ctrl+Z`) + holes, r.holes ? "warning" : "success");
                    } else {
                        setSilenceStatus((r && r.error) || L("Hızlandırılamadı", "Speed-up failed"), "error");
                        if (r && r.diag && r.diag.length) console.log("[Subsper] speed diag:", r.diag);
                    }
                } finally { showSilenceProgress(false); }
            });
        } catch (e) { setSilenceStatus(e.message, "error"); }
        finally { showSilenceProgress(false); }
    }

    // #9 dialogue ducking: lower the music while someone is talking
    function speechRanges() {
        const out = [];
        for (const s of segments) {
            const st = s.seqStart - 0.1, en = s.seqEnd + 0.15;
            const last = out[out.length - 1];
            if (last && st <= last.end + 0.6) last.end = Math.max(last.end, en);
            else out.push({ start: Math.max(0, st), end: en });
        }
        return out.map(r => ({ ...r, dur: +(r.end - r.start).toFixed(2) }));
    }
    window.__speechRanges = speechRanges; // unit-test hook
    async function duckRun() {
        if (needTranscript()) return;
        const tracks = [...document.querySelectorAll(".duck-trk")].filter(c => c.checked).map(c => +c.getAttribute("data-i"));
        if (!tracks.length) { showToast(L("Kısılacak müzik kanalını işaretle", "Tick the music track(s) to duck"), "info", 4000); return; }
        const lvlEl = $id("duck-level");
        const level = Math.max(0, Math.min(1, (lvlEl ? +lvlEl.value : 25) / 100));
        const ranges = speechRanges();
        if (!ranges.length) { showToast(L("Konuşma aralığı yok", "No speech ranges"), "info"); return; }
        const btn = $id("duck-btn"); if (btn) btn.disabled = true;
        try {
            await loadHostJSX();
            const payload = JSON.stringify({ ranges, level, tracks }).replace(/'/g, "\\'");
            const r = await evalScript(`duckAudioRanges('${payload}')`);
            if (r && r.success)
                setAudioStatus(L(`✓ ${tracks.length} müzik kanalı ${ranges.length} konuşma aralığında %${Math.round(level * 100)}'e kısıldı — Cmd/Ctrl+Z geri alır`,
                                 `✓ Ducked ${tracks.length} track(s) to ${Math.round(level * 100)}% across ${ranges.length} speech range(s) — undo with Cmd/Ctrl+Z`), "success");
            else setAudioStatus((r && r.error) || L("Kısılamadı", "Duck failed"), "error");
        } finally { if (btn) btn.disabled = false; }
    }
    async function loadDuckTracks() {
        const wrap = $id("duck-tracks");
        if (!wrap || wrap.querySelector(".duck-trk")) return;
        await loadHostJSX();
        const r = await evalScript("wsListAllTracks()");
        if (!(r && r.success)) return;
        wrap.innerHTML = `<div class="ui2-checks" style="grid-template-columns:1fr 1fr">` +
            r.audio.map(t => `
              <label class="ui2-check" style="opacity:${t.clips ? 1 : .45}">
                <input type="checkbox" class="duck-trk" data-i="${t.i}"${t.i > 0 && t.clips ? " checked" : ""}>
                <span>${t.label}</span></label>`).join("") + `</div>`;
    }
    function injectDucking() {
        const sc = document.querySelector("#panel-au-work .setup-scroll");
        if (!sc || $id("duck-btn")) return;
        const d = card(`
          <div class="setting-row"><div class="setting-info">
            <div class="setting-name">${L("Müzik Kısma (Ducking)", "Music Ducking")}</div>
            <div class="setting-desc">${L("Konuşma varken müziği otomatik kısar, susunca geri açar (keyframe). Önce Transcribe.", "Automatically lowers the music while someone talks, restores it in pauses (keyframes). Transcribe first.")}</div>
          </div></div>
          <div class="ui2-row-label">${L("Kısılacak kanallar (müzik)", "Tracks to duck (music)")}</div>
          <div id="duck-tracks"><div class="setting-hint">${L("Tıklayınca kanallar listelenir — varsayılan: A1 hariç dolu kanallar.", "Click to list tracks — default: every non-empty track except A1.")}</div></div>
          <div class="setting-slider-header" style="margin-top:10px">
            <span>${L("Konuşma sırasında müzik seviyesi", "Music level during speech")}</span><span class="setting-value" id="duck-level-val">25%</span>
          </div>
          <input type="range" class="setting-slider" id="duck-level" min="0" max="70" step="5" value="25">
          <button class="btn-transcribe btn-compact" id="duck-btn" style="margin-top:10px">${L("Müziği Otomatik Kıs", "Auto-Duck Music")}</button>
          <div class="setting-hint" style="margin-top:8px">${L("Podcast/YouTube standardı: konuşurken müzik %20-30 civarı. 0% = tamamen sustur.", "Podcast/YouTube standard: music around 20-30% under speech. 0% = fully silent.")}</div>`);
        sc.appendChild(d);
        $id("duck-btn").onclick = duckRun;
        $id("duck-tracks").addEventListener("click", () => loadDuckTracks().catch(() => {}));
        const lv = $id("duck-level");
        lv.oninput = () => { $id("duck-level-val").textContent = lv.value + "%"; };
    }

    // #12 cut between markers
    function markerPairRanges(marks, mode, domainStart, domainEnd) {
        const pts = marks.map(m => m.start).filter(t => t >= domainStart - 0.01 && t <= domainEnd + 0.01).sort((a, b) => a - b);
        const pairs = [];
        for (let i = 0; i + 1 < pts.length; i += 2) pairs.push({ start: pts[i], end: pts[i + 1] });
        let ranges;
        if (mode === "keep") {
            ranges = [];
            let cur = domainStart;
            for (const p of pairs) {
                if (p.start > cur + 0.05) ranges.push({ start: cur, end: p.start });
                cur = Math.max(cur, p.end);
            }
            if (domainEnd > cur + 0.05) ranges.push({ start: cur, end: domainEnd });
        } else ranges = pairs;
        return ranges.filter(r => r.end - r.start > 0.05)
                     .map(r => ({ ...r, dur: +(r.end - r.start).toFixed(2) }));
    }
    window.__markerPairRanges = markerPairRanges; // unit-test hook
    async function markerCutRun() {
        const btn = $id("markercut-btn"); if (btn) btn.disabled = true;
        try {
            await loadHostJSX();
            const mr = await evalScript("wsListMarkers()");
            if (!(mr && mr.success)) throw new Error((mr && mr.error) || "?");
            if (!mr.markers || mr.markers.length < 2)
                throw new Error(L("En az 2 marker gerekli (timeline'a M ile marker koy)", "Need at least 2 markers (press M on the timeline)"));
            const info = await evalScript("getSequenceInfo()");
            if (!info.success) throw new Error(info.error || "?");
            const segEl = document.querySelector("#mk-mode button.active");
            const mode = segEl ? segEl.getAttribute("data-v") : "cut";
            const ranges = markerPairRanges(mr.markers, mode, info.inTime, info.inTime + info.duration);
            if (!ranges.length) throw new Error(L("Kesilecek aralık çıkmadı", "No ranges to cut"));
            const sel = await ensureTrackSel();
            showRangePreview(mode === "keep" ? L("Marker çiftleri DIŞINI kes", "Cut OUTSIDE marker pairs")
                                             : L("Marker çiftleri ARASINI kes", "Cut BETWEEN marker pairs"), ranges, async chosen => {
                const r = await hostCut(chosen, sel);
                if (r && r.success && r.removed > 0) {
                    const holes = r.holes ? L(` · ${r.holes} boşluk kapanamadı`, ` · ${r.holes} gap(s) open`) : "";
                    showToast(L(`✓ ${r.removed} parça kesildi — Cmd/Ctrl+Z geri alır`, `✓ Cut ${r.removed} item(s) — undo with Cmd/Ctrl+Z`) + holes, r.holes ? "warning" : "success", 5000);
                } else showToast((r && r.error) || L("Kesilemedi", "Cut failed"), "error", 5000);
            });
        } catch (e) { showToast(e.message, "error", 5000); }
        finally { if (btn) btn.disabled = false; }
    }
    function injectMarkerCut() {
        const sc = document.querySelector("#panel-ed-work .setup-scroll");
        if (!sc || $id("markercut-btn")) return;
        const d = card(`
          <div class="setting-row"><div class="setting-info">
            <div class="setting-name">${L("Marker ile Kes", "Cut by Markers")}</div>
            <div class="setting-desc">${L("Timeline'a M ile marker koy; çiftler (1-2, 3-4…) aralık sayılır. Arasını kes ya da sadece arasını tut.", "Drop markers with M; pairs (1-2, 3-4…) form ranges. Cut between them, or keep only what's between.")}</div>
          </div></div>
          <div class="ui2-row-label">${L("Mod", "Mode")}</div>
          ${segControl("mk-mode", [["cut", L("Arasını KES", "CUT between")], ["keep", L("Arasını TUT", "KEEP between")]])}
          <button class="btn-transcribe btn-compact" id="markercut-btn" style="margin-top:10px">${L("Markerlara Göre Kes", "Cut by Markers")}</button>
          <div class="setting-hint" style="margin-top:8px">${L("Kanal seçimi Sessizlik sayfasındaki listeyle ortak; onaylı liste gösterilir.", "Track selection is shared with the Silence page; you review the list first.")}</div>`);
        sc.appendChild(d);
        wireSeg("mk-mode");
        $id("markercut-btn").onclick = markerCutRun;
    }

    // #14 filler-word cutting with word-precision + review list
    async function fillerCutPro() {
        if (needTranscript()) return;
        const fl = (typeof getFillerList === "function" ? getFillerList() : []).filter(w => !w.includes(" "));
        const fset = new Set(fl.map(w => w.toLowerCase()));
        if (!fset.size) { showToast(L("Dolgu listesi boş (Altyazı ayarları → dolgu kelimeleri)", "Filler list is empty (Subtitle settings → fillers)"), "info", 4500); return; }
        const ranges = [];
        for (const seg of segments) {
            for (const w of (seg.words || [])) {
                if (w.start == null || w.end == null) continue;
                const clean = (w.word || "").toLowerCase().replace(/[.,!?;:"'()\[\]{}…*-]/g, "");
                if (!clean || !fset.has(clean)) continue;
                const off = seg.seqStart - seg.start;
                ranges.push({ start: Math.max(0, off + w.start - 0.03), end: off + w.end + 0.03 });
            }
        }
        if (!ranges.length) { showToast(L("Dolgu kelimesi bulunamadı ✓", "No filler words found ✓"), "success", 3500); return; }
        ranges.sort((a, b) => a.start - b.start);
        const merged = [];
        for (const r of ranges) {
            const last = merged[merged.length - 1];
            if (last && r.start <= last.end + 0.1) last.end = Math.max(last.end, r.end);
            else merged.push({ ...r });
        }
        const list = merged.map(r => ({ ...r, dur: +(r.end - r.start).toFixed(2) }));
        const sel = await ensureTrackSel();
        showRangePreview(L(`Dolgu kelimelerini kes (${list.length})`, `Cut filler words (${list.length})`), list, async chosen => {
            await loadHostJSX();
            const r = await hostCut(chosen, sel);
            if (r && r.success && r.removed > 0) {
                const holes = r.holes ? L(` · ${r.holes} boşluk kapanamadı`, ` · ${r.holes} gap(s) open`) : "";
                showToast(L(`✓ ${r.removed} dolgu kesildi — metni de temizlemek için 🧹 menüsünü kullan`, `✓ Cut ${r.removed} filler(s) — use the 🧹 menu to clean the text too`) + holes, r.holes ? "warning" : "success", 6000);
            } else showToast((r && r.error) || L("Kesilemedi", "Cut failed"), "error", 5000);
        });
    }

    function fazB() {
        if (DESK) return;   // ducking/marker-cut/filler-pro drive the Premiere timeline;
                            // desktop keeps main.js + desktop-app.js file-based flows
        injectDucking();
        injectMarkerCut();
        window.cutFillerWords = fillerCutPro;   // word-precision + preview + targeted tracks
    }

    /* ═══ Faz C — analytics, packs, speakers, social ═══════════════════ */

    // #8 speech pace: per-30s WPM bars + too-fast markers
    function paceWindows() {
        const first = segments[0].seqStart, last = segments[segments.length - 1].seqEnd;
        const out = [];
        for (let t = first; t < last; t += 30) {
            let words = 0;
            for (const sg of segments) {
                if (sg.seqEnd <= t || sg.seqStart >= t + 30) continue;
                const ov = Math.min(sg.seqEnd, t + 30) - Math.max(sg.seqStart, t);
                const frac = ov / Math.max(0.1, sg.seqEnd - sg.seqStart);
                words += tokens(sg.text).length * frac;
            }
            out.push({ t, wpm: Math.round(words * 2) });
        }
        return out;
    }
    window.__paceWindows = paceWindows; // unit-test hook
    async function paceRun() {
        if (needTranscript()) return;
        const win = paceWindows();
        const max = Math.max(60, ...win.map(w => w.wpm));
        const box = $id("pace-out");
        if (box) {
            box.style.display = "block";
            box.innerHTML = win.map(w => `
              <div class="ui2-pace-row">
                <span>${mmss(w.t)}</span>
                <i style="width:${Math.round(w.wpm / max * 100)}%; background:${w.wpm > 180 ? "var(--red)" : w.wpm > 150 ? "var(--orange)" : "var(--accent)"}"></i>
                <b>${w.wpm}</b>
              </div>`).join("") +
              `<div class="setting-hint" style="margin-top:6px">${L("Kelime/dakika. 130-160 rahat; 180+ çok hızlı.", "Words per minute. 130-160 is comfy; 180+ is rushed.")}</div>`;
        }
        const fast = win.filter(w => w.wpm > 180);
        if (fast.length) {
            const r = await namedMarkers(fast.map(w => ({ start: w.t, name: L("Çok hızlı ", "Too fast ") + w.wpm + " wpm", color: 1 })));
            if (r && r.success) showToast(L(`${r.added} 'çok hızlı' marker'ı eklendi`, `${r.added} 'too fast' marker(s) added`), "info", 4000);
        }
    }
    function injectPace() {
        const sc = document.querySelector("#panel-ed-work .setup-scroll");
        if (!sc || $id("pace-btn")) return;
        const d = card(`
          <div class="setting-row"><div class="setting-info">
            <div class="setting-name">${L("Konuşma Analizi", "Speech Pace")}</div>
            <div class="setting-desc">${DESK
                ? L("30 saniyelik dilimlerde konuşma hızı grafiği; 180+ wpm bölgeleri kırmızı görünür. Önce Transcribe.", "WPM chart in 30s slices; 180+ wpm zones show in red. Transcribe first.")
                : L("30 saniyelik dilimlerde konuşma hızı grafiği; 180+ wpm bölgelerine marker koyar. Önce Transcribe.", "WPM chart in 30s slices; drops markers where you rush past 180 wpm. Transcribe first.")}</div>
          </div></div>
          <button class="btn-transcribe btn-compact" id="pace-btn" style="margin-top:4px">${L("Hızı Analiz Et", "Analyze Pace")}</button>
          <div id="pace-out" style="display:none; margin-top:8px; margin-bottom:6px"></div>`);
        sc.appendChild(d);
        $id("pace-btn").onclick = paceRun;
    }

    // #15 one-tap template packs (silence rhythm + caption style + splitting)
    const PACKS = [
        { name: ["Podcast", "Podcast"], rhythm: "calm", thr: -40, style: "Alt Bant", cpl: 42 },
        { name: ["Oyun / Yayın", "Gaming"], rhythm: "energetic", thr: -30, style: "Neon Yeşil", cpl: 32 },
        { name: ["Eğitim", "Education"], rhythm: "measured", thr: -35, style: "Klasik Beyaz", cpl: 38 },
        { name: ["Vlog / Sosyal", "Vlog / Social"], rhythm: "paced", thr: -32, style: "Kalın Sosyal", cpl: 30 },
    ];
    function applyPack(pk) {
        applyRhythm(pk.rhythm);
        onSettingChange("silenceThreshold", pk.thr);
        onSettingChange("maxCharsPerLine", pk.cpl);
        onSettingChange("autoSplit", true);
        const g = GALLERY.find(x => x.name === pk.style);
        if (g) applyGalleryStyle(g.s);
        showToast(L(`✓ "${pk.name[0]}" paketi uygulandı — kesim ritmi + altyazı stili ayarlandı`,
                    `✓ "${pk.name[1]}" pack applied — cut rhythm + caption style set`), "success", 4500);
    }
    function injectPacks() {
        const sc = document.querySelector("#panel-su-main .setup-scroll");
        if (!sc || $id("ui2-packs")) return;
        const d = document.createElement("div");
        d.innerHTML = `
          <div class="setup-section-title" style="margin-top:16px">${L("Şablon Paketleri", "Template Packs")}</div>
          <div class="setting-item" id="ui2-packs" style="padding-top:12px; padding-bottom:12px">
            <div class="setting-desc" style="margin-bottom:8px">${L("Tek dokunuşla içerik türüne göre kesim ritmi, eşik ve altyazı stilini ayarlar.", "One tap sets cut rhythm, threshold and caption style for your content type.")}</div>
            <div class="ui2-checks">${PACKS.map((pk, i) =>
                `<button class="btn-load-srt ui2-pack" data-i="${i}" style="margin:0">${L(pk.name[0], pk.name[1])}</button>`).join("")}</div>
          </div>`;
        sc.appendChild(d);
        d.querySelectorAll(".ui2-pack").forEach(b =>
            b.addEventListener("click", () => applyPack(PACKS[+b.getAttribute("data-i")])));
    }

    // #18 speaker → caption color mapping (diarization output)
    function injectSpeakerColors() {
        const chips = $id("style-chips");
        if (!chips || $id("ui2-spk-wrap")) return;
        const d = document.createElement("div");
        d.id = "ui2-spk-wrap";
        d.style.marginTop = "10px";
        d.innerHTML = `<button class="btn-secondary" id="ui2-spk-btn" style="width:100%">${L("Konuşmacı Renkleri (diarization)", "Speaker Colors (diarization)")}</button><div id="ui2-spk-list"></div>`;
        const galBtn = $id("ui2-gal-btn");
        (galBtn || chips).parentNode.insertBefore(d, (galBtn || chips).nextSibling);
        $id("ui2-spk-btn").onclick = () => {
            const list = $id("ui2-spk-list");
            const spks = [...new Set(segments.map(sg => sg.speaker).filter(Boolean))];
            if (!spks.length) {
                list.innerHTML = `<div class="setting-hint" style="margin-top:6px">${L("Konuşmacı verisi yok — WhisperX Pro motoru + Speaker Labels ile transcribe et.", "No speaker data — transcribe with the WhisperX Pro engine + Speaker Labels.")}</div>`;
                return;
            }
            const saved = settings.speakerColors || {};
            list.innerHTML = spks.map((sp, i) => `
              <div class="setting-row" style="min-height:34px; padding:5px 0">
                <div class="setting-info"><div class="setting-name" style="font-weight:500">${sp}</div></div>
                <input type="color" class="ui2-spk-col" data-sp="${sp}" value="#${saved[sp] || SPEAKER_COLORS[i % SPEAKER_COLORS.length]}" style="width:44px; height:26px">
              </div>`).join("") +
              `<div class="setting-hint">${L(".ass dışa aktarımda her konuşmacı kendi renginde yazılır.", "Each speaker gets their own color in .ass exports.")}</div>`;
            list.querySelectorAll(".ui2-spk-col").forEach(inp => inp.addEventListener("change", () => {
                const map = settings.speakerColors || {};
                map[inp.getAttribute("data-sp")] = inp.value.slice(1).toUpperCase();
                settings.speakerColors = map; saveSettings();
                const order = [...new Set(segments.map(sg => sg.speaker).filter(Boolean))];
                order.forEach((sp, i) => { if (map[sp]) SPEAKER_COLORS[i % SPEAKER_COLORS.length] = map[sp]; });
                showToast(L("Konuşmacı rengi kaydedildi", "Speaker color saved"), "success", 2000);
            }));
        };
    }

    // #19 one-click social pack: viral moments → markers + per-clip SRTs + 9:16 copy
    function srtFor(range) {
        const inside = segments.filter(sg => sg.seqEnd > range.start && sg.seqStart < range.end);
        const fmt = t => {
            t = Math.max(0, t);
            const h = String(Math.floor(t / 3600)).padStart(2, "0"),
                  m = String(Math.floor((t % 3600) / 60)).padStart(2, "0"),
                  x = String(Math.floor(t % 60)).padStart(2, "0"),
                  ms = String(Math.round((t % 1) * 1000)).padStart(3, "0");
            return `${h}:${m}:${x},${ms}`;
        };
        return inside.map((sg, i) =>
            `${i + 1}
${fmt(sg.seqStart - range.start)} --> ${fmt(Math.min(sg.seqEnd, range.end) - range.start)}
${(sg.text || "").trim()}
`).join("\n");
    }
    window.__srtFor = srtFor; // unit-test hook
    async function socialPack() {
        if (needTranscript()) return;
        const btn = $id("social-btn"); if (btn) btn.disabled = true;
        try {
            setStatus(L("Viral anlar aranıyor…", "Finding viral moments…"), "info");
            let ranges = [], via = L("cihaz içi", "on-device");
            if (aiAvailable()) {
                try {
                    const t = await aiComplete(`Pick the top 3 most engaging 15-60s segments for short-form clips from this transcript. Output ONLY lines "MM:SS-MM:SS title".

Transcript:
${_plainTranscript()}`);
                    ranges = parseAiClipRanges(t); via = "AI";
                } catch (e) {}
            }
            if (!ranges.length) ranges = heuristicViral(segments);
            if (!ranges.length) { showToast(L("Aday an bulunamadı", "No candidate moments"), "info"); return; }
            await namedMarkers(ranges.map((c, i) => ({ start: c.start, name: "Social " + (i + 1), comment: mmss(c.start) + "→" + mmss(c.end), color: 2 })));
            const dir = path.join(os.homedir(), "Desktop", "subsper_social");
            try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
            ranges.forEach((rg, i) => {
                try { fs.writeFileSync(path.join(dir, `clip${i + 1}_${mmss(rg.start).replace(/:/g, "-")}.srt`), srtFor(rg), "utf8"); } catch (e) {}
            });
            let rzNote = "";
            if (DESK) {
                rzNote = L(" · 9:16 klip için Export menüsündeki 'Dikey klip'i kullan", " · use 'Vertical clip' in the Export menu for 9:16");
            } else {
                setStatus(L("Dikey kopya sekans oluşturuluyor…", "Creating vertical copy…"), "info");
                await loadHostJSX();
                const rz = await evalScript(`createResizedSequence('${JSON.stringify({ w: 1080, h: 1920, label: "9:16 Social", anchor: 4 }).replace(/'/g, "\\'")}')`);
                rzNote = rz && rz.success ? L(` · dikey sekans: "${rz.name}"`, ` · vertical: "${rz.name}"`) : "";
            }
            setStatus(DESK
                ? L(`✓ Sosyal Paket (${via}): ${ranges.length} klip SRT'si Masaüstü/subsper_social içinde`, `✓ Social Pack (${via}): ${ranges.length} clip SRT(s) in Desktop/subsper_social`) + rzNote
                : L(`✓ Sosyal Paket (${via}): ${ranges.length} an işaretlendi, SRT'ler Masaüstü/subsper_social`, `✓ Social Pack (${via}): ${ranges.length} moments marked, SRTs in Desktop/subsper_social`) + rzNote, "success");
        } catch (e) { setStatus(e.message, "error"); showToast(e.message, "error", 5000); }
        finally { if (btn) btn.disabled = false; }
    }
    function injectSocial() {
        const sc = document.querySelector("#panel-ed-work .setup-scroll");
        if (!sc || $id("social-btn")) return;
        const d = card(`
          <div class="setting-row"><div class="setting-info">
            <div class="setting-name">${L("Sosyal Paket", "Social Pack")}</div>
            <div class="setting-desc">${DESK
                ? L("Tek tık: en güçlü 3 anı bulur → her klip için ayrı SRT üretir (Masaüstü/subsper_social). Önce Transcribe.", "One click: finds the 3 strongest moments → writes a per-clip SRT (Desktop/subsper_social). Transcribe first.")
                : L("Tek tık: en güçlü 3 anı bulur → marker koyar → her klip için ayrı SRT üretir → 9:16 dikey kopya sekans açar. Önce Transcribe.", "One click: finds the 3 strongest moments → drops markers → writes a per-clip SRT → opens a 9:16 vertical copy. Transcribe first.")}</div>
          </div></div>
          <button class="btn-transcribe btn-compact" id="social-btn" style="margin-top:4px; margin-bottom:6px">${L("Sosyal Paketi Üret", "Build Social Pack")}</button>`);
        sc.appendChild(d);
        $id("social-btn").onclick = socialPack;
    }

    function fazC() {
        injectPace();
        injectPacks();
        injectSpeakerColors();
        injectSocial();
    }

    // Subtitle position (X/Y sliders in the style area): when pinned, every
    // dialogue line gets {\an5\pos(x,y)} so .ass exports AND burned-in video
    // place the text exactly there; "auto" keeps the style's own alignment
    function subPosPro() {
        const _s2a = window.segmentsToASS;
        if (typeof _s2a === "function" && !window.__s2aPosPatched) {
            window.__s2aPosPatched = true;
            window.segmentsToASS = function () {
                let out = _s2a.apply(this, arguments);
                const pr = PR();
                if (pr.w !== 1920 || pr.h !== 1080)
                    out = out.replace("PlayResX: 1920", "PlayResX: " + pr.w)
                             .replace("PlayResY: 1080", "PlayResY: " + pr.h);
                if (settings.subPosX != null && settings.subPosY != null) {
                    const px = Math.round(settings.subPosX / 100 * pr.w);
                    const py = Math.round(settings.subPosY / 100 * pr.h);
                    out = out.replace(/^(Dialogue: (?:[^,]*,){9})/gm, `$1{\\an5\\pos(${px},${py})}`);
                }
                return out;
            };
        }
        const chips = $id("style-chips");
        if (!chips || $id("ui2-pos-wrap")) return;
        const d = document.createElement("div");
        d.id = "ui2-pos-wrap";
        d.style.marginTop = "10px";
        const av = v => v != null ? v + "%" : L("oto", "auto");
        d.innerHTML = `
          <div class="setting-slider-header"><span>${L("Altyazı konumu — X (yatay)", "Subtitle position — X (horizontal)")}</span><span class="setting-value" id="subposx-val">${av(settings.subPosX)}</span></div>
          <input type="range" class="setting-slider" id="subposx" min="0" max="100" step="1" value="${settings.subPosX != null ? settings.subPosX : 50}">
          <div class="setting-slider-header" style="margin-top:6px"><span>${L("Altyazı konumu — Y (dikey)", "Subtitle position — Y (vertical)")}</span><span class="setting-value" id="subposy-val">${av(settings.subPosY)}</span></div>
          <input type="range" class="setting-slider" id="subposy" min="0" max="100" step="1" value="${settings.subPosY != null ? settings.subPosY : 90}">
          <div class="setting-slider-header" style="margin-top:6px"><span>${L("Genişlik — satır kutusu (maks)", "Width — line box (max)")}</span><span class="setting-value" id="submaxw-val">${av(settings.subMaxW)}</span></div>
          <input type="range" class="setting-slider" id="submaxw" min="20" max="100" step="1" value="${settings.subMaxW != null ? settings.subMaxW : 94}">
          <button class="btn-secondary" id="subpos-reset" style="width:100%; margin-top:6px">${L("Konum ve genişliği sıfırla (otomatik)", "Reset position & width (auto)")}</button>
          <div class="setting-hint" style="margin-top:6px">${L("Kaydırınca altyazı tam bu noktaya sabitlenir — önizlemede, .ass'ta ve videoya gömmede aynı yer. Otomatikte stilin hizalaması geçerli.", "Dragging pins the subtitle to this exact point — same spot in the preview, .ass and burned video. Auto follows the style's alignment.")}</div>`;
        const spk = $id("ui2-spk-wrap"), gal = $id("ui2-gal-btn");
        const anchor = spk || gal || chips;
        anchor.parentNode.insertBefore(d, anchor.nextSibling);
        const wire = (id, key) => $id(id).addEventListener("input", () => {
            // pin BOTH axes on first touch so \pos always has full coordinates
            if (settings.subPosX == null) onSettingChange("subPosX", +$id("subposx").value);
            if (settings.subPosY == null) onSettingChange("subPosY", +$id("subposy").value);
            onSettingChange(key, +$id(id).value);
            $id("subposx-val").textContent = settings.subPosX + "%";
            $id("subposy-val").textContent = settings.subPosY + "%";
            updateStylePreview();
        });
        wire("subposx", "subPosX");
        wire("subposy", "subPosY");
        // width is independent of the pin — one axis, no coupling
        $id("submaxw").addEventListener("input", () => {
            onSettingChange("subMaxW", +$id("submaxw").value);
            $id("submaxw-val").textContent = settings.subMaxW + "%";
            updateStylePreview();
        });
        $id("subpos-reset").onclick = () => {
            onSettingChange("subPosX", null); onSettingChange("subPosY", null);
            onSettingChange("subMaxW", null);
            $id("subposx").value = 50; $id("subposy").value = 90; $id("submaxw").value = 94;
            $id("subposx-val").textContent = av(null);
            $id("subposy-val").textContent = av(null);
            $id("submaxw-val").textContent = av(null);
            updateStylePreview();
        };

        // preview box becomes a video-ratio mock-up and the sample line
        // follows the pinned X/Y (or the style's alignment when auto)
        if (!window.__posPrevPatched) {
            window.__posPrevPatched = true;
            const _usp = window.updateStylePreview;
            window.updateStylePreview = function () {
                const r = _usp.apply(this, arguments);
                try {
                    const box = $id("style-preview"), txt = $id("style-preview-text");
                    if (box && txt) {
                        box.style.position = "relative";
                        box.style.overflow = "hidden";
                        box.style.aspectRatio = String(window.__videoAR || (16 / 9));
                        box.style.height = "auto";
                        const wPct = settings.subMaxW != null ? settings.subMaxW : null;
                        if (settings.subPosX != null && settings.subPosY != null) {
                            txt.style.position = "absolute";
                            txt.style.left = settings.subPosX + "%";
                            txt.style.top = settings.subPosY + "%";
                            txt.style.transform = "translate(-50%,-50%)";
                            txt.style.maxWidth = Math.min(wPct != null ? wPct : 94, 94) + "%";
                        } else {
                            txt.style.position = ""; txt.style.left = ""; txt.style.top = "";
                            txt.style.transform = "";
                            txt.style.maxWidth = wPct != null ? wPct + "%" : "";
                        }
                        // dashed safe-box guides (Premiere-style) while width is pinned
                        let g = $id("ui2-pos-guides");
                        if (!g) {
                            g = document.createElement("div");
                            g.id = "ui2-pos-guides";
                            g.style.cssText = "position:absolute;top:4%;bottom:4%;pointer-events:none;" +
                                "border-left:1px dashed rgba(120,170,255,.65);border-right:1px dashed rgba(120,170,255,.65)";
                            box.appendChild(g);
                        }
                        if (wPct != null) {
                            g.style.display = "block";
                            g.style.left = ((100 - wPct) / 2) + "%";
                            g.style.width = wPct + "%";
                        } else g.style.display = "none";
                    }
                } catch (e) {}
                return r;
            };
        }
        // drag (or click) INSIDE the mock-up to place the subtitle
        const prevBox = $id("style-preview");
        if (prevBox && !prevBox.__posWired) {
            prevBox.__posWired = true;
            prevBox.style.cursor = "crosshair";
            prevBox.title = L("Sürükleyerek altyazıyı konumlandır", "Drag to place the subtitle");
            const setFromEvent = ev => {
                const r = prevBox.getBoundingClientRect();
                if (!r.width || !r.height) return;   // panel hidden → no geometry
                const x = Math.round(Math.max(0, Math.min(100, (ev.clientX - r.left) / r.width * 100)));
                const y = Math.round(Math.max(0, Math.min(100, (ev.clientY - r.top) / r.height * 100)));
                onSettingChange("subPosX", x); onSettingChange("subPosY", y);
                const sx = $id("subposx"), sy = $id("subposy");
                if (sx) { sx.value = x; $id("subposx-val").textContent = x + "%"; }
                if (sy) { sy.value = y; $id("subposy-val").textContent = y + "%"; }
                updateStylePreview();
            };
            prevBox.addEventListener("mousedown", ev => {
                ev.preventDefault();
                setFromEvent(ev);
                const mm = e2 => setFromEvent(e2);
                const mu = () => {
                    document.removeEventListener("mousemove", mm);
                    document.removeEventListener("mouseup", mu);
                };
                document.addEventListener("mousemove", mm);
                document.addEventListener("mouseup", mu);
            });
        }
        updateStylePreview();   // apply the aspect/position right away
    }

    // Word-list mirrors: edit the same profanity/filler lists right on the
    // Beep and Filler tool pages; two-way live sync with the Subtitle
    // settings textareas (single source of truth = settings via onSettingChange)
    function bindMirror(orig, mirror, key) {
        if (!mirror) return;
        mirror.value = (orig && orig.value) || settings[key] || "";
        mirror.addEventListener("input", () => {
            if (orig) orig.value = mirror.value;
            onSettingChange(key, mirror.value);
        });
        if (orig) orig.addEventListener("input", () => { mirror.value = orig.value; });
    }
    function injectListMirrors() {
        const beepBtn = document.querySelector("#panel-au-work button[onclick^='beepProfanityAction']");
        const beepItem = beepBtn && beepBtn.closest(".setting-item");
        if (beepItem && !$id("beep-words-mirror")) {
            const d = document.createElement("div");
            d.innerHTML = `
              <div class="setting-slider-header" style="margin-top:10px"><span>${L("Sansür listesi — ek kelimeler", "Censor list — extra words")}</span></div>
              <textarea id="beep-words-mirror" class="settings-textarea" rows="2" placeholder="${L("kelime1, kelime2", "word1, word2")}"></textarea>
              <div class="setting-hint">${L("Yerleşik listenin üstüne eklenir. Altyazı ayarlarındaki listeyle aynıdır — biri değişince ikisi de güncellenir.", "Added on top of the built-in list. Same list as in Subtitle settings — editing either updates both.")}</div>`;
            beepItem.appendChild(d);
            bindMirror($id("set-profanity"), $id("beep-words-mirror"), "profanityList");
        }
        const fillBtn = DESK
            ? document.querySelector("#panel-ed-work button[onclick^='cutFillerWordsDesktop']")
            : $id("filler-cut-btn");
        const fillItem = fillBtn && fillBtn.closest(".setting-item");
        if (fillItem && !$id("filler-words-mirror")) {
            const d = document.createElement("div");
            d.innerHTML = `
              <label class="ui2-check" style="margin-top:10px"><input type="checkbox" id="filler-on-mirror"><span>${L("Yerleşik liste (ee, ıı, şey, um…)", "Built-in list (um, uh, like…)")}</span></label>
              <div class="setting-slider-header" style="margin-top:8px"><span>${L("Ek dolgu kelimeleri", "Extra filler words")}</span></div>
              <textarea id="filler-words-mirror" class="settings-textarea" rows="2" placeholder="açıkçası, aslında, bir nevi"></textarea>
              <div class="setting-hint">${L("Altyazı ayarlarındaki listeyle aynıdır — biri değişince ikisi de güncellenir.", "Same list as in Subtitle settings — editing either updates both.")}</div>`;
            fillItem.appendChild(d);
            bindMirror($id("set-fillers"), $id("filler-words-mirror"), "fillerWords");
            const mo = $id("filler-on-mirror"), oo = $id("set-filleron");
            if (mo) {
                mo.checked = settings.fillerOn !== false;
                mo.addEventListener("change", () => {
                    if (oo) oo.checked = mo.checked;
                    onSettingChange("fillerOn", mo.checked);
                });
                if (oo) oo.addEventListener("change", () => { mo.checked = oo.checked; });
            }
        }
    }

    /* ═══ Faz D — licensing · stock B-roll · batch ═════════════════════ */

    // #D1 license + 7-day trial. Everything stays invisible while main.js's
    // LICENSING_ENABLED is false, so nothing changes until we actually sell.
    const TRIAL_DAYS = 7;
    const LICENSING = (typeof LICENSING_ENABLED !== "undefined") && LICENSING_ENABLED === true;
    function trialStart() {
        let s = +(localStorage.getItem("ws_trial_start") || 0);
        if (!s || s > Date.now()) { s = Date.now(); localStorage.setItem("ws_trial_start", String(s)); }
        return s;
    }
    function savedLicense() {
        try { return JSON.parse(localStorage.getItem("ws_license") || "null"); } catch (e) { return null; }
    }
    function licenseState() {
        const lic = savedLicense();
        if (lic && lic.key && lic.ok) return { status: "licensed", key: lic.key, daysLeft: null };
        const used = Math.floor((Date.now() - trialStart()) / 86400000);
        const daysLeft = Math.max(0, TRIAL_DAYS - used);
        return { status: daysLeft > 0 ? "trial" : "expired", key: null, daysLeft };
    }
    window.__licenseState = licenseState; // unit-test hook
    // Blocks the heavy actions once the trial is over (no-op until we sell)
    function licenseGate() {
        if (!LICENSING) return true;
        const st = licenseState();
        if (st.status !== "expired") return true;
        showToast(L("Deneme süresi doldu — Ayarlar'dan lisans anahtarını gir",
                    "Trial has ended — enter your license key in Settings"), "warning", 6000);
        return false;
    }
    window.__licenseGate = licenseGate;

    async function activateLicense(key) {
        key = String(key || "").trim();
        if (!key) { showToast(L("Anahtar boş", "Key is empty"), "info"); return; }
        const btn = $id("lic-activate"); if (btn) btn.disabled = true;
        try {
            let r = null;
            if (typeof verifyLicenseKey === "function") r = await verifyLicenseKey(key);
            const ok = !!(r && r.success);
            localStorage.setItem("ws_license", JSON.stringify({
                key, ok, at: Date.now(), email: (r && r.purchase && r.purchase.email) || "",
            }));
            renderLicense();
            showToast(ok ? L("✓ Lisans etkinleştirildi — teşekkürler!", "✓ License activated — thank you!")
                         : L("Anahtar doğrulanamadı — kontrol edip tekrar dene", "Key could not be verified — check it and retry"),
                      ok ? "success" : "error", 5000);
        } catch (e) {
            showToast(L("Doğrulama başarısız (internet?): ", "Verification failed (offline?): ") + e.message, "error", 5000);
        } finally { if (btn) btn.disabled = false; }
    }
    function renderLicense() {
        const box = $id("lic-state"); if (!box) return;
        const st = licenseState();
        const txt = st.status === "licensed"
            ? L("✓ Lisanslı — tüm özellikler açık", "✓ Licensed — everything unlocked")
            : st.status === "trial"
                ? L(`Deneme sürümü — ${st.daysLeft} gün kaldı`, `Trial — ${st.daysLeft} day(s) left`)
                : L("Deneme süresi doldu", "Trial has ended");
        box.textContent = txt;
        box.style.color = st.status === "licensed" ? "var(--green, #7bb389)"
                        : st.status === "expired" ? "var(--red, #c4726a)" : "var(--text2)";
        const inp = $id("lic-key");
        if (inp && st.key && !inp.value) inp.value = st.key;
    }
    function injectLicense() {
        if (!LICENSING) return;                 // hidden until we sell
        const sc = document.querySelector("#panel-su-main .setup-scroll");
        if (!sc || $id("lic-key")) return;
        const d = document.createElement("div");
        d.innerHTML = `
          <div class="setup-section-title" style="margin-top:16px">${L("Lisans", "License")}</div>
          <div class="setting-item" style="padding-top:12px; padding-bottom:12px">
            <div id="lic-state" class="setting-name" style="margin-bottom:8px"></div>
            <input type="text" id="lic-key" class="settings-textarea" style="height:32px; font-size:13px; padding:0 8px"
                   placeholder="XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX">
            <button class="btn-transcribe btn-compact" id="lic-activate" style="margin-top:8px">${L("Etkinleştir", "Activate")}</button>
            <div class="setting-hint" style="margin-top:6px">${L("Satın alma e-postandaki anahtarı yapıştır. Doğrulama tek seferlik ve internet ister; sonrasında çevrimdışı çalışır.", "Paste the key from your purchase email. Verification is one-time and needs internet; everything works offline afterwards.")}</div>
          </div>`;
        sc.appendChild(d);
        $id("lic-activate").onclick = () => activateLicense(($id("lic-key") || {}).value);
        renderLicense();
    }

    // #D2 stock B-roll (Pexels) — strictly opt-in: needs a free API key and is
    // the only feature that ever touches the network for media.
    async function pexelsSearch(query, per) {
        const key = (settings.pexelsKey || "").trim();
        if (!key) throw new Error(L("Önce Ayarlar'dan Pexels anahtarını gir", "Add your Pexels key in Settings first"));
        const r = await fetch("https://api.pexels.com/videos/search?per_page=" + (per || 1) +
                              "&query=" + encodeURIComponent(query), { headers: { Authorization: key } });
        if (!r.ok) throw new Error("Pexels HTTP " + r.status);
        const j = await r.json();
        return (j.videos || []).map(v => {
            const files = (v.video_files || []).slice().sort((a, b) => (b.width || 0) - (a.width || 0));
            const hd = files.find(f => (f.width || 0) <= 1920) || files[0];
            return hd ? { url: hd.link, w: hd.width, h: hd.height, id: v.id } : null;
        }).filter(Boolean);
    }
    async function brollDownload() {
        const lines = (($id("broll-out") || {}).value || "").trim().split(/\n/).filter(Boolean);
        if (!lines.length) { showToast(L("Önce önerileri oluştur", "Generate ideas first"), "info"); return; }
        const btn = $id("broll-dl"); if (btn) btn.disabled = true;
        const dir = path.join(os.homedir(), "Desktop", "subsper_broll");
        try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
        let done = 0, failed = 0;
        try {
            for (let i = 0; i < Math.min(lines.length, 8); i++) {
                // "MM:SS — what to show" → the query is the part after the dash
                const q = lines[i].replace(/^\s*(?:\d{1,2}:)?\d{1,2}:\d{2}\s*[—–-]?\s*/, "").trim().slice(0, 60);
                if (!q) continue;
                setStatus(L(`Stok aranıyor ${i + 1}/${lines.length}: `, `Searching stock ${i + 1}/${lines.length}: `) + q, "info");
                try {
                    const hits = await pexelsSearch(q, 1);
                    if (!hits.length) { failed++; continue; }
                    const res = await fetch(hits[0].url);
                    const buf = new Uint8Array(await res.arrayBuffer());
                    fs.writeFileSync(path.join(dir, `broll${i + 1}_${q.replace(/[^\w]+/g, "_").slice(0, 30)}.mp4`), buf);
                    done++;
                } catch (e) { failed++; }
            }
            setStatus(L(`✓ ${done} stok klip indirildi → Masaüstü/subsper_broll`, `✓ Downloaded ${done} stock clip(s) → Desktop/subsper_broll`) +
                      (failed ? L(` · ${failed} bulunamadı`, ` · ${failed} not found`) : ""), done ? "success" : "warning");
            if (done) try { revealInFolder(dir); } catch (e) {}
        } catch (e) { showToast(e.message, "error", 5000); setStatus(e.message, "error"); }
        finally { if (btn) btn.disabled = false; }
    }
    function injectStockBroll() {
        const markBtn = $id("broll-mark");
        const item = markBtn && (markBtn.closest(".setting-item") || markBtn.parentElement);
        if (!item || $id("broll-dl")) return;
        const d = document.createElement("div");
        d.innerHTML = `
          <button class="btn-secondary" id="broll-dl" style="width:100%; margin-top:6px">
            ${L("Stok klipleri indir (Pexels)", "Download stock clips (Pexels)")}
            <span class="hc-badge" style="position:static; margin-left:6px">${L("çevrimiçi", "online")}</span></button>
          <div class="setting-hint" style="margin-top:6px; margin-bottom:6px">${L("İsteğe bağlı ve tek çevrimiçi özellik: ücretsiz Pexels anahtarı ister (Ayarlar → AI & API). Klipler Masaüstü/subsper_broll'a iner.", "Optional, and the only online feature: needs a free Pexels key (Settings → AI & API). Clips land in Desktop/subsper_broll.")}</div>`;
        item.appendChild(d);
        $id("broll-dl").onclick = brollDownload;
    }
    function injectPexelsKey() {
        const sc = document.querySelector("#panel-su-main .setup-scroll");
        if (!sc || $id("set-pexels")) return;
        const d = document.createElement("div");
        d.innerHTML = `
          <div class="setup-section-title" style="margin-top:16px">${L("Stok Görsel (isteğe bağlı)", "Stock Footage (optional)")}</div>
          <div class="setting-item" style="padding-top:12px; padding-bottom:12px">
            <div class="setting-desc" style="margin-bottom:8px">${L("B-Roll sayfasındaki 'Stok klipleri indir' için ücretsiz Pexels API anahtarı. Boş bırakırsan program tamamen çevrimdışı kalır.", "A free Pexels API key for 'Download stock clips' on the B-Roll page. Leave it empty and the app stays fully offline.")}</div>
            <input type="text" id="set-pexels" class="settings-textarea" style="height:32px; font-size:13px; padding:0 8px"
                   placeholder="${L("Pexels API anahtarı", "Pexels API key")}">
            <div class="setting-hint" style="margin-top:6px">pexels.com/api → ${L("ücretsiz anahtar", "free key")}</div>
          </div>`;
        sc.appendChild(d);
        const inp = $id("set-pexels");
        inp.value = settings.pexelsKey || "";
        inp.addEventListener("input", () => onSettingChange("pexelsKey", inp.value.trim()));
    }

    // #D3 batch transcribe across project sequences (desktop already batches
    // files in desktop-app.js; this is the Premiere-side equivalent)
    async function batchScan() {
        const wrap = $id("batch-list"); if (!wrap) return;
        wrap.innerHTML = `<div class="setting-hint">${L("Taranıyor…", "Scanning…")}</div>`;
        await loadHostJSX();
        const r = await evalScript("wsListSequences()");
        if (!(r && r.success)) { wrap.innerHTML = `<div class="setting-hint">${(r && r.error) || "?"}</div>`; return; }
        const seqs = (r.sequences || []).filter(s => s.clips > 0);
        if (!seqs.length) { wrap.innerHTML = `<div class="setting-hint">${L("Dolu sekans yok", "No non-empty sequences")}</div>`; return; }
        wrap.innerHTML = `<div class="ui2-checks" style="grid-template-columns:1fr">` + seqs.map(s => `
            <label class="ui2-check">
              <input type="checkbox" class="batch-seq" data-id="${s.id}" data-name="${String(s.name).replace(/"/g, "&quot;")}"${s.active ? " checked" : ""}>
              <span>${s.name} · ${s.clips} ${L("klip", "clips")}</span></label>`).join("") + `</div>`;
        const run = $id("batch-run"); if (run) run.style.display = "block";
    }
    async function batchRun() {
        const picks = [...document.querySelectorAll(".batch-seq")].filter(c => c.checked);
        if (!picks.length) { showToast(L("En az bir sekans seç", "Pick at least one sequence"), "info", 3000); return; }
        const btn = $id("batch-run"); if (btn) btn.disabled = true;
        const dir = path.join(os.homedir(), "Desktop", "subsper_batch");
        try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
        let done = 0, failed = 0;
        try {
            for (let i = 0; i < picks.length; i++) {
                const id = +picks[i].getAttribute("data-id");
                const name = picks[i].getAttribute("data-name") || ("seq" + (i + 1));
                setStatus(L(`Toplu ${i + 1}/${picks.length}: `, `Batch ${i + 1}/${picks.length}: `) + name, "info");
                const act = await evalScript(`wsActivateSequence(${id})`);
                if (!(act && act.success)) { failed++; continue; }
                try {
                    await startTranscription();
                    if (segments && segments.length) {
                        const safe = name.replace(/[^\w\-. ]+/g, "_").slice(0, 60);
                        fs.writeFileSync(path.join(dir, safe + ".srt"), segmentsToSRT(), "utf8");
                        done++;
                    } else failed++;
                } catch (e) { failed++; }
            }
            setStatus(L(`✓ Toplu bitti — ${done} SRT → Masaüstü/subsper_batch`, `✓ Batch done — ${done} SRT → Desktop/subsper_batch`) +
                      (failed ? L(` · ${failed} atlandı`, ` · ${failed} skipped`) : ""), failed ? "warning" : "success");
            if (done) try { revealInFolder(dir); } catch (e) {}
        } finally { if (btn) btn.disabled = false; }
    }
    function injectBatch() {
        if (DESK) return;                       // desktop batches files, not sequences
        const sc = document.querySelector("#panel-tx-work .controls");
        if (!sc || $id("batch-scan")) return;
        const d = document.createElement("div");
        d.className = "setting-item tool-card";
        d.style.marginTop = "10px";
        d.innerHTML = `
          <div class="setting-row"><div class="setting-info">
            <div class="setting-name">${L("Toplu Transcribe (sekanslar)", "Batch Transcribe (sequences)")}</div>
            <div class="setting-desc">${L("Projedeki birden çok sekansı sırayla yazıya döker; her biri için Masaüstü/subsper_batch'e SRT kaydeder.", "Transcribes several sequences in a row and saves an SRT per sequence into Desktop/subsper_batch.")}</div>
          </div></div>
          <button class="btn-load-srt" id="batch-scan" style="width:100%; margin-top:4px">${L("1 · Sekansları Tara", "1 · Scan Sequences")}</button>
          <div id="batch-list"></div>
          <button class="btn-transcribe btn-compact" id="batch-run" style="display:none; margin-top:8px">${L("2 · Toplu Başlat", "2 · Run Batch")}</button>`;
        sc.appendChild(d);
        $id("batch-scan").onclick = () => batchScan().catch(e => showToast(e.message, "error", 4000));
        $id("batch-run").onclick = () => batchRun().catch(e => showToast(e.message, "error", 4000));
    }

    // The gate is worthless unless the paid actions actually consult it. Wrap
    // them once, after desktop-app.js has installed its own overrides.
    function gateActions() {
        if (!LICENSING) return;
        ["startTranscription", "exportAs", "sendToPremiere"].forEach(name => {
            const orig = window[name];
            if (typeof orig !== "function" || orig.__gated) return;
            const wrapped = function () { return licenseGate() ? orig.apply(this, arguments) : undefined; };
            wrapped.__gated = true;
            window[name] = wrapped;
        });
    }

    function fazD() {
        gateActions();
        injectLicense();
        injectPexelsKey();
        injectStockBroll();
        injectBatch();
    }

    function fazA() {
        if (!DESK) {
            patchEvalHistory();                        // history logs Premiere host calls
            window.applyTextCuts = applyTextCutsPro;   // upgrade text-based editing
            injectHistory();
        }
        injectChapterExtras();
        injectProfanityReport();
        injectErrorCopy();
    }

    setTimeout(() => {
        try { injectAll(); fazA(); fazB(); fazC(); fazD(); injectListMirrors(); subPosPro(); }
        catch (e) { console.error("[Subsper] features-v2 init:", e); }
    }, 40);
})();
