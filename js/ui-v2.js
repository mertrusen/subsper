/* Subsper UI v2 — categorized card home + isolated tool pages. Shared by the
   Premiere extension and the desktop app: tools flagged pp (Premiere-only —
   they drive the timeline) are hidden when window.IS_DESKTOP is set.
   Pure navigation/presentation shell over main.js's state machine:
   - home = category-grouped cards (own mini SVG illustration + name + one-line
     description) rendered from the TOOLS table below;
   - each card opens ONE tool: sibling cards sharing the same underlying panel
     are hidden (applyView), and the tool's settings live in a collapsed
     <details class="ui2-adv"> moved onto its page (IDs untouched). */
(function () {
    "use strict";

    const L = (tr, en) => (settings.uiLang === "tr") ? tr : en;
    const DESK = (typeof window !== "undefined" && window.IS_DESKTOP === true);

    // ── mini illustrations (own drawings; viewBox 120x56) ──────────────────
    const A = {
        frame: `<rect x="10" y="8" width="100" height="40" rx="6" fill="var(--bg3)" stroke="var(--border2)"/>`,
        bars(xs, y, h, c, o) {
            return xs.map((w, i) =>
                `<rect x="${w[0]}" y="${y - (w[1] || h) / 2}" width="3" height="${w[1] || h}" rx="1.5" fill="${c}" opacity="${o || 1}"/>`).join("");
        },
        wave(y, c, gapStart, gapEnd) {
            const hs = [8, 14, 20, 11, 17, 22, 9, 15, 19, 12, 18, 10, 16, 21, 13, 8, 17, 11, 20, 14, 9, 18, 12, 16];
            let s = "";
            hs.forEach((h, i) => {
                const x = 16 + i * 3.7;
                const inGap = gapStart != null && x >= gapStart && x <= gapEnd;
                s += `<rect x="${x}" y="${y - (inGap ? 3 : h) / 2}" width="2.2" height="${inGap ? 3 : h}" rx="1" fill="${inGap ? "var(--text-lo)" : c}"/>`;
            });
            return s;
        },
    };
    const ART = {
        subtitles: c => `${A.frame}<polygon points="55,20 67,26 55,32" fill="${c}" opacity=".9"/><rect x="26" y="36" width="68" height="5" rx="2.5" fill="${c}"/><rect x="38" y="28" width="44" height="4" rx="2" fill="${c}" opacity=".45"/>`,
        silence:   c => `${A.frame}${A.wave(28, c, 52, 68)}<rect x="52" y="12" width="16" height="32" rx="3" fill="none" stroke="#b06a63" stroke-width="1.5" stroke-dasharray="3 2"/><path d="M56 40 64 16" stroke="#b06a63" stroke-width="1.5"/>`,
        filler:    c => `${A.frame}${A.wave(34, c)}<rect x="44" y="12" width="32" height="14" rx="7" fill="var(--bg-elev)" stroke="${c}"/><circle cx="53" cy="19" r="1.6" fill="${c}"/><circle cx="60" cy="19" r="1.6" fill="${c}"/><circle cx="67" cy="19" r="1.6" fill="${c}"/>`,
        repeat:    c => `${A.frame}<rect x="20" y="16" width="34" height="6" rx="3" fill="${c}" opacity=".4"/><rect x="20" y="26" width="34" height="6" rx="3" fill="${c}" opacity=".4"/><path d="M24 14 50 34" stroke="#b06a63" stroke-width="2"/><rect x="66" y="16" width="34" height="6" rx="3" fill="${c}"/><rect x="66" y="26" width="34" height="6" rx="3" fill="${c}"/><path d="M92 38l4 4 7-8" stroke="#7bb389" stroke-width="2" fill="none"/>`,
        zoom:      c => `${A.frame}<rect x="38" y="16" width="44" height="24" rx="4" fill="none" stroke="${c}" stroke-width="1.6"/><path d="M30 46 42 36 M90 10 78 20" stroke="${c}" stroke-width="1.6"/><path d="M30 40v6h6 M90 16v-6h-6" stroke="${c}" stroke-width="1.6" fill="none"/>`,
        multicam:  c => `${A.frame}<rect x="20" y="14" width="34" height="22" rx="4" fill="var(--bg-elev)" stroke="${c}"/><rect x="66" y="20" width="34" height="22" rx="4" fill="var(--bg-elev)" stroke="${c}" opacity=".5"/><path d="M56 25h8m0 0-3-3m3 3-3 3" stroke="${c}" stroke-width="1.6" fill="none"/><circle cx="27" cy="20" r="2" fill="#b06a63"/>`,
        resize:    c => `${A.frame}<rect x="20" y="18" width="34" height="20" rx="3" fill="none" stroke="${c}" opacity=".5"/><rect x="72" y="12" width="20" height="32" rx="3" fill="none" stroke="${c}" stroke-width="1.6"/><path d="M58 28h8m0 0-3-3m3 3-3 3" stroke="${c}" stroke-width="1.6" fill="none"/>`,
        beep:      c => `${A.frame}${A.wave(28, c, 48, 72)}<rect x="48" y="20" width="24" height="16" rx="3" fill="${c}" opacity=".9"/><text x="60" y="31.5" text-anchor="middle" font-size="8" font-weight="700" fill="#fff" font-family="var(--font)">BiP</text>`,
        enhance:   c => `${A.frame}<path d="M35 16v24M60 16v24M85 16v24" stroke="var(--border2)" stroke-width="2"/><circle cx="35" cy="34" r="4" fill="${c}"/><circle cx="60" cy="22" r="4" fill="${c}"/><circle cx="85" cy="29" r="4" fill="${c}"/>`,
        chapters:  c => `${A.frame}<rect x="18" y="34" width="84" height="6" rx="3" fill="var(--border2)"/><path d="M30 34V18l8 3-8 3M60 34V18l8 3-8 3M88 34V18l8 3-8 3" stroke="${c}" stroke-width="1.6" fill="none"/>`,
        viral:     c => `${A.frame}<rect x="20" y="30" width="18" height="12" rx="2" fill="${c}" opacity=".4"/><rect x="42" y="30" width="18" height="12" rx="2" fill="${c}"/><rect x="64" y="30" width="18" height="12" rx="2" fill="${c}" opacity=".4"/><path d="M51 24c-3-4 0-8 3-10-1 4 5 4 4 9a5 5 0 0 1-7 1z" fill="#c89a62"/><path d="M88 14l1.6 4 4 1.6-4 1.6-1.6 4-1.6-4-4-1.6 4-1.6z" fill="${c}"/>`,
        broll:     c => `${A.frame}<rect x="24" y="20" width="30" height="20" rx="3" fill="var(--bg-elev)" stroke="${c}" opacity=".55"/><rect x="32" y="14" width="30" height="20" rx="3" fill="var(--bg-elev)" stroke="${c}"/><path d="M74 22h22M74 28h16M74 34h20" stroke="${c}" stroke-width="2" stroke-linecap="round" opacity=".6"/>`,
        ai:        c => `${A.frame}<path d="M45 18l2.4 6.1L53 26l-5.6 1.9L45 34l-2.4-6.1L37 26l5.6-1.9z" fill="${c}"/><path d="M62 14l1.4 3.6 3.6 1.4-3.6 1.4L62 24l-1.4-3.6L57 19l3.6-1.4z" fill="${c}" opacity=".7"/><path d="M58 34h28M58 40h20" stroke="${c}" stroke-width="2" stroke-linecap="round" opacity=".5"/>`,
        settings:  c => `${A.frame}<circle cx="60" cy="28" r="7" fill="none" stroke="${c}" stroke-width="1.8"/><circle cx="60" cy="28" r="2.6" fill="${c}"/><path d="M60 15v5M60 36v5M47 28h5M68 28h5M50.5 18.5l3.5 3.5M66 32l3.5 3.5M69.5 18.5 66 22M54 32l-3.5 3.5" stroke="${c}" stroke-width="1.8"/>`,
        help:      c => `${A.frame}<circle cx="60" cy="28" r="13" fill="none" stroke="${c}" stroke-width="1.8"/><text x="60" y="33" text-anchor="middle" font-size="15" font-weight="700" fill="${c}" font-family="var(--font)">?</text>`,
        ducking:   c => `${A.frame}${A.wave(22, c)}<path d="M16 40 L44 40 Q48 40 50 36 L70 36 Q72 40 76 40 L104 40" fill="none" stroke="${c}" stroke-width="2" opacity=".55"/><text x="60" y="50" text-anchor="middle" font-size="7" fill="${c}" opacity=".8" font-family="var(--font)">${'♪'}</text>`,
        markercut: c => `${A.frame}<rect x="16" y="30" width="88" height="8" rx="4" fill="var(--border2)"/><path d="M32 30V16l7 3-7 3M64 30V16l7 3-7 3" stroke="${c}" stroke-width="1.6" fill="none"/><rect x="34" y="29" width="30" height="10" rx="3" fill="${c}" opacity=".5"/><path d="M84 20 96 44M96 20 84 44" stroke="${c}" stroke-width="1.6"/>`,
        pace:      c => `${A.frame}<rect x="20" y="34" width="10" height="8" rx="2" fill="${c}" opacity=".5"/><rect x="34" y="28" width="10" height="14" rx="2" fill="${c}" opacity=".7"/><rect x="48" y="18" width="10" height="24" rx="2" fill="#b06a63"/><rect x="62" y="26" width="10" height="16" rx="2" fill="${c}" opacity=".7"/><rect x="76" y="32" width="10" height="10" rx="2" fill="${c}" opacity=".5"/><path d="M20 16h60" stroke="var(--border2)" stroke-dasharray="3 3"/>`,
        social:    c => `${A.frame}<rect x="24" y="12" width="18" height="32" rx="4" fill="var(--bg-elev)" stroke="${c}"/><rect x="51" y="12" width="18" height="32" rx="4" fill="var(--bg-elev)" stroke="${c}" opacity=".7"/><rect x="78" y="12" width="18" height="32" rx="4" fill="var(--bg-elev)" stroke="${c}" opacity=".45"/><path d="M30 26l6 3-6 3z" fill="${c}"/>`,
    };

    // ── tool table ─────────────────────────────────────────────────────────
    const TOOLS = {
        subtitles: { cat: "sub", tab: "transcribe", gear: true, color: "#6b9fd8",
                     name: () => L("Altyazı Oluştur", "Subtitles"),
                     desc: () => DESK ? L("Dosyayı yazıya döker, düzenle ve SRT/ASS olarak dışa aktar", "Transcribe a file, edit, export SRT/ASS")
                                      : L("Konuşmayı yazıya döker, düzenle ve timeline'a gönder", "Transcribe speech, edit, send to the timeline") },
        ai:        { cat: "sub", tab: "transcribe", color: "#a78bc9",
                     name: () => L("AI Araçları", "AI Tools"),
                     desc: () => L("Özet, çeviri, dilbilgisi ve içerik fikirleri", "Summary, translation, grammar and content ideas"),
                     open: () => { const p = $("ai-panel"); if (p && p.style.display === "none" && typeof toggleAiPanel === "function") toggleAiPanel(); } },
        silence:   { cat: "edit", tab: "edit", view: "#silence-btn", badge: "beta", color: "#c89a62",
                     name: () => L("Sessizlikleri Kes", "Cut Silences"),
                     desc: () => DESK ? L("Sessiz boşlukları bulur, kırpılmış bir kopya dışa aktarır", "Finds silent gaps; exports a trimmed copy")
                                      : L("Sessiz boşlukları bulur, işaretler veya ripple ile keser", "Finds silent gaps; marks or ripple-deletes them"),
                     open: () => { if (window.__silPageOpen) window.__silPageOpen(); } },
        repeat:    { cat: "edit", tab: "edit", view: "#repeat-btn", badge: "new", color: "#c47f79",
                     name: () => L("Tekrarları Sil", "Remove Repeats"),
                     desc: () => L("Tekrar çekimleri bulur, kötü take'leri atar", "Finds re-takes and drops the bad ones") },
        filler:    { cat: "edit", tab: "edit",
                     view: DESK ? "button[onclick^='cutFillerWordsDesktop']" : "#filler-cut-btn",
                     badge: "beta", color: "#7fb1c9",
                     name: () => L("Dolgu Kelimeleri Kes", "Cut Filler Words"),
                     desc: () => L("ee, ıı, şey… kelimelerini videodan temizler", "Cleans um, uh, like… from the video") },
        zoom:      { cat: "edit", tab: "edit", view: "#zoom-btn", badge: "beta", pp: true, color: "#8f8cc9",
                     name: () => L("Otomatik Zoom", "Auto Zoom"),
                     desc: () => L("Kliplere enerji katan yumuşak yakınlaşmalar ekler", "Adds smooth push-ins that energize your clips") },
        multicam:  { cat: "edit", tab: "edit", view: "#mc-scan", badge: "new", pp: true, color: "#bfae6e",
                     name: () => "Podcast Multicam",
                     desc: () => L("Kim konuşuyorsa kamerayı ona geçirir", "Switches cameras to whoever is talking") },
        markercut: { cat: "edit", tab: "edit", view: "#markercut-btn", badge: "new", pp: true, color: "#bfae6e",
                     name: () => L("Marker ile Kes", "Cut by Markers"),
                     desc: () => L("Marker çiftleri arasını kes ya da tut", "Cut or keep between marker pairs") },
        resize:    { cat: "edit", tab: "edit", view: "#resize-btn", badge: "new", pp: true, color: "#7bb389",
                     name: () => L("Dikey Kes", "Vertical Resize"),
                     desc: () => L("Sekansı TikTok/Reels formatına çevirir", "Converts the sequence to TikTok/Reels format") },
        ducking:   { cat: "audio", tab: "audio", view: "#duck-btn", badge: "new", pp: true, color: "#7aa7c2",
                     name: () => L("Müzik Kısma", "Music Ducking"),
                     desc: () => L("Konuşma varken müziği otomatik kısar", "Auto-lowers music while someone talks") },
        beep:      { cat: "audio", tab: "audio", view: "button[onclick^='beepProfanityAction']", color: "#c4726a",
                     name: () => L("Küfür Sansürü", "Beep Profanity"),
                     desc: () => L("Küfürleri bulur; bipler ya da susturur", "Finds profanity; beeps or mutes it") },
        enhance:   { cat: "audio", tab: "audio", view: "#enhance-btn", color: "#7bb389",
                     name: () => L("Sesi İyileştir", "Enhance Audio"),
                     desc: () => L("Gürültüyü azaltır, ses seviyesini dengeler", "Reduces noise, normalizes loudness") },
        chapters:  { cat: "content", tab: "edit", view: "#chapters-btn", badge: "new", color: "#6b9fd8",
                     name: () => L("Bölümler", "Chapters"),
                     desc: () => DESK ? L("YouTube bölüm metni — kopyala ya da kaydet", "YouTube chapter text — copy or save")
                                      : L("YouTube bölümleri + timeline marker'ları", "YouTube chapters + timeline markers") },
        viral:     { cat: "content", tab: "edit", view: "#viral-btn", badge: "new", color: "#c89a62",
                     name: () => L("Viral Klipler", "Viral Clips"),
                     desc: () => L("Kısa içerik için en güçlü anları bulur", "Finds the strongest moments for shorts") },
        pace:      { cat: "content", tab: "edit", view: "#pace-btn", badge: "new", color: "#8f8cc9",
                     name: () => L("Konuşma Analizi", "Speech Pace"),
                     desc: () => DESK ? L("Hız grafiği — 180+ wpm bölgeler kırmızı", "WPM chart — 180+ wpm zones in red")
                                      : L("Hız grafiği + 'çok hızlı' işaretleri", "WPM chart + 'too fast' markers") },
        social:    { cat: "content", tab: "edit", view: "#social-btn", badge: "new", color: "#c89a62",
                     name: () => L("Sosyal Paket", "Social Pack"),
                     desc: () => DESK ? L("Tek tık: viral anlar + klip başına SRT", "One click: viral moments + per-clip SRTs")
                                      : L("Tek tık: viral anlar + SRT + 9:16 kopya", "One click: viral moments + SRTs + 9:16 copy") },
        broll:     { cat: "content", tab: "edit", view: "#broll-btn", badge: "new", color: "#7fb1c9",
                     name: () => "B-Roll",
                     desc: () => L("Anlatıma uygun ara görüntü önerileri", "Footage ideas matched to what's said") },
        settings:  { cat: "general", tab: "setup", color: "#8e8e93",
                     name: () => L("Ayarlar", "Settings"),
                     desc: () => L("Genel tercihler, AI anahtarları, kurulum", "Preferences, AI keys, setup") },
        help:      { cat: "general", overlay: true, color: "#7aa7c2",
                     name: () => L("Yardım", "Help"),
                     desc: () => L("30 saniyede başlangıç turu", "The 30-second starter tour"),
                     open: () => { localStorage.removeItem("ws_onboarded"); if (typeof maybeShowOnboarding === "function") maybeShowOnboarding(); } },
    };
    const CATS = [
        { id: "sub",     label: () => L("Altyazı", "Subtitles") },
        { id: "edit",    label: () => L("Kurgu", "Editing") },
        { id: "audio",   label: () => L("Ses", "Audio") },
        { id: "content", label: () => L("İçerik", "Content") },
        { id: "general", label: () => L("Genel", "General") },
    ];
    const VIEW_PANELS = ["panel-ed-work", "panel-au-work"];
    const PANEL_OF = { edit: "panel-ed-work", audio: "panel-au-work" };

    // ── view isolation: show only the active tool's card + its settings ────
    function applyView(key) {
        const t = TOOLS[key];
        VIEW_PANELS.forEach(pid => {
            const scroll = document.querySelector("#" + pid + " .setup-scroll");
            if (!scroll) return;
            const active = t && t.view && PANEL_OF[t.tab] === pid;
            Array.prototype.forEach.call(scroll.children, ch => {
                let show = true;
                if (active) {
                    if (ch.classList.contains("ui2-adv")) show = ch.getAttribute("data-for") === key;
                    else show = !!(ch.querySelector(t.view) || (ch.matches && ch.matches(t.view)));
                }
                ch.style.display = show ? "" : "none";
            });
            if (active) scroll.scrollTop = 0;
        });
    }

    // move a tool's settings card out of its (hidden) settings sub-panel into
    // a collapsed "Settings" box shown only on that tool's page
    function buildAdv(panelId, key, innerSel) {
        const scroll = document.querySelector("#" + panelId + " .setup-scroll");
        if (!scroll || scroll.querySelector(`.ui2-adv[data-for="${key}"]`)) return;
        const inner = document.querySelector(innerSel);
        const item = inner && inner.closest(".setting-item");
        if (!item) return;
        const det = document.createElement("details");
        det.className = "ui2-adv";
        det.setAttribute("data-for", key);
        const sum = document.createElement("summary");
        sum.textContent = L("Ayarlar", "Settings");
        det.appendChild(sum);
        det.appendChild(item);
        scroll.appendChild(det);
    }

    // ── navigation ─────────────────────────────────────────────────────────
    window.ui2Open = function (key) {
        const t = TOOLS[key]; if (!t) return;
        if (DESK && t.pp) return;   // Premiere-only tool — not shown on desktop
        if (t.overlay) { if (t.open) try { t.open(); } catch (e) {} return; }
        try { localStorage.setItem("ws_lastTool", key); } catch (e) {}
        document.body.classList.remove("ui2-home");
        document.body.setAttribute("data-ui2page", key);
        if (t.tab === "setup") { switchMainTab("setup"); switchSubTab("setup", "main"); }
        else { switchMainTab(t.tab); switchSubTab(t.tab, "work"); }
        if (t.open) try { t.open(); } catch (e) {}
        applyView(key);
        const title = $("page-title"); if (title) title.textContent = t.name();
        const gear = $("page-gear");
        if (gear) { gear.style.display = t.gear ? "inline-flex" : "none"; gear.classList.remove("active"); }
    };
    window.ui2Home = function () {
        document.body.classList.add("ui2-home");
        document.body.removeAttribute("data-ui2page");
    };
    window.ui2Gear = function () {
        const key = document.body.getAttribute("data-ui2page");
        const t = TOOLS[key]; if (!t || !t.gear) return;
        const next = currentSubTab[t.tab] === "settings" ? "work" : "settings";
        switchSubTab(t.tab, next);
        const gear = $("page-gear");
        if (gear) gear.classList.toggle("active", next === "settings");
    };

    // ── home rendering ─────────────────────────────────────────────────────
    function renderHome() {
        const wrap = $("home-cats"); if (!wrap) return;
        wrap.innerHTML = "";
        // one-tap resume: last used tool right under the badge
        const lastKey = (() => { try { return localStorage.getItem("ws_lastTool"); } catch (e) { return null; } })();
        if (lastKey && TOOLS[lastKey] && !TOOLS[lastKey].overlay && !(DESK && TOOLS[lastKey].pp)) {
            const lt = TOOLS[lastKey];
            const row = document.createElement("button");
            row.className = "ui2-resume";
            row.innerHTML = `<span>${L("Kaldığın yerden devam:", "Pick up where you left off:")}</span><b>${lt.name()}</b><i>›</i>`;
            row.addEventListener("click", () => ui2Open(lastKey));
            wrap.appendChild(row);
        }
        CATS.forEach(cat => {
            const keys = Object.keys(TOOLS).filter(k => TOOLS[k].cat === cat.id && !(DESK && TOOLS[k].pp));
            if (!keys.length) return;
            const lab = document.createElement("div");
            lab.className = "home-cat-label";
            lab.textContent = cat.label();
            wrap.appendChild(lab);
            const grid = document.createElement("div");
            grid.className = "home-grid";
            keys.forEach(k => {
                const t = TOOLS[k];
                const btn = document.createElement("button");
                btn.className = "home-card";
                btn.setAttribute("data-tool", k);
                const badge = t.badge
                    ? `<span class="hc-badge${t.badge === "soon" ? " soon" : ""}">${
                        t.badge === "new" ? L("Yeni", "New") : t.badge === "soon" ? L("Yakında", "Soon") : L("Deneysel", "Beta")}</span>`
                    : "";
                btn.innerHTML = `
                  <span class="hc-art"><svg viewBox="0 0 120 56" xmlns="http://www.w3.org/2000/svg">${(ART[k] || ART.settings)(t.color)}</svg></span>
                  <span class="hc-label">${t.name()}</span>
                  <span class="hc-desc">${t.desc()}</span>
                  ${badge}`;
                btn.title = t.desc();   // full description on hover (desc clamps to 2 lines)
                btn.addEventListener("click", () => ui2Open(k));
                grid.appendChild(btn);
            });
            wrap.appendChild(grid);
        });
        const back = $("page-back-label"); if (back) back.textContent = L("Geri", "Back");
        const badge = $("home-badge-text");
        if (badge) {
            // licence/trial state replaces the "free" badge once selling starts
            // "Çevrimdışı transkripsiyon", not "%100 çevrimdışı": the AI
            // features, stock B-roll and the update check do use the network.
            // An absolute claim on the home screen of a paid product is a
            // claim someone can hold you to — see PRIVACY.md.
            let txt = L("Çevrimdışı transkripsiyon", "Offline transcription");
            try {
                if (window.__licensingEnabled && window.__licenseState) {
                    const st = window.__licenseState();
                    txt = st.status === "licensed" ? L("Çevrimdışı transkripsiyon · lisanslı", "Offline transcription · licensed")
                        : st.status === "trial" ? L(`Çevrimdışı transkripsiyon · deneme ${st.daysLeft} gün`, `Offline transcription · trial ${st.daysLeft}d`)
                        : L("Deneme bitti · Ayarlar'dan lisansla", "Trial ended · license in Settings");
                }
            } catch (e) {}
            badge.textContent = txt;
        }
        const foot = $("home-foot");
        if (foot) foot.textContent = "Subsper v" + (typeof APP_VERSION !== "undefined" ? APP_VERSION : "") + " · zipheron";
        // The header version used to be hardcoded in index.html and had drifted
        // to v1.2.0 while the app shipped as 1.3.0. Fill it from the one source
        // of truth so it cannot drift again.
        const ver = document.querySelector(".brand-version");
        if (ver && typeof APP_VERSION !== "undefined") ver.textContent = "v" + APP_VERSION;
        document.querySelectorAll(".ui2-adv > summary").forEach(s => { s.textContent = L("Ayarlar", "Settings"); });
        const key = document.body.getAttribute("data-ui2page");
        if (key && TOOLS[key]) { const ti = $("page-title"); if (ti) ti.textContent = TOOLS[key].name(); }
    }

    // re-render the shell when the user switches UI language
    const _setLanguage = window.setLanguage;
    if (typeof _setLanguage === "function")
        window.setLanguage = function (lang) { _setLanguage(lang); renderHome(); };

    // Escape returns to the home screen (unless typing in a field)
    document.addEventListener("keydown", e => {
        if (e.key !== "Escape") return;
        if (document.fullscreenElement) return;   // Esc = exit fullscreen only
        const tag = (document.activeElement && document.activeElement.tagName) || "";
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
        if (!document.body.classList.contains("ui2-home")) { e.preventDefault(); ui2Home(); }
    });

    // init after main.js settings load + feature packs (0/10/20) + features-v2 (40)
    setTimeout(() => {
        buildAdv("panel-ed-work", "silence", "#set-silthr");
        buildAdv("panel-au-work", "enhance", "#set-audio-denoise");
        buildAdv("panel-au-work", "beep",    "#set-beepmode");
        try { if (typeof initEditSettingsUI  === "function") initEditSettingsUI(); }  catch (e) {}
        try { if (typeof initAudioSettingsUI === "function") initAudioSettingsUI(); } catch (e) {}
        renderHome();
    }, 80);
})();
