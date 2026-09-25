/* Premiere-only caption-free ranges. Video clips are time markers; the source
   sequence and its clips are never edited by this feature. */
(function () {
    "use strict";
    const tr = () => settings.uiLang === "tr";
    const L = (a, b) => tr() ? a : b;
    const key = info => "subsper:caption-exclusions:" + (info.project || "") + ":" + (info.sequence || "");
    const clipKey = (track, c) => track + ":" + c.start.toFixed(3) + ":" + c.end.toFixed(3);
    const escape = value => String(value == null ? "" : value).replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[ch]));

    function subtractZones(cues, zones) {
        const sorted = zones.filter(z => Number.isFinite(z.start) && Number.isFinite(z.end) && z.end > z.start)
            .sort((a, b) => a.start - b.start);
        const merged = [];
        sorted.forEach(z => {
            const last = merged[merged.length - 1];
            if (last && z.start <= last.end) last.end = Math.max(last.end, z.end);
            else merged.push({ start: z.start, end: z.end });
        });
        const out = [];
        cues.forEach(cue => {
            let pieces = [{ start: cue.seqStart, end: cue.seqEnd }];
            merged.forEach(zone => {
                pieces = pieces.flatMap(p => {
                    if (zone.end <= p.start || zone.start >= p.end) return [p];
                    const result = [];
                    if (zone.start > p.start) result.push({ start: p.start, end: Math.min(zone.start, p.end) });
                    if (zone.end < p.end) result.push({ start: Math.max(zone.end, p.start), end: p.end });
                    return result;
                });
            });
            pieces.forEach(p => {
                if (p.end - p.start >= 0.25) out.push({ ...cue, seqStart: p.start, seqEnd: p.end });
            });
        });
        return out;
    }
    window.__subtractCaptionZones = subtractZones;

    async function scan() {
        await loadHostJSX();
        return evalScript("wsListCaptionExclusionClips()");
    }
    function readSaved(info) {
        try { return JSON.parse(localStorage.getItem(key(info))) || { track: -1, clips: [] }; }
        catch (_) { return { track: -1, clips: [] }; }
    }
    function selectedZones(info, saved) {
        const track = info.tracks.find(t => t.i === saved.track);
        if (!track) return [];
        const selected = new Set(saved.clips || []);
        return track.clips.filter(c => selected.has(clipKey(track.i, c)));
    }

    window.preparePremiereCaptionSegments = async function (cues) {
        const info = await scan();
        if (!info || !info.success) {
            showToast(L("Geçiş aralıkları okunamadı; altyazı gönderilmedi", "Could not verify transition ranges; captions were not sent"), "error", 5000);
            return null;
        }
        const saved = readSaved(info);
        if (!saved.clips.length) return cues;
        const zones = selectedZones(info, saved);
        if (zones.length !== saved.clips.length) {
            showToast(L("Geçiş katmanı değişmiş. Aralıkları yeniden seç; altyazı gönderilmedi", "The transition track changed. Review ranges before sending"), "warning", 6000);
            return null;
        }
        return subtractZones(cues, zones);
    };

    async function openPanel() {
        const info = await scan();
        if (!info || !info.success) {
            showToast((info && info.error) || L("Premiere zaman çizelgesi okunamadı", "Could not read Premiere timeline"), "error", 5000);
            return;
        }
        const old = document.getElementById("caption-zones-ov"); if (old) old.remove();
        const saved = readSaved(info);
        let trackIndex = saved.track;
        let chosen = new Set(saved.clips);
        const ov = document.createElement("div");
        ov.id = "caption-zones-ov";
        ov.innerHTML = `<div class="cz-dialog" role="dialog" aria-modal="true" aria-label="${L("Altyazısız bölgeler", "Caption-free zones")}">
            <h3>${L("Altyazısız bölgeler", "Caption-free zones")}</h3>
            <p>${L("Yalnızca altyazının görünmemesini istediğin süreleri içeren video katmanını seç. Katmandaki klipleri aşağıdan tek tek işaretle. Mevcut timeline değişmez; kural bir sonraki Premiere'e Gönder işlemine uygulanır.", "Choose a video track containing only the spans where captions should be hidden. Check individual clips below. The timeline is unchanged; the rule applies on the next Send to Premiere.")}</p>
            <label class="cz-label" for="cz-track">${L("İşaret katmanı", "Marker track")}</label>
            <select id="cz-track"><option value="-1">${L("Katman seç", "Choose a track")}</option>${info.tracks.map(t => `<option value="${t.i}"${t.i === trackIndex ? " selected" : ""}>V${t.i + 1}${t.name ? " · " + escape(t.name) : ""} (${t.clips.length})</option>`).join("")}</select>
            <div id="cz-clips" class="cz-clips"></div><div id="cz-summary" class="cz-summary"></div>
            <div class="cz-actions"><button class="btn-secondary" id="cz-cancel">${L("Vazgeç", "Cancel")}</button><button class="btn-transcribe btn-compact" id="cz-save">${L("Kaydet", "Save")}</button></div>
          </div>`;
        document.body.appendChild(ov);
        function render() {
            const track = info.tracks.find(t => t.i === trackIndex);
            const area = ov.querySelector("#cz-clips");
            area.innerHTML = !track ? `<p>${L("Önce video katmanı seç", "Choose a video track first")}</p>`
                : track.clips.length ? track.clips.map((c, i) => `<label class="cz-clip"><input type="checkbox" data-clip="${i}"${chosen.has(clipKey(trackIndex, c)) ? " checked" : ""}><span><strong>${escape(c.name)}</strong><small>${formatTime(c.start)} → ${formatTime(c.end)} · ${(c.end-c.start).toFixed(1)}s</small></span></label>`).join("")
                : `<p>${L("Bu katmanda klip yok", "No clips on this track")}</p>`;
            area.querySelectorAll("input[data-clip]").forEach(input => input.addEventListener("change", () => {
                const c = track.clips[+input.dataset.clip], id = clipKey(trackIndex, c);
                if (input.checked) chosen.add(id); else chosen.delete(id);
                summary();
            }));
            summary();
        }
        function summary() {
            const zones = selectedZones(info, { track: trackIndex, clips: [...chosen] });
            const base = settings.gapFill ? applyGapFill(segments, settings.gapMax) : segments;
            const result = subtractZones(base, zones);
            const affected = base.filter(c => zones.some(z => z.start < c.seqEnd && z.end > c.seqStart)).length;
            ov.querySelector("#cz-summary").textContent = `${zones.length} ${L("aralık seçili", "ranges selected")} · ${affected} ${L("altyazı etkilenir", "captions affected")}${base.length && !result.length ? " · " + L("Tüm altyazılar kapanıyor!", "All captions would be hidden!") : ""}`;
        }
        ov.querySelector("#cz-track").addEventListener("change", e => {
            trackIndex = +e.target.value;
            const track = info.tracks.find(t => t.i === trackIndex);
            chosen = new Set(track ? track.clips.map(c => clipKey(trackIndex, c)) : []);
            render();
        });
        ov.querySelector("#cz-cancel").onclick = () => ov.remove();
        ov.onclick = e => { if (e.target === ov) ov.remove(); };
        ov.querySelector("#cz-save").onclick = () => {
            localStorage.setItem(key(info), JSON.stringify({ track: trackIndex, clips: [...chosen] }));
            ov.remove();
            showToast(L("Altyazısız bölgeler kaydedildi; sonraki gönderimde uygulanacak", "Caption-free zones saved for the next send"), "success", 4500);
        };
        render();
    }

    const send = document.getElementById("send-btn");
    if (send) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "btn-secondary cz-open";
        button.textContent = L("Altyazısız bölgeler", "Caption-free zones");
        button.title = L("Premiere video katmanındaki klipleri altyazısız bölge olarak seç", "Choose video clips as caption-free zones");
        button.onclick = openPanel;
        send.parentNode.insertBefore(button, send);
    }
    const style = document.createElement("style");
    style.textContent = `#caption-zones-ov{position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.65);display:flex;align-items:center;justify-content:center;padding:12px}
      .cz-dialog{background:var(--bg2,#182326);border:1px solid var(--border2,#394749);border-radius:12px;width:min(560px,96vw);max-height:86vh;padding:18px;display:flex;flex-direction:column;gap:10px;color:var(--text,#eee)}
      .cz-dialog h3{margin:0;font-size:18px}.cz-dialog p{margin:0;color:var(--text2,#abc);font-size:13px;line-height:1.45}
      .cz-label{font-size:12px;font-weight:700}.cz-dialog select{width:100%;padding:9px;background:var(--bg3,#203034);color:inherit;border:1px solid var(--border2,#456);border-radius:8px}
      .cz-clips{overflow-y:auto;min-height:80px;max-height:44vh;border:1px solid var(--border2,#456);border-radius:8px;padding:5px}
      .cz-clip{display:flex;align-items:flex-start;gap:10px;padding:9px;border-bottom:1px solid var(--border2,#456);cursor:pointer}.cz-clip:last-child{border-bottom:0}.cz-clip span{display:grid;gap:3px;min-width:0;overflow-wrap:anywhere}.cz-clip small,.cz-summary{color:var(--text3,#9ab);font-size:12px}
      .cz-actions{display:flex;justify-content:flex-end;gap:8px}.cz-actions button{width:auto;margin:0}.cz-open{white-space:nowrap;font-size:12px}`;
    document.head.appendChild(style);
})();
