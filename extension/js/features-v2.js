/* Subsper features v2 — Remove Repeats · Chapters · Viral Clips · B-Roll ·
   Vertical Resize · Multicam (placeholder). EXTENSION ONLY.
   Loaded after main.js (uses its globals: segments, settings, aiComplete,
   parseAiClipRanges, showRangePreview, evalScript, loadHostJSX, showToast,
   fmtMMSS) and before ui-v2.js (which isolates each card into its own page).
   Engine order per smart tool: cloud/local AI when a key or custom URL is
   set, otherwise on-device heuristics — the buttons never lock. */
(function () {
    "use strict";

    const L = (tr, en) => (settings.uiLang === "tr") ? tr : en;
    const $id = id => document.getElementById(id);

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
                if (jaccard(A, B) >= 0.65) {
                    if (keep === "fastest") {
                        const di = segs[i].seqEnd - segs[i].seqStart;
                        const dj = segs[j].seqEnd - segs[j].seqStart;
                        cut.add(di > dj ? i : j);
                    } else cut.add(i); // keep the LAST take
                }
            }
        }
        return [...cut].sort((a, b) => a - b);
    }
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
`You are a video editor. Below is a transcript with line numbers and [MM:SS] start times. Find RE-TAKES: places where the speaker repeats nearly the same sentence (a failed take followed by a corrected one) or clear slips of the tongue. For each bad take that should be DELETED (keep the ${keep === "fastest" ? "shortest, most fluent" : "last"} version), output one line "MM:SS-MM:SS reason". If there are none, output "NONE".

Transcript:
${_plainTranscript()}`);
                    ranges = parseAiClipRanges(text).map(r => ({ start: r.start, end: r.end, dur: +(r.end - r.start).toFixed(1) }));
                    via = "AI";
                } catch (e) { showToast("AI: " + e.message, "warning", 4000); }
            }
            if (!ranges.length) {
                showToast(L("Tekrar çekim bulunamadı — kayıt temiz görünüyor ✓", "No repeated takes found — the recording looks clean ✓"), "success", 4000);
                return;
            }
            showRangePreview(L(`Tekrarları kes (${via})`, `Remove repeats (${via})`), ranges, async chosen => {
                await loadHostJSX();
                const arg = JSON.stringify(chosen).replace(/'/g, "\\'");
                const r = await evalScript(`rippleDeleteRanges('${arg}')`);
                if (r && r.success && r.removed > 0)
                    showToast(L(`✓ ${r.removed} tekrar kesildi — Cmd/Ctrl+Z ile geri al`, `✓ Cut ${r.removed} repeat(s) — undo with Cmd/Ctrl+Z`), "success", 5000);
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
        const btn = $id("resize-btn"); if (btn) btn.disabled = true;
        try {
            await loadHostJSX();
            const r = await evalScript(`createResizedSequence('${JSON.stringify({ w, h, label }).replace(/'/g, "\\'")}')`);
            if (r && r.success)
                showToast(L(`✓ "${r.name}" oluşturuldu — ${r.count} klip ölçeklendi`, `✓ Created "${r.name}" — scaled ${r.count} clip(s)`), "success", 6000);
            else showToast((r && r.error) || L("Dönüştürülemedi", "Resize failed"), "error", 6000);
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
            setSilenceStatus(L(`✓ Eşik ${best} dB olarak ayarlandı — önizleme hazır`, `✓ Threshold set to ${best} dB — preview ready`), "success");
        } catch (e) {
            setSilenceStatus(e.message, "error");
            showToast(e.message, "error", 5000);
        } finally {
            showSilenceProgress(false);
            if (btn) btn.disabled = false;
        }
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
                const payload = JSON.stringify({ ranges: chosen, level: 0 }).replace(/'/g, "\\'");
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
        return cutSilences();
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
          <div class="ui2-row-label">${L("İşlem", "Action")}</div>
          ${segControl("sil-action", [
            ["cut", L("Kes", "Cut")], ["mark", L("İşaretle", "Mark")], ["mute", L("Sustur", "Mute")]])}
          <button class="btn-transcribe btn-compact" id="sil-run" style="margin-top:10px">${L("Sessizlikleri Temizle", "Clean Up Silences")}</button>
          <div class="setting-hint" style="margin-top:8px">${L("Kes: ripple-delete (onaylı liste) · İşaretle: sadece marker · Sustur: silmeden sesi kapatır. Geçiş efektleri (J/L-cut) yakında.", "Cut: ripple-delete with review · Mark: markers only · Mute: silences audio without deleting. Transitions (J/L-cut) coming soon.")}</div>`;
        item.appendChild(box);
        wireSeg("sil-target");
        wireSeg("sil-rhythm", applyRhythm);
        wireSeg("sil-action", v => {
            const run = $id("sil-run");
            if (run) run.textContent = v === "mark" ? L("Sessizlikleri İşaretle", "Mark Silences")
                : v === "mute" ? L("Sessizlikleri Sustur", "Mute Silences")
                : L("Sessizlikleri Temizle", "Clean Up Silences");
        });
        $id("sil-analyze").onclick = silAnalyze;
        $id("sil-run").onclick = silRun;
        document.body.classList.add("ui2-silpro");   // hides the two legacy buttons
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

        const rep = card(`
          <div class="setting-row"><div class="setting-info">
            <div class="setting-name">${L("Tekrarları Sil", "Remove Repeats")}</div>
            <div class="setting-desc">${L("Aynı cümlenin tekrar çekimlerini bulur, kötü take'leri kesip atar. Önce Transcribe.", "Finds re-taken sentences and ripple-deletes the bad takes. Transcribe first.")}</div>
          </div></div>
          <div class="setting-row">
            <div class="setting-info"><div class="setting-name" style="font-weight:500">${L("Hangisi kalsın?", "Which take to keep?")}</div></div>
            <select id="repeat-keep" style="max-width:170px">
              <option value="last">${L("Son take", "Last take")}</option>
              <option value="fastest">${L("En akıcı (kısa)", "Fastest read")}</option>
            </select>
          </div>
          <button class="btn-transcribe btn-compact" id="repeat-btn" style="margin-top:8px">${L("Tekrarları Bul ve Kes", "Find & Cut Repeats")}</button>
          <div class="setting-hint" style="margin-top:8px">${L("Kesmeden önce liste gösterilir, onaylarsın. Cihaz içi çalışır; AI anahtarı varsa dil sürçmelerini de yakalar.", "You review the list before anything is cut. Works on-device; with an AI key it also catches slips.")}</div>`);
        sc.appendChild(rep); $id("repeat-btn").onclick = findRepeats;

        const ch = card(`
          <div class="setting-row"><div class="setting-info">
            <div class="setting-name">${L("Bölümler", "Chapters")}</div>
            <div class="setting-desc">${L("Videoyu bölümlere ayırır: timeline'a isimli marker + YouTube açıklaması için hazır metin.", "Splits the video into chapters: named timeline markers + ready-to-paste YouTube text.")}</div>
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

        const vi = card(`
          <div class="setting-row"><div class="setting-info">
            <div class="setting-name">${L("Viral Klipler", "Viral Clips")}</div>
            <div class="setting-desc">${L("Uzun videodan kısa içerik için en güçlü 15-60 saniyelik anları bulur ve timeline'a marker koyar.", "Finds the strongest 15-60s moments for short-form content and drops markers on the timeline.")}</div>
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
          <button class="btn-transcribe btn-compact" id="resize-btn" style="margin-top:8px">${L("Kopya Sekans Oluştur", "Create Resized Copy")}</button>
          <div class="setting-hint" style="margin-top:8px">${L("Deneysel — Premiere 2019+ gerekir. Orijinal sekans değişmez.", "Experimental — needs Premiere 2019+. The original sequence is untouched.")}</div>`);
        sc.appendChild(rs); $id("resize-btn").onclick = resizeRun;

        const mc = card(`
          <div class="setting-row"><div class="setting-info">
            <div class="setting-name">Podcast Multicam</div>
            <div class="setting-desc">${L("Kim konuşuyorsa görüntüyü ona geçirir: ses kanallarını konuşmacılarla eşleştir, gerisini Subsper yapar.", "Switches the picture to whoever is talking: map audio tracks to speakers, Subsper does the rest.")}</div>
          </div></div>
          <div id="multicam-btn"></div>
          <button class="btn-transcribe btn-compact" disabled style="margin-top:4px; margin-bottom:6px">${L("Yakında — bir sonraki güncellemede", "Coming in the next update")}</button>`);
        sc.appendChild(mc);
    }

    setTimeout(() => { try { injectAll(); } catch (e) { console.error("[Subsper] features-v2 init:", e); } }, 40);
})();
