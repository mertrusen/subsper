/* Subsper workspace shell. Presentation and navigation only; existing media,
   transcription, editing and Premiere functions remain the source of truth. */
(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  const desktop = window.IS_DESKTOP === true;
  if (!desktop) document.body.classList.add("premiere-app");
  const tr = () => typeof settings !== "undefined" && settings.uiLang === "tr";
  const L = (a, b) => tr() ? a : b;
  const text = {
    workflow: ["ÇALIŞMA AKIŞI", "WORKFLOW"], home: ["Başlangıç", "Start"],
    transcript: ["Altyazılar", "Subtitles"], style: ["Görünüm", "Style"],
    export: ["Çıktı al", "Export"], tools: ["Araçlar", "Tools"],
    settings: ["Ayarlar", "Settings"], offline: ["Çevrimdışı transkripsiyon", "Offline transcription"]
  };
  const oldOpen = window.ui2Open, oldHome = window.ui2Home, oldGear = window.ui2Gear;
  function page() { return document.body.getAttribute("data-ui3-page") || "subtitles"; }
  function nav(key) {
    document.body.setAttribute("data-ui3-page", key);
    document.querySelectorAll(".v3-nav").forEach(b => {
      const active = b.getAttribute("data-v3-page") === (key === "tool" ? "tools" : key);
      b.classList.toggle("active", active);
      if (active) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
    });
    document.querySelectorAll("[data-v3-text]").forEach(el => {
      const row = text[el.getAttribute("data-v3-text")];
      if (row) el.textContent = L(row[0], row[1]);
    });
    const p = $("v3-tools-page"), e = $("v3-export-page");
    if (p) p.style.display = key === "tools" ? "block" : "none";
    if (e) e.style.display = key === "export" ? "block" : "none";
  }
  window.ui2Home = function () { if (page() === "tool") ui3Open("tools"); else ui2Open("subtitles"); };
  window.ui2Open = function (key) {
    oldOpen(key);
    if (key === "subtitles") nav("subtitles");
    else if (key === "settings") nav("settings");
    else if (!(window.__ui2Tools[key] || {}).overlay) nav("tool");
  };
  window.ui3Open = function (key) {
    if (key === "tools" || key === "export") {
      oldHome(); nav(key);
      if (key === "tools") renderTools(); else renderExport();
      return;
    }
    if (key === "style") {
      if (!desktop) return;
      oldOpen("subtitles");
      switchSubTab("transcribe", "settings");
      document.body.setAttribute("data-ui2page", "style");
      nav("style");
      const title = $("page-title"); if (title) title.textContent = L("Altyazı görünümü", "Subtitle style");
      const gear = $("page-gear"); if (gear) gear.style.display = "none";
      markStyleSections();
    }
  };
  window.ui2Gear = function () {
    oldGear();
    const title = $("page-title");
    if (title && page() === "subtitles") title.textContent =
      currentSubTab.transcribe === "settings" ? L("Transkripsiyon ayarları", "Transcription settings") : L("Altyazılar", "Subtitles");
  };
  function markStyleSections() {
    ["sec_style", "sec_karaoke"].forEach(id => {
      const heading = document.querySelector(`[data-i18n="${id}"]`);
      const group = heading && heading.closest(".setup-section-title");
      if (group) {
        group.classList.add("v3-style-section");
        if (group.nextElementSibling) group.nextElementSibling.classList.add("v3-style-section");
      }
    });
    const preview = $("style-preview");
    if (preview && !$("v3-preview-stage")) {
      const stage = document.createElement("div"); stage.id = "v3-preview-stage";
      preview.parentNode.insertBefore(stage, preview);
      stage.appendChild(preview);
    }
    if (desktop) { buildStyleOptions(); fitStylePreview(); }
  }
  const fontChoices = ["Inter", "Montserrat", "Oswald", "Bebas Neue", "Arial", "Georgia"];
  function buildStyleOptions() {
    const preview = $("style-preview"), item = preview && preview.closest(".setting-item");
    if (!item || $("v3-style-options")) { refreshStyleOptions(); return; }
    const form = document.createElement("div"); form.id = "v3-style-options";
    form.innerHTML = `<label><span>${L("Yazı tipi", "Font")}</span><select id="v3-font-select" aria-label="${L("Yazı tipi", "Font")}"></select></label>
      <label><span>${L("Animasyon", "Animation")}</span><select id="v3-animation-select"><option value="none">${L("Yok", "None")}</option><option value="fade">${L("Yumuşak giriş/çıkış", "Fade in / out")}</option><option value="pop">${L("Pop", "Pop")}</option><option value="bounce">${L("Sekme", "Bounce")}</option></select></label>
      <label class="v3-duration"><span>${L("Geçiş süresi", "Transition time")} <b id="v3-duration-value"></b></span><input type="range" id="v3-duration" min="80" max="700" step="20"></label>
      <button type="button" id="v3-replay" class="v3-option-button">${L("Önizlemeyi oynat", "Replay preview")}</button>
      <p class="v3-style-note">${L("Animasyon ASS ve videoya gömülü çıktıda görünür. SRT/VTT ve Premiere'in yerel caption katmanı animasyon taşımaz.", "Animation appears in ASS and burned-in video. SRT/VTT and Premiere native caption tracks do not carry it.")}</p>`;
    const chips = $("style-chips");
    if (chips && chips.parentNode === item) chips.insertAdjacentElement("afterend", form); else item.appendChild(form);
    const sel = $("v3-font-select");
    sel.onchange = () => {
      const active = getActivePreset();
      settings.stylePreset = "custom";
      settings.customStyle = { ...active, font: sel.value };
      saveSettings(); renderStyleChips();
      if (typeof populateCustomForm === "function") populateCustomForm();
      updateStylePreview();
    };
    $("v3-animation-select").onchange = e => { onSettingChange("styleAnimation", e.target.value); refreshStyleOptions(); };
    $("v3-duration").oninput = e => {
      onSettingChange("styleAnimationMs", +e.target.value);
      $("v3-duration-value").textContent = e.target.value + " ms";
      replayStylePreview();
    };
    $("v3-replay").onclick = replayStylePreview;
    if (desktop && typeof window.addUserFont === "function") {
      const add = document.createElement("button"); add.type = "button"; add.className = "v3-option-button";
      add.textContent = L("Font dosyası ekle…", "Add font file…");
      add.onclick = async () => { await window.addUserFont(); refreshStyleOptions(); };
      form.insertBefore(add, form.querySelector(".v3-style-note"));
    }
    refreshStyleOptions();
  }
  function refreshStyleOptions() {
    const sel = $("v3-font-select"); if (!sel) return;
    const active = getActivePreset();
    const choices = fontChoices.slice();
    if (active.font && !choices.includes(active.font)) choices.push(active.font);
    sel.replaceChildren();
    choices.forEach(name => { const option = document.createElement("option"); option.value = name; option.textContent = name; sel.appendChild(option); });
    sel.value = active.font;
    const anim = $("v3-animation-select"); if (anim) anim.value = settings.styleAnimation || "none";
    const duration = $("v3-duration");
    if (duration) { duration.value = settings.styleAnimationMs || 220; duration.disabled = !settings.styleAnimation || settings.styleAnimation === "none"; }
    const value = $("v3-duration-value"); if (value) value.textContent = (settings.styleAnimationMs || 220) + " ms";
    const stage = $("v3-preview-stage"); if (stage) stage.dataset.effect = settings.styleAnimation || "none";
    const text = $("style-preview-text");
    if (text && !text.querySelector(".v3-sample-word")) {
      const sample = document.createElement("span"); sample.className = "v3-sample-word";
      sample.textContent = text.textContent; text.replaceChildren(sample);
    }
    replayStylePreview();
  }
  function replayStylePreview() {
    const sample = document.querySelector("#style-preview-text .v3-sample-word");
    if (!sample) return;
    sample.style.animation = "none";
    void sample.offsetWidth;
    sample.style.animation = "";
  }
  function fitStylePreview() {
    const stage = $("v3-preview-stage");
    if (!stage) return;
    const ar = Math.max(.4, Math.min(3, Number(window.__videoAR) || 16 / 9));
    const available = Math.max(120, stage.clientWidth || 600);
    const height = Math.min(250, Math.floor(available / ar));
    stage.style.setProperty("--v3-preview-width", Math.floor(height * ar) + "px");
    stage.style.setProperty("--v3-preview-height", height + "px");
  }
  window.__v3RenderHome = function () {
    const version = document.querySelector(".brand-version");
    if (version && typeof APP_VERSION !== "undefined") version.textContent = "v" + APP_VERSION;
    nav(page());
  };
  function renderTools() {
    const area = $("v3-tools-page"); if (!area) return;
    const tools = window.__ui2Tools || {};
    const groups = [
      ["text", L("Metin ve altyazı", "Text and captions")],
      ["time", L("Kurgu ve zamanlama", "Editing and timing")],
      ["audio", L("Ses", "Audio")],
      ["make", L("İçerik ve çıktı", "Content and output")]
    ];
    area.innerHTML = `<div class="v3-page-head"><div class="v3-eyebrow">${L("ARAÇ KÜTÜPHANESİ", "TOOL LIBRARY")}</div><h1>${L("İhtiyacın olan aracı seç.", "Pick the tool you need.")}</h1><p>${L("Her araç kendi ayarları ve sonucu ile açılır. İşe altyazıdan başlayabilirsin.", "Each tool opens with its own settings and results. You can start with subtitles.")}</p><input id="v3-tool-search" type="search" placeholder="${L("Araç ara…", "Search tools…")}" aria-label="${L("Araç ara", "Search tools")}"></div><div id="v3-tool-groups"></div>`;
    const host = $("v3-tool-groups");
    groups.forEach(([group, label]) => {
      const entries = Object.keys(tools).filter(k => tools[k].group === group && k !== "subtitles" && !(desktop && tools[k].pp));
      if (!entries.length) return;
      const sec = document.createElement("section"); sec.className = "v3-tool-group";
      const h = document.createElement("h2"); h.textContent = label; sec.appendChild(h);
      const grid = document.createElement("div"); grid.className = "v3-tool-grid";
      entries.forEach(k => {
        const t = tools[k]; const b = document.createElement("button");
        b.className = "v3-tool"; b.dataset.search = (t.name() + " " + t.desc()).toLocaleLowerCase();
        const dot = document.createElement("span"); dot.className = "v3-tool-dot"; dot.style.background = t.color || "var(--accent)";
        const c = document.createElement("span"); c.className = "v3-tool-copy";
        const title = document.createElement("strong"); title.textContent = t.name();
        const desc = document.createElement("small"); desc.textContent = t.desc();
        c.append(title, desc); const arrow = document.createElement("span"); arrow.textContent = "↗";
        b.append(dot, c, arrow); b.onclick = () => ui2Open(k); grid.appendChild(b);
      });
      sec.appendChild(grid); host.appendChild(sec);
    });
    const search = $("v3-tool-search");
    search.oninput = () => {
      const q = search.value.trim().toLocaleLowerCase();
      host.querySelectorAll(".v3-tool").forEach(b => b.style.display = b.dataset.search.includes(q) ? "" : "none");
      host.querySelectorAll(".v3-tool-group").forEach(s => s.style.display = s.querySelector('.v3-tool:not([style*="display: none"])') ? "" : "none");
    };
  }
  function renderExport() {
    const area = $("v3-export-page"); if (!area) return;
    const count = typeof segments !== "undefined" && Array.isArray(segments) ? segments.length : 0;
    area.innerHTML = `<div class="v3-page-head"><div class="v3-eyebrow">${L("SON ADIM", "FINAL STEP")}</div><h1>${L("Çalışmanı dışa aktar.", "Export your work.")}</h1><p>${count ? L(`${count} altyazı hazır. Uygun çıktıyı seç.`, `${count} captions ready. Choose an output.`) : L("Henüz altyazı yok. Önce yazıya dökebilir veya SRT yükleyebilirsin.", "No captions yet. Transcribe or load an SRT first.")}</p></div>
      <div class="v3-export-layout"><section class="v3-export-card"><div class="v3-card-kicker">01 · ${L("ALTYAZI DOSYASI", "SUBTITLE FILE")}</div><h2>${L("Düzenlenebilir altyazılar", "Editable captions")}</h2><p>${L("Kurgu, platform veya başka uygulamada kullanmak için.", "For editing, platforms, or another app.")}</p><div class="v3-format-grid" id="v3-formats"></div></section>
      <section class="v3-export-card"><div class="v3-card-kicker">02 · ${desktop ? L("VİDEO", "VIDEO") : "PREMIERE"}</div><h2>${desktop ? L("Videoya yerleştir", "Put it on video") : L("Zaman çizelgesine gönder", "Send to timeline")}</h2><p>${desktop ? L("Stilli altyazıyı videoya göm veya dikey klip oluştur.", "Burn styled captions into video or create a vertical clip.") : L("Altyazıları etkin sekansa ekle.", "Add captions to the active sequence.")}</p><div id="v3-video-actions" class="v3-export-actions"></div>${desktop ? "" : `<p class="v3-premiere-style-note">${L("Yeni caption track, Premiere'in varsayılan altyazı fontunu kullanır. Kayıtlı Track Style'ını yeni track'e Premiere içinde uygula. Önceki track korunur.", "The new caption track uses Premiere's default subtitle font. Apply your saved Track Style to the new track in Premiere. The previous track is kept.")}</p>`}</section>
      <section class="v3-export-card v3-export-card-wide"><div class="v3-card-kicker">03 · ${L("PROJE", "PROJECT")}</div><h2>${L("Sonra devam et", "Continue later")}</h2><p>${L("Altyazı, stil ve ayarları birlikte sakla.", "Keep captions, style, and settings together.")}</p><div id="v3-project-actions" class="v3-export-actions"></div></section></div>
      <button class="v3-text-action" id="v3-back-to-captions">← ${L("Altyazılara dön", "Back to subtitles")}</button>`;
    const formats = $("v3-formats");
    [["srt", "SRT", L("En yaygın biçim", "Most compatible")], ["vtt", "VTT", L("Web videosu", "Web video")], ...(desktop ? [["ass", "ASS", L("Stilli altyazı", "Styled subtitles")]] : []), ["txt", "TXT", L("Yalnızca metin", "Plain text")]].forEach(([fmt, title, desc]) => {
      const b = document.createElement("button"); b.className = "v3-format"; b.disabled = !count;
      b.innerHTML = `<strong>.${title.toLowerCase()}</strong><span>${desc}</span><b>↓</b>`;
      b.onclick = () => exportAs(fmt); formats.appendChild(b);
    });
    const addProxy = (hostId, source, label) => {
      const host = $(hostId); if (!host || !source) return;
      const b = document.createElement("button"); b.className = "v3-output-button";
      b.disabled = !count && hostId !== "v3-project-actions";
      b.textContent = label || source.textContent.trim(); b.onclick = () => source.click(); host.appendChild(b);
    };
    if (!desktop) addProxy("v3-video-actions", $("send-btn"), L("Altyazıyı Premiere'e gönder", "Send captions to Premiere"));
    document.querySelectorAll("#export-grp-files button, #export-grp-video button, #export-grp-premiere button").forEach(b => {
      if (!desktop && b.textContent.toLowerCase().includes("mogrt")) return;
      const host = b.closest("#export-grp-files") ? "v3-formats" : "v3-video-actions";
      if (host === "v3-formats") { const p = document.createElement("button"); p.className = "v3-format v3-format-extra"; p.disabled = !count; p.textContent = b.textContent.trim(); p.onclick = () => b.click(); formats.appendChild(p); }
      else addProxy(host, b);
    });
    document.querySelectorAll("#export-grp-project button").forEach(b => addProxy("v3-project-actions", b));
    if (!$("v3-project-actions").children.length) {
      [[L("Projeyi kaydet", "Save project"), saveProject], [L("Proje aç", "Open project"), openProject]].forEach(([label, fn]) => {
        const b = document.createElement("button"); b.className = "v3-output-button"; b.textContent = label; b.onclick = fn; $("v3-project-actions").appendChild(b);
      });
    }
    $("v3-back-to-captions").onclick = () => ui2Open("subtitles");
  }
  setTimeout(() => {
    markStyleSections();
    if (!desktop) {
      const number = document.querySelector('.v3-nav[data-v3-page="export"] .v3-nav-num');
      if (number) number.textContent = "02";
    }
    const version = document.querySelector(".brand-version");
    if (version && typeof APP_VERSION !== "undefined") version.textContent = "v" + APP_VERSION;
    oldOpen("subtitles"); nav("subtitles");
  }, 120);
  setTimeout(() => {
    const update = window.updateStylePreview;
    if (typeof update === "function") window.updateStylePreview = function () {
      const result = update.apply(this, arguments);
      fitStylePreview();
      refreshStyleOptions();
      return result;
    };
    window.addEventListener("resize", fitStylePreview);
  }, 220);
  const changeLanguage = window.setLanguage;
  if (typeof changeLanguage === "function") window.setLanguage = function (lang) {
    changeLanguage(lang);
    nav(page());
    const form = $("v3-style-options"); if (form) form.remove();
    buildStyleOptions();
  };
})();
