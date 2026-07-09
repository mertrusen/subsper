/* Subsper UI v2 — card home + isolated tool pages. EXTENSION ONLY.
   Loaded after main.js; the desktop app never loads this file.
   Pure navigation/presentation shell over main.js's state machine:
   - each home card opens ONE tool — sibling tools in the same underlying
     panel are hidden (applyView), so Cut Silences and Auto Zoom no longer
     land on the same mixed page;
   - each tool's settings are MOVED from its hidden settings sub-panel into
     a collapsed <details class="ui2-adv"> on the tool page itself (element
     IDs keep working — main.js only looks things up by ID). */
(function () {
    "use strict";

    const L = (tr, en) =>
        (typeof settings !== "undefined" && settings.uiLang === "tr") ? tr : en;

    const TOOLS = {
        subtitles: { tab: "transcribe", gear: true,
                     title: () => L("Altyazı Oluştur", "Subtitles") },
        silence:   { tab: "edit", badge: true,
                     title: () => L("Sessizlikleri Kes", "Cut Silences") },
        filler:    { tab: "edit", badge: true,
                     title: () => L("Dolgu Kelimeleri Kes", "Cut Filler Words") },
        zoom:      { tab: "edit", badge: true,
                     title: () => L("Otomatik Zoom", "Auto Zoom") },
        beep:      { tab: "audio",
                     title: () => L("Küfür Sansürü", "Beep Profanity") },
        enhance:   { tab: "audio",
                     title: () => L("Sesi İyileştir", "Enhance Audio") },
        ai:        { tab: "transcribe",
                     title: () => L("AI Araçları", "AI Tools"),
                     open: () => {
                         const p = $("ai-panel");
                         if (p && p.style.display === "none" && typeof toggleAiPanel === "function") toggleAiPanel();
                     } },
        settings:  { tab: "setup",
                     title: () => L("Ayarlar", "Settings") },
        help:      { overlay: true,
                     title: () => L("Yardım", "Help"),
                     open: () => {
                         localStorage.removeItem("ws_onboarded");
                         if (typeof maybeShowOnboarding === "function") maybeShowOnboarding();
                     } },
    };

    // Which single card (identified by an element inside it) each tool shows,
    // inside which shared panel. Everything else in that panel is hidden.
    const VIEWS = {
        silence: { panel: "panel-ed-work", show: "#silence-btn" },
        zoom:    { panel: "panel-ed-work", show: "#zoom-btn" },
        filler:  { panel: "panel-ed-work", show: "#filler-cut-btn" },
        enhance: { panel: "panel-au-work", show: "#enhance-btn" },
        beep:    { panel: "panel-au-work", show: "button[onclick^='beepProfanityAction']" },
    };
    const VIEW_PANELS = ["panel-ed-work", "panel-au-work"];

    function scrollOf(panelId) {
        return document.querySelector("#" + panelId + " .setup-scroll");
    }

    // Show only the active tool's card + its own settings <details>; hide the
    // uppercase section titles too (the page bar already names the tool).
    function applyView(key) {
        const v = VIEWS[key];
        VIEW_PANELS.forEach(pid => {
            const scroll = scrollOf(pid); if (!scroll) return;
            const active = v && v.panel === pid;
            Array.prototype.forEach.call(scroll.children, ch => {
                let show = true;
                if (active) {
                    if (ch.classList.contains("ui2-adv")) show = ch.getAttribute("data-for") === key;
                    else show = !!(ch.querySelector(v.show) || (ch.matches && ch.matches(v.show)));
                }
                ch.style.display = show ? "" : "none";
            });
            if (active) scroll.scrollTop = 0;
        });
    }

    // Move a tool's settings card(s) out of the (now unreachable) settings
    // sub-panel into a collapsed "Settings" box on the tool page itself.
    function buildAdv(panelId, key, innerSel) {
        const scroll = scrollOf(panelId); if (!scroll) return;
        if (scroll.querySelector('.ui2-adv[data-for="' + key + '"]')) return;
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

    window.ui2Open = function (key) {
        const t = TOOLS[key]; if (!t) return;
        if (t.overlay) { if (t.open) try { t.open(); } catch (e) {} return; } // stays on home
        document.body.classList.remove("ui2-home");
        document.body.setAttribute("data-ui2page", key);
        if (t.tab === "setup") { switchMainTab("setup"); switchSubTab("setup", "main"); }
        else { switchMainTab(t.tab); switchSubTab(t.tab, "work"); }
        if (t.open) try { t.open(); } catch (e) {}
        applyView(key);
        const title = $("page-title"); if (title) title.textContent = t.title();
        const gear = $("page-gear");
        if (gear) { gear.style.display = t.gear ? "inline-flex" : "none"; gear.classList.remove("active"); }
    };

    window.ui2Home = function () {
        document.body.classList.add("ui2-home");
        document.body.removeAttribute("data-ui2page");
    };

    // Gear = the big Subtitles settings sub-tab (only tool that still has one)
    window.ui2Gear = function () {
        const key = document.body.getAttribute("data-ui2page");
        const t = TOOLS[key]; if (!t || !t.gear) return;
        const next = currentSubTab[t.tab] === "settings" ? "work" : "settings";
        switchSubTab(t.tab, next);
        const gear = $("page-gear");
        if (gear) gear.classList.toggle("active", next === "settings");
    };

    function applyLabels() {
        document.querySelectorAll(".home-card").forEach(btn => {
            const t = TOOLS[btn.getAttribute("data-tool")]; if (!t) return;
            const lab = btn.querySelector(".hc-label"); if (lab) lab.textContent = t.title();
            const b = btn.querySelector(".hc-badge");
            if (b) {
                b.style.display = t.badge ? "" : "none";
                if (t.badge) b.textContent = L("Deneysel", "Beta");
            }
        });
        document.querySelectorAll(".ui2-adv > summary").forEach(s => {
            s.textContent = L("Ayarlar", "Settings");
        });
        const back = $("page-back-label"); if (back) back.textContent = L("Geri", "Back");
        const badge = $("home-badge-text");
        if (badge) badge.textContent = L("%100 çevrimdışı · ücretsiz", "100% offline · free");
        const foot = $("home-foot");
        if (foot) foot.textContent = "Subsper v" + (typeof APP_VERSION !== "undefined" ? APP_VERSION : "") + " · zipheron";
        const key = document.body.getAttribute("data-ui2page");
        if (key && TOOLS[key]) { const ti = $("page-title"); if (ti) ti.textContent = TOOLS[key].title(); }
    }

    // Re-localize the shell when the user switches UI language
    const _setLanguage = window.setLanguage;
    if (typeof _setLanguage === "function")
        window.setLanguage = function (lang) { _setLanguage(lang); applyLabels(); };

    document.querySelectorAll(".home-card").forEach(btn =>
        btn.addEventListener("click", () => ui2Open(btn.getAttribute("data-tool"))));

    // Init after main.js has loaded saved settings and the feature packs
    // (setTimeout 0/10/20) have injected the filler-cut and beep cards.
    setTimeout(() => {
        buildAdv("panel-ed-work", "silence", "#set-silthr");        // detection sliders
        buildAdv("panel-ed-work", "zoom",    "#set-zoomamt");       // zoom amount + style
        buildAdv("panel-au-work", "enhance", "#set-audio-denoise"); // denoise + normalize
        buildAdv("panel-au-work", "beep",    "#set-beepmode");      // mode/shift/pad/duck
        // Their init fns normally run on sub-tab switch, which no longer
        // happens — populate the moved controls with saved values now.
        try { if (typeof initEditSettingsUI  === "function") initEditSettingsUI(); }  catch (e) {}
        try { if (typeof initAudioSettingsUI === "function") initAudioSettingsUI(); } catch (e) {}
        applyLabels();
    }, 80);
})();
