/* desktop-app.js — loaded AFTER main.js.
   main.js defines its functions with `function` declarations (mutable bindings),
   so here we override the Premiere-specific ones with file-based desktop versions.
   All the pure logic (smart split, exports, karaoke, clean-up, settings) is reused
   from main.js untouched. */

(function () {
  const { ipcRenderer } = require("electron");
  const fsD   = require("fs");
  const pathD = require("path");
  const osD   = require("os");
  const { spawn: spawnD } = require("child_process");

  // Bundled zero-setup engine (whisper.cpp). Pure-Node module next to main.js.
  let WCPP = null;
  try { WCPP = require(pathD.join(window.__APP_DIR__, "js", "whispercpp.js")); }
  catch (e) { console.error("[Desktop] whispercpp module load failed:", e); }
  if (WCPP) {
    try {
      const logFile = pathD.join(pathD.dirname(WCPP.modelsDir()), "subsper.log");
      WCPP.setLogger({ file: logFile, sink: l => console.log("[engine]", l) });
      WCPP.dbg("=== Subsper desktop start " + new Date().toISOString() +
               " | " + process.platform + "/" + process.arch + " ===");
      WCPP.dbg("whisper=" + WCPP.whisperBin(window.__APP_DIR__) + " | ffmpeg=" + WCPP.ffmpegBin(window.__APP_DIR__));
      window.__SUBSPER_LOG__ = logFile;
    } catch (e) { console.error(e); }
  }
  if (WCPP && WCPP.cleanupStaleDownloads) {
    try { WCPP.cleanupStaleDownloads(); } catch (e) {}
  }

  // ── Desktop state ─────────────────────────────────────────────────────────
  let mediaPath = null;       // currently loaded video/audio file
  let _transcribeAbort = null;   // AbortController for cancelling transcription
  let mediaEl   = null;       // <video> used for preview + playback
  let subOverlay = null;      // styled subtitle overlay rendered on the video

  const MEDIA_EXTS = ["mp4","mov","m4v","mkv","webm","avi","mp3","wav","m4a","aac","flac","ogg","wmv"];

  function fileUrl(p) {
    // Cross-platform file:// URL (Windows needs forward slashes + leading slash)
    let n = p.replace(/\\/g, "/");
    if (!n.startsWith("/")) n = "/" + n;
    return "file://" + encodeURI(n).replace(/#/g, "%23");
  }

  // Python discovery is handled by main.js's findPython() — now cross-platform
  // (probes `py`/`python`/`python3` + common Windows install paths). No override here.

  // extDir → the app directory injected by the shim (where scripts/ lives)
  extDir = function () { return window.__APP_DIR__; };

  // No ExtendScript in desktop
  loadHostJSX = function () { return Promise.resolve(); };
  evalScript  = function () { return Promise.resolve({ success: false, error: "Not available in desktop mode" }); };

  // ── File pickers (via main process dialogs) ───────────────────────────────
  async function pickMedia() {
    const res = await ipcRenderer.invoke("dialog:openMedia");
    if (res && res.filePath) loadMedia(res.filePath);
  }

  function loadMedia(p) {
    mediaPath = p;
    if (mediaEl) {
      mediaEl.src = fileUrl(p);
      mediaEl.style.display = "block";
      mediaEl.load();
    }
    const name = p.split(/[\\/]/).pop();
    const lbl = document.getElementById("media-name");
    if (lbl) lbl.textContent = name;
    setStatus("Loaded: " + name + " — click Transcribe", "success");
    const tb = document.getElementById("transcribe-btn");
    if (tb) tb.disabled = false;
  }

  // Drag & drop onto the window
  function wireDragDrop() {
    document.addEventListener("dragover", e => { e.preventDefault(); });
    document.addEventListener("drop", e => {
      e.preventDefault();
      if (!e.dataTransfer.files.length) return;
      const f = e.dataTransfer.files[0];
      const ext = (f.name.split(".").pop() || "").toLowerCase();
      if (MEDIA_EXTS.includes(ext)) loadMedia(f.path);
      else if (ext === "srt") { try { _loadSRTData(fsD.readFileSync(f.path, "utf8"), f.name); } catch (er) { console.warn("SRT import error:", er); } }
      else showToast("Unsupported file type: ." + ext, "error");
    });
  }

  // ── Transcription (file-based, reuses main.js helpers) ────────────────────
  // Bundled engine path: download model (once) → ffmpeg to 16 kHz WAV → whisper.cpp.
  // Returns the same shape as runPython("transcribe.py") so the rest of the flow
  // is identical. No Python needed.
  async function transcribeViaCpp(inputPath, modelKey, language, signal) {
    try {
      if (!WCPP.modelExists(modelKey)) {
        setStatus(`Downloading ${modelKey} model… (one-time)`, "info");
        await WCPP.ensureModel(modelKey, (frac, got, total, phase) =>
          setStatus(phase ? `Reconnecting… (download resumes automatically)`
                          : `Downloading ${modelKey} model… ${Math.round(frac * 100)}%`, "info"));
      }
      setStatus("Preparing audio… 0%", "info");
      const wav = pathD.join(osD.tmpdir(), `subsper_${Date.now()}.wav`);
      await WCPP.toWav16k(extDir(), inputPath, wav, {}, signal,
        f => setStatus(`Preparing audio… ${Math.round(f * 100)}%`, "info"));

      setStatus(`Loading ${modelKey} model…`, "info");
      const r = await WCPP.transcribeWav({
        appDir: extDir(), wavPath: wav, modelKey, language, signal,
        threads: settings.threads || 0,
        forceCpu: settings.hwAccel === "cpu",
        initialPrompt: settings.promptWords || "",
        onLog: s => {
          if (s === "__ENGINE_STARTED__") { setStatus("Transcribing… 0%", "info"); return; }
          const m = /progress\s*=\s*(\d+)\s*%/i.exec(s); if (m) setStatus(`Transcribing… ${m[1]}%`, "info");
        },
      });
      try { fsD.unlinkSync(wav); } catch (e) {}
      return { success: true, segments: r.segments, text: r.text, language: r.language, engine: "whisper.cpp", notes: [] };
    } catch (e) {
      const log = WCPP ? WCPP.recentLog(22) : "";
      const lp  = WCPP && WCPP.logPath() ? WCPP.logPath() : "";
      let msg = (e && e.message) || String(e);
      if (lp)  msg += "\n\nFull log: " + lp;
      if (log) msg += "\n\n— last steps —\n" + log;
      return { success: false, error: msg };
    }
  }

  startTranscription = async function () {
    if (isRunning) return;
    if (!mediaPath) { showToast("Open a video/audio file first", "info", 2500); pickMedia(); return; }
    isRunning = true;
    _transcribeAbort = new AbortController();
    const transcribeBtn = document.getElementById("transcribe-btn");
    const sendBtn = document.getElementById("send-btn");
    if (transcribeBtn) transcribeBtn.disabled = true;
    const actionsBar = document.getElementById("actions-bar");
    if (actionsBar) actionsBar.style.display = "none";
    hideError();

    const model    = document.getElementById("model-select").value;
    const language = document.getElementById("lang-select").value;

    try {
      showProgress(true);

      // Engine routing: the bundled whisper.cpp is the default zero-setup engine.
      // Python engines (whisperx/mlx/openai) are the optional "Pro" path — used
      // when explicitly chosen, or when diarization (speaker labels) is on.
      const wantPython = settings.diarize ||
                         ["whisperx", "mlx", "openai"].indexOf(settings.engine) !== -1;
      const useCpp = WCPP && !wantPython;
      if (!wantPython && !WCPP) {
        handleError("Built-in engine failed to load — reinstall the app.\n(Details in the engine log.)");
        return;
      }

      let txRes;
      if (useCpp) {
        txRes = await transcribeViaCpp(mediaPath, model, language, _transcribeAbort.signal);
      } else {
        const engLabel = { whisperx:"WhisperX", mlx:"mlx-whisper", openai:"openai-whisper", auto:"Whisper" }[settings.engine] || "Whisper";
        setStatus(`Transcribing with ${engLabel} (Pro/Python)…`, "info");
        txRes = await runPython("transcribe.py",
          [mediaPath, model, language, settings.engine, settings.diarize ? "1" : "0"],
          stderr => { if (/download/i.test(stderr)) setStatus("Downloading model… (one-time)", "info"); });
      }

      if (!txRes.success) { handleError(txRes.error || "Transcription failed."); return; }

      lastLanguage = txRes.language || (language !== "auto" ? language : "");
      seqInTime = 0;

      let segs;
      try {
        segs = (txRes.segments || [])
          .filter(s => s != null && s.start != null && s.end != null)
          .map((s, i) => ({
            id: i, start: Number(s.start) || 0, end: Number(s.end) || 0,
            text: (s.text == null ? "" : String(s.text)),
            words: (s.words || []).filter(w => w != null && w.start != null && w.end != null),
            speaker: s.speaker || null,
          }));
        if (settings.autoSplit) segs = applySmartSplit(segs, settings);
      } catch (procErr) {
        console.error("[Desktop] processing failed:", procErr);
        segs = (txRes.segments || []).filter(s => s && s.start != null).map((s, i) => ({
          id: i, start: Number(s.start)||0, end: Number(s.end)||0, text: String(s.text||""), words: [], speaker: s.speaker||null,
        }));
      }

      // No timeline offset on desktop
      segments = segs.map(s => ({ ...s, seqStart: s.start, seqEnd: s.end }));
      renderSegments();

      if (segments.length === 0) {
        setStatus("No speech detected. Try another model/language.", "warning");
      } else {
        const lang = txRes.language ? ` · ${txRes.language}` : "";
        const note = (txRes.notes && txRes.notes.length) ? ` · ${txRes.notes[0]}` : "";
        setStatus(`Done — ${segments.length} segment(s)${lang}${note}`, "success");
        if (actionsBar) actionsBar.style.display = "flex";
        updateSegCount();
        if (settings.diarize && !segments.some(s => s.speaker))
          showToast("Speaker labels need a HuggingFace token (Settings).", "info", 6000);
        if (settings.autoCleanup) {
          const d = applyDictionary({ silent:true }), f = removeFillers({ silent:true });
          renderSegments(); reselect();
          if (d + f > 0) showToast(`Auto clean-up: ${d} dict · ${f} fillers`, "info", 4000);
        }
      }
    } catch (e) {
      console.error("[Desktop] transcription error:", e);
      handleError(e && e.message ? e.message : String(e));
    } finally {
      isRunning = false;
      _transcribeAbort = null;
      showProgress(false);
      if (transcribeBtn) transcribeBtn.disabled = false;
      if (sendBtn) sendBtn.disabled = segments.length === 0;
    }
  };

  // Cancel a running transcription
  window.cancelTranscription = function () {
    if (_transcribeAbort) {
      _transcribeAbort.abort();
      showToast("Cancelling transcription…", "info", 2000);
    }
  };

  // ── Playback (HTML5 media element) ────────────────────────────────────────
  playPause = async function () {
    const btn = document.getElementById("playpause-btn");
    if (!mediaEl || !mediaPath) { showToast("Open a file first", "info", 2000); return; }
    if (mediaEl.paused) { await mediaEl.play().catch(e => console.warn("Play error:", e)); }
    else mediaEl.pause();
    if (btn) {
      const playing = !mediaEl.paused;
      btn.innerHTML = playing ? "⏸&nbsp; Pause" : "▶&nbsp; Play";
      btn.classList.toggle("playing", playing);
    }
  };

  seekToSegment = async function (idx) {
    const seg = segments[idx];
    if (!seg) return;
    selectSegment(idx);
    if (mediaEl && mediaPath) {
      mediaEl.currentTime = seg.seqStart;
      await mediaEl.play().catch(e => console.warn("Seek play error:", e));
      const btn = document.getElementById("playpause-btn");
      if (btn) { btn.innerHTML = "⏸&nbsp; Pause"; btn.classList.add("playing"); }
    }
  };

  // ── Export → "Send" becomes "Save SRT" (export menu also available) ───────
  sendToPremiere = async function () {
    if (segments.length === 0) return;
    await desktopExport("srt");
  };

  // Override exportAs to use a native save dialog
  exportAs = async function (fmt) {
    const menu = document.getElementById("export-menu");
    if (menu) menu.style.display = "none";
    if (segments.length === 0) { showToast("Nothing to export yet", "info", 2000); return; }
    await desktopExport(fmt);
  };

  async function desktopExport(fmt) {
    const builders = { srt: segmentsToSRT, vtt: segmentsToVTT, ass: segmentsToASS, txt: segmentsToTXT };
    const builder = builders[fmt];
    if (!builder) return;
    const content = builder();
    const base = mediaPath ? mediaPath.split(/[\\/]/).pop().replace(/\.[^.]+$/, "") : "captions";
    const res = await ipcRenderer.invoke("dialog:saveFile", { defaultName: `${base}.${fmt}`, ext: fmt });
    if (!res || !res.filePath) return;
    try {
      fsD.writeFileSync(res.filePath, content, "utf8");
      setStatus(`Exported ${fmt.toUpperCase()} → ${res.filePath}`, "success");
      showToast(`Saved ${fmt.toUpperCase()}`, "success");
    } catch (e) {
      showToast("Export failed: " + e.message, "error", 5000);
    }
  }

  // ── Audio enhancement (file in → file out) ────────────────────────────────
  enhanceAudio = async function () {
    if (!mediaPath) { showToast("Open a file first", "info", 2000); return; }
    const btn = document.getElementById("enhance-btn");
    if (btn) btn.disabled = true;
    setStatus("Enhancing audio (denoise + normalize)…", "info");
    showProgress(true);
    try {
      const res = await ipcRenderer.invoke("dialog:saveFile",
        { defaultName: baseName() + "_enhanced.wav", ext: "wav" });
      if (!res || !res.filePath) { setStatus("Cancelled", "info"); return; }
      if (WCPP) {
        await WCPP.enhanceMedia(extDir(), mediaPath, res.filePath,
          settings.audioDenoise, settings.audioNormalize, {});
      } else {
        const enh = await runPython("enhance_audio.py",
          [mediaPath, res.filePath, settings.audioDenoise ? "1":"0", settings.audioNormalize ? "1":"0"]);
        if (!enh.success) { handleError(enh.error || "Enhancement failed."); return; }
      }
      setStatus(`✓ Enhanced audio saved → ${res.filePath}`, "success");
      showToast("Enhanced audio saved", "success");
    } catch (e) { handleError(e.message); }
    finally { showProgress(false); if (btn) btn.disabled = false; }
  };

  // ── Silence cut (produces a trimmed media file) ───────────────────────────
  cutSilences = async function () {
    if (!mediaPath) { showToast("Open a file first", "info", 2000); return; }
    const btn = document.getElementById("silence-cut-btn");
    if (btn) btn.disabled = true;
    setSilenceStatus("Detecting silences…", "info");
    showSilenceProgress(true);
    try {
      // 1) Detect silence ranges on the source file (bundled ffmpeg; Python fallback)
      let silences;
      if (WCPP) {
        silences = await WCPP.detectSilence(extDir(), mediaPath,
          settings.silenceThreshold, settings.silenceMinDur, {});
      } else {
        const det = await runPython("detect_silence.py",
          [mediaPath, String(settings.silenceThreshold), String(settings.silenceMinDur)]);
        if (!det.success) { setSilenceStatus(det.error || "Detection failed", "error"); return; }
        silences = det.silences || [];
      }
      if (!silences.length) { setSilenceStatus("No silences found.", "warning"); showToast("No silences found", "info"); return; }

      // 2) Total duration from the media element (fallback: last silence end + 1)
      let dur = (mediaEl && isFinite(mediaEl.duration) && mediaEl.duration > 0)
        ? mediaEl.duration : (silences[silences.length - 1].end + 1);

      // 3) Compute KEEP (speech) ranges = complement of silences, with padding
      const pad = Math.max(0, parseFloat(settings.silencePad) || 0);
      const cuts = silences.map(s => [Math.min(dur, s.start + pad), Math.max(0, s.end - pad)])
                           .filter(([a, b]) => b - a > 0.08);
      if (!cuts.length) { setSilenceStatus("Silences too short after padding.", "warning"); return; }

      // Preview modal — user can uncheck gaps to keep, then we export the trim.
      setSilenceStatus(`${cuts.length} silent gap(s) found — review & apply`, "info");
      showRangePreview("Cut silences (export trimmed file)",
        cuts.map(([a, b]) => ({ start: a, end: b })), async (chosen) => {
        showSilenceProgress(true);
        const btn2 = document.getElementById("silence-cut-btn");
        if (btn2) btn2.disabled = true;
        try {
          const keep = [];
          let cursor = 0;
          for (const r of chosen.slice().sort((x, y) => x.start - y.start)) {
            if (r.start > cursor) keep.push([cursor, r.start]);
            cursor = Math.max(cursor, r.end);
          }
          if (cursor < dur) keep.push([cursor, dur]);
          const kept = keep.filter(([a, b]) => b - a > 0.05);
          if (!kept.length) { setSilenceStatus("Nothing left after cutting — lower padding.", "warning"); return; }

          const inExt = (mediaPath.split(".").pop() || "mp4").toLowerCase();
          const isAudio = ["mp3","wav","m4a","aac","flac","ogg"].includes(inExt);
          const outExt = isAudio ? inExt : "mp4";
          const res = await ipcRenderer.invoke("dialog:saveFile",
            { defaultName: baseName() + "_cut." + outExt, ext: outExt });
          if (!res || !res.filePath) { setSilenceStatus("Cancelled", "info"); return; }

          setSilenceStatus(`Cutting ${chosen.length} gap(s)…`, "info");
          if (WCPP) {
            await WCPP.cutMedia(extDir(), mediaPath, res.filePath, kept, { video: !isAudio });
          } else {
            const cut = await runPython("cut_media.py",
              [mediaPath, res.filePath, JSON.stringify(kept)]);
            if (!cut.success) { setSilenceStatus(cut.error || "Cut failed", "error"); showToast("Cut failed", "error", 5000); return; }
          }
          setSilenceStatus(`✓ Trimmed file saved → ${res.filePath}`, "success");
          showToast("Silences cut — trimmed file saved", "success", 5000);
        } catch (e2) {
          setSilenceStatus(e2.message, "error");
        } finally {
          showSilenceProgress(false);
          if (btn2) btn2.disabled = false;
        }
      });
    } catch (e) {
      setSilenceStatus(e.message, "error");
    } finally {
      showSilenceProgress(false);
      if (btn) btn.disabled = false;
    }
  };

  // detectSilences (marker version) is Premiere-only → no-op on desktop
  detectSilences = function () {
    showToast("Use “Cut Silences” on desktop — markers are Premiere-only.", "info", 4000);
  };

  function baseName() {
    return mediaPath ? mediaPath.split(/[\\/]/).pop().replace(/\.[^.]+$/, "") : "output";
  }

  // ── DOM tweaks: relabel & inject desktop-specific controls ────────────────
  function tweakUI() {
    document.title = "Subsper (Desktop)";
    // Tagline shows "Desktop" — DON'T touch the status-indicator dot.
    const tag = document.querySelector(".brand-tagline");
    if (tag) tag.textContent = "Desktop";

    // Open-media button + media preview, injected at top of the transcribe controls
    const controls = document.querySelector("#panel-tx-work .controls");
    if (controls) {
      const openBtn = document.createElement("button");
      openBtn.className = "btn-transcribe";
      openBtn.style.cssText = "margin-top:0;margin-bottom:10px;background:var(--bg3);border:1px solid var(--border2);box-shadow:none;color:var(--text)";
      openBtn.innerHTML = '<span class="ic">' + (typeof icon === "function" ? icon("folder") : "") + '</span><span>Open Video / Audio File</span>';
      openBtn.setAttribute("data-tip", "Bilgisayardan bir video/ses dosyası seç (pencereye sürükle-bırak da olur)");
      openBtn.onclick = pickMedia;

      const nameRow = document.createElement("div");
      nameRow.style.cssText = "font-size:10px;color:var(--text3);margin-bottom:10px;text-align:center;word-break:break-all";
      nameRow.innerHTML = '<span id="media-name">No file loaded — drag a file here</span>';

      mediaEl = document.createElement("video");
      mediaEl.id = "media-preview";
      mediaEl.controls = true;
      mediaEl.style.cssText = "width:100%;max-height:220px;background:#000;border-radius:8px;display:none";
      // wrapper so the subtitle overlay can sit ON the video
      const vwrap = document.createElement("div");
      vwrap.id = "video-wrap";
      vwrap.style.cssText = "position:relative;margin-bottom:10px";
      subOverlay = document.createElement("div");
      subOverlay.id = "sub-overlay";
      // sized to the REAL displayed video frame (letterbox-aware) by applyOverlayStyle
      subOverlay.style.cssText = "position:absolute;display:none;" +
        "pointer-events:none;text-align:center;line-height:1.25;z-index:2";
      subOverlay.innerHTML = `<span id="sub-overlay-t" style="position:absolute;padding:.15em .4em;border-radius:4px;white-space:pre-wrap"></span>`;
      vwrap.appendChild(mediaEl);
      vwrap.appendChild(subOverlay);
      // Fullscreen must target the WRAP (so the subtitle overlay stays
      // visible). The old exit-and-reenter swap failed because the re-enter
      // has no user gesture — the video just shrank back. Instead: hide the
      // native fullscreen button and own the double-click gesture directly.
      mediaEl.setAttribute("controlslist", "nofullscreen");
      mediaEl.addEventListener("dblclick", (e) => {
        e.preventDefault(); e.stopPropagation();
        if (document.fullscreenElement === vwrap) document.exitFullscreen().catch(() => {});
        else vwrap.requestFullscreen().catch(() => {});
      }, true);
      document.addEventListener("fullscreenchange", () => {
        const on = document.fullscreenElement === vwrap;
        mediaEl.style.maxHeight = on ? "100vh" : "220px";
        mediaEl.style.height = on ? "100%" : "";
        mediaEl.style.width = "100%";
        vwrap.style.background = on ? "#000" : "";
        vwrap.style.height = on ? "100%" : "";
        setTimeout(applyOverlayStyle, 80);
      });
      // tell the style mock-up the real video aspect ratio
      mediaEl.addEventListener("loadedmetadata", () => {
        if (mediaEl.videoWidth && mediaEl.videoHeight) {
          window.__videoAR = mediaEl.videoWidth / mediaEl.videoHeight;
          // real dimensions drive the .ass PlayRes (vertical videos otherwise
          // get ~1.8x oversized fonts that wrap word-per-line)
          window.__videoW = mediaEl.videoWidth;
          window.__videoH = mediaEl.videoHeight;
          try { updateStylePreview(); } catch (e) {}
        }
      });

      mediaEl.ontimeupdate = () => {
          const t = mediaEl.currentTime;
          if (typeof segments === "undefined" || !segments || segments.length === 0) return;
          
          let activeIdx = -1;
          for (let i = 0; i < segments.length; i++) {
              if (t >= segments[i].seqStart && t <= segments[i].seqEnd) {
                  activeIdx = i; break;
              } else if (t < segments[i].seqStart) {
                  break;
              }
          }
          
          const wrap = document.getElementById("segments-wrap");
          if (wrap) {
              const nodes = wrap.querySelectorAll(".segment");
              nodes.forEach((n, i) => {
                  // highlight only — no auto-scroll; the user is watching the
                  // video and the list must not move under them
                  if (i === activeIdx) n.classList.add("playing");
                  else n.classList.remove("playing");
              });
          }

          // live styled subtitle on the video
          if (subOverlay) {
              const txt = activeIdx >= 0 ? (segments[activeIdx].text || "") : "";
              const span = document.getElementById("sub-overlay-t");
              if (span && span.textContent !== txt) span.textContent = txt;
              if (subOverlay.dataset.ready !== "1") applyOverlayStyle();   // geometry retry
              subOverlay.style.display = (txt && subOverlay.dataset.ready === "1") ? "block" : "none";
          }
      };

      controls.insertBefore(openBtn, controls.firstChild);
      controls.insertBefore(vwrap, controls.children[1]);
      controls.insertBefore(nameRow, controls.children[2]);
    }

    // Transcribe button: disabled until a file is loaded (label comes from i18n)
    const tb = document.getElementById("transcribe-btn");
    if (tb) tb.disabled = true;

    // Hide "Send to Premiere" → desktop uses the export menu
    const sendBtn = document.getElementById("send-btn");
    if (sendBtn) sendBtn.style.display = "none";

    // Edit tab: hide marker detect (Premiere-only) and the whole Auto Zoom tool
    // (Auto Zoom needs Premiere's Motion keyframes). Cut Silences stays → file export.
    hideToolCard("silence-btn", false);     // keep its card, just hide the button
    const markBtn = document.getElementById("silence-btn");
    if (markBtn) markBtn.style.display = "none";
    hideToolCard("zoom-btn", true);         // hide Auto Zoom card + section
    hideToolCard("set-zoomamt", true);      // hide Auto Zoom settings card + section

    // Subtitles settings: hide "Send to Premiere" (caption track / MOGRT) — Premiere-only
    hideToolCard("set-sendmode", true);

    // Keyboard: spacebar toggles playback when not typing
    document.addEventListener("keydown", e => {
      if (e.code === "Space" && !/INPUT|TEXTAREA|SELECT/.test((e.target.tagName || ""))) {
        e.preventDefault(); playPause();
      }
    });
  }

  // Hide a tool's card (its .setting-item); optionally hide the preceding section title.
  function hideToolCard(id, withTitle) {
    const el = document.getElementById(id);
    if (!el) return;
    const card = el.closest(".setting-item");
    if (!card) return;
    if (id !== "silence-btn") card.style.display = "none";   // silence-btn shares a card with Cut
    if (withTitle) {
      const prev = card.previousElementSibling;
      if (prev && prev.classList.contains("setup-section-title")) prev.style.display = "none";
    }
  }

  // Desktop wording (file-based, no Premiere) — patch the shared i18n table.
  function patchDesktopI18N() {
    if (typeof I18N === "undefined") return;
    Object.assign(I18N.en, {
      btn_transcribe: "Transcribe File",
      tip_transcribe: "Transcribe the loaded video/audio file",
      empty_p: "Open a video or audio file, then click Transcribe.",
      status_ready: "Open a video or audio file to begin",
      btn_cut: "Cut Silences (export trimmed file)",
      tip_cut: "Finds silent gaps and exports a trimmed copy with them removed (great for CapCut)",
      hint_cut: "Exports a trimmed copy of your file with the silent gaps removed.",
      ed_intro: "Silence cutting for the loaded file. Open a file first.",
      au_intro: "Audio tools for the loaded file. Open a file first.",
      tip_enhance: "Cleans the loaded file's audio (denoise + normalize) and saves a new WAV",
      tip_play: "Play / pause the preview player (Space). Clicking a segment jumps there",
      tip_send: "Export the subtitles as an .srt file",
    });
    Object.assign(I18N.tr, {
      btn_transcribe: "Dosyayı Yazıya Dök",
      tip_transcribe: "Yüklü video/ses dosyasını yazıya döker",
      empty_p: "Bir video/ses dosyası aç, sonra Transcribe'a bas.",
      status_ready: "Başlamak için bir video/ses dosyası aç",
      btn_cut: "Sessizlikleri Kes (kırpılmış dosya)",
      tip_cut: "Sessiz boşlukları bulup kırpılmış bir kopya çıkarır (CapCut için ideal)",
      hint_cut: "Dosyanın sessiz boşlukları çıkarılmış kırpılmış kopyasını kaydeder.",
      ed_intro: "Yüklü dosya için sessizlik kesme. Önce bir dosya aç.",
      au_intro: "Yüklü dosya için ses araçları. Önce bir dosya aç.",
      tip_enhance: "Yüklü dosyanın sesini temizler (gürültü+seviye) ve yeni bir WAV kaydeder",
      tip_play: "Önizleme oynatıcıyı oynat/duraklat (Space). Segmente tıklayınca o ana gider",
      tip_send: "Altyazıyı .srt dosyası olarak dışa aktar",
    });
  }

  patchDesktopI18N();
  tweakUI();
  if (typeof applyLanguage === "function") applyLanguage();
  // Insurance: bind the buttons directly to the desktop handlers so the inline
  // onclick can never fall through to the Premiere flow (no "In/Out" error here).
  const _bind = (id, fn) => { const el = document.getElementById(id); if (el && typeof fn === "function") el.onclick = (e) => { e.preventDefault(); fn(); }; };
  _bind("transcribe-btn", startTranscription);
  _bind("enhance-btn", enhanceAudio);
  _bind("silence-cut-btn", cutSilences);
  _bind("send-btn", sendToPremiere);
  wireDragDrop();
  setStatus(typeof t === "function" ? t("status_ready") : "Open a video or audio file to begin", "info");

  // Re-run the setup check now that findPython() is Windows-aware (main.js ran the
  // first check before our override loaded).
  try {
    runPython("check_setup.py", []).then(data => {
      if (typeof diagData !== "undefined") diagData = data;
      const ind = document.getElementById("setup-indicator");
      const badge = document.getElementById("setup-badge");
      if (!ind) return;
      // The bundled engine (whisper.cpp + ffmpeg) needs no Python — so a missing
      // Python is NOT an error. Always show "ok"; Python is only for optional Pro.
      ind.className = "setup-indicator ok";
      if (badge) badge.style.display = "none";
    }).catch(e => console.warn("Setup check error:", e));
  } catch (e) { console.warn("Setup check error:", e); }

  /* ── v1.9 desktop features: batch · burn-in · waveform · word-SRT · filler cut ── */

  // Word-by-word SRT save (desktop counterpart of the extension's caption send)
  window.exportWordSRTDesktop = async function () {
    if (!segments.length) { showToast("Nothing to export yet", "info", 2000); return; }
    const res = await ipcRenderer.invoke("dialog:saveFile",
      { defaultName: baseName() + "_words.srt", ext: "srt" });
    if (!res || !res.filePath) return;
    try {
      fsD.writeFileSync(res.filePath, buildWordSRT(), "utf8");
      setStatus(`Word-by-word SRT → ${res.filePath}`, "success");
      showToast("Word-by-word SRT saved", "success");
    } catch (e) { showToast("Save failed: " + e.message, "error"); }
  };

  // Burn-in export: renders the styled .ass INTO the video via bundled ffmpeg.
  async function exportBurnedVideo() {
    if (!mediaPath) { showToast("Open a video first", "info", 2000); return; }
    if (!segments.length) { showToast("Transcribe first", "info", 2000); return; }
    if (!WCPP) { showToast("Engine unavailable", "error"); return; }
    const res = await ipcRenderer.invoke("dialog:saveFile",
      { defaultName: baseName() + "_subtitled.mp4", ext: "mp4" });
    if (!res || !res.filePath) return;
    setStatus("Burning subtitles into the video… (re-encodes, takes a while)", "info");
    showProgress(true);
    const assPath = pathD.join(osD.tmpdir(), "subsper_burn_" + Date.now() + ".ass");
    try {
      fsD.writeFileSync(assPath, segmentsToASS(), "utf8");
      // ffmpeg subtitles filter: escape ' : \ for the filter graph
      const esc = assPath.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'");
      const fdEsc = fontsDir().replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'");
      await new Promise((resolve, reject) => {
        // Name the video encoder. With no -c:v, ffmpeg picks the container
        // default: that used to resolve to libx264, and against the LGPL build
        // (which ships no libx264 — see THIRD-PARTY-NOTICES.md) it silently
        // falls back to mpeg4. The export still "worked", it just quietly came
        // out as a 2001-era codec at ~2.3x the size and worse quality.
        const ff = spawnD(WCPP.ffmpegBin(extDir()),
          ["-y", "-i", mediaPath, "-vf", "subtitles='" + esc + "':fontsdir='" + fdEsc + "'",
           ...WCPP.videoEncodeArgs(extDir()), "-c:a", "copy", res.filePath]);
        let err = "";
        ff.stderr.on("data", d => {
          err += d.toString(); if (err.length > 60000) err = err.slice(-30000);
          const m = /time=(\d+):(\d+):(\d+)/.exec(d.toString());
          if (m && mediaEl && mediaEl.duration > 0) {
            const t = (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]);
            setStatus(`Burning subtitles… ${Math.min(99, Math.round(t / mediaEl.duration * 100))}%`, "info");
          }
        });
        ff.on("error", e => reject(new Error("ffmpeg could not run: " + e.message)));
        ff.on("close", c => c === 0 ? resolve() :
          reject(new Error(/libass|subtitles/i.test(err) && /No such filter|not compiled/i.test(err)
            ? "This ffmpeg build lacks subtitle rendering (libass)."
            : "Burn-in failed: " + err.slice(-300))));
      });
      setStatus(`✓ Subtitled video saved → ${res.filePath}`, "success");
      showToast("Burned-in video exported", "success", 5000);
    } catch (e) {
      setStatus(e.message, "error"); showToast(e.message, "error", 6000);
    } finally {
      showProgress(false);
      try { fsD.unlinkSync(assPath); } catch (e) {}
    }
  }

  // Batch transcribe: pick/drop multiple files → SRT saved next to each source.
  let _batchRunning = false;
  async function batchTranscribe(paths) {
    if (_batchRunning) { showToast("Batch already running", "info", 2000); return; }
    if (!paths || !paths.length) {
      const r = await ipcRenderer.invoke("dialog:openMediaMulti");
      paths = (r && r.filePaths) || [];
    }
    if (!paths.length) return;
    _batchRunning = true;
    const model = document.getElementById("model-select").value;
    const language = document.getElementById("lang-select").value;
    let done = 0, failed = 0;
    try {
      for (const p of paths) {
        setStatus(`Batch ${done + failed + 1}/${paths.length}: ${p.split(/[\\/]/).pop()}`, "info");
        showProgress(true);
        const tx = await transcribeViaCpp(p, model, language, null);
        if (tx.success && tx.segments && tx.segments.length) {
          const srt = tx.segments.map((s, i) =>
            `${i + 1}\n${formatTime(s.start)} --> ${formatTime(s.end)}\n${(s.text || "").trim()}\n`).join("\n");
          const out = p.replace(/\.[^.]+$/, "") + ".srt";
          try { fsD.writeFileSync(out, srt, "utf8"); done++; }
          catch (e) { failed++; console.warn("batch write failed:", e); }
        } else failed++;
      }
      setStatus(`✓ Batch done — ${done} SRT saved${failed ? ", " + failed + " failed" : ""}`, failed ? "warning" : "success");
      showToast(`Batch: ${done} ok, ${failed} failed`, failed ? "warning" : "success", 6000);
    } finally { _batchRunning = false; showProgress(false); }
  }

  // Filler cut on desktop = trim-export with filler ranges removed
  window.cutFillerWordsDesktop = function () {
    if (!mediaPath) { showToast("Open a file first", "info", 2000); return; }
    if (!segments.length) { showToast("Transcribe first — needs word timings", "info", 3000); return; }
    const ranges = computeFillerRanges();
    if (!ranges.length) { showToast("No filler words with timings found", "info", 3000); return; }
    showRangePreview("Cut filler words (export trimmed file)", ranges, async (chosen) => {
      const dur = (mediaEl && isFinite(mediaEl.duration) && mediaEl.duration > 0)
        ? mediaEl.duration : (segments[segments.length - 1].seqEnd + 1);
      const keep = [];
      let cursor = 0;
      for (const r of chosen.slice().sort((a, b) => a.start - b.start)) {
        if (r.start > cursor) keep.push([cursor, r.start]);
        cursor = Math.max(cursor, r.end);
      }
      if (cursor < dur) keep.push([cursor, dur]);
      const inExt = (mediaPath.split(".").pop() || "mp4").toLowerCase();
      const isAudio = ["mp3","wav","m4a","aac","flac","ogg"].includes(inExt);
      const res = await ipcRenderer.invoke("dialog:saveFile",
        { defaultName: baseName() + "_nofillers." + (isAudio ? inExt : "mp4"), ext: isAudio ? inExt : "mp4" });
      if (!res || !res.filePath) return;
      setStatus(`Cutting ${chosen.length} filler(s)…`, "info"); showProgress(true);
      try {
        await WCPP.cutMedia(extDir(), mediaPath, res.filePath, keep, { video: !isAudio });
        setStatus(`✓ Filler-free file → ${res.filePath}`, "success");
        showToast("Fillers cut — file saved", "success", 5000);
      } catch (e) { setStatus(e.message, "error"); }
      finally { showProgress(false); }
    });
  };

  // Waveform strip under the preview player (peaks via bundled ffmpeg PCM dump)
  // Zoomable waveform: scroll-wheel over the strip zooms in/out (was too tiny).
  let _waveSamples = null, _waveZoom = 1, _waveRef = 32768;
  // total (virtual) strip width in css px — content space for boxes/playhead/seek
  function waveVirtualW() {
    const scroll = document.getElementById("waveform-scroll");
    if (!scroll) return 0;
    return Math.max(scroll.clientWidth, Math.round(scroll.clientWidth * _waveZoom));
  }
  // Virtualized draw: the canvas is viewport-sized and sticky — only the
  // visible slice is rendered, so any zoom level stays fast and never hits
  // the 32k canvas width limit (that was the "freeze").
  function _drawWave() {
    const canvas = document.getElementById("waveform-canvas");
    const scroll = document.getElementById("waveform-scroll");
    const spacer = document.getElementById("waveform-spacer");
    if (!canvas || !scroll || !_waveSamples) return;
    const dpr = window.devicePixelRatio || 1;
    const vw = scroll.clientWidth;
    const virtualW = waveVirtualW();
    if (spacer) spacer.style.width = virtualW + "px";
    canvas.style.width = vw + "px";
    const W = canvas.width = Math.round(vw * dpr);
    const H = canvas.height = 44 * dpr;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "rgba(80,140,255,.75)";
    const total = _waveSamples.length;
    const s0 = scroll.scrollLeft / virtualW * total;      // visible sample window
    const perPx = total / (virtualW * dpr);               // samples per device px
    for (let x = 0; x < W; x++) {
      const a = Math.floor(s0 + x * perPx), b = Math.max(a + 1, Math.floor(s0 + (x + 1) * perPx));
      let sum = 0, n = 0;
      for (let i = a; i < b && i < total; i++) { const v = _waveSamples[i]; sum += v * v; n++; }
      // RMS (energy), not peak — peaks made pauses look as loud as speech;
      // silences now drop to a hairline
      const rms = Math.sqrt(sum / Math.max(1, n));
      let f = Math.pow(Math.min(1, rms / _waveRef), 0.6);
      if (f < 0.04) f = 0.02;                             // noise floor → hairline
      const h = Math.max(1, f * H);
      ctx.fillRect(x, (H - h) / 2, 1, h);
    }
    if (typeof drawSegmentBoxes === "function") try { drawSegmentBoxes(); } catch (e) {}
  }
  /* ── user fonts: add .ttf/.otf from disk, render in preview AND burn-in ── */
  function fontsDir() {
    const base = WCPP ? pathD.dirname(WCPP.modelsDir()) : pathD.join(osD.homedir(), ".subsper");
    const d = pathD.join(base, "fonts");
    try { fsD.mkdirSync(d, { recursive: true }); } catch (e) {}
    return d;
  }
  // family name from the sfnt 'name' table (nameID 1) — libass matches by
  // family, not filename, so the burned output needs the real name
  function fontFamilyName(buf) {
    try {
      const u16 = o => buf.readUInt16BE(o), u32 = o => buf.readUInt32BE(o);
      let off = 0;
      if (u32(0) === 0x74746366) off = u32(12);          // 'ttcf' collection → first font
      const num = u16(off + 4);
      let nameOff = -1;
      for (let i = 0; i < num; i++) {
        const rec = off + 12 + i * 16;
        if (buf.toString("ascii", rec, rec + 4) === "name") { nameOff = u32(rec + 8); break; }
      }
      if (nameOff < 0) return null;
      const count = u16(nameOff + 2), strOff = nameOff + u16(nameOff + 4);
      let best = null;
      for (let i = 0; i < count; i++) {
        const r = nameOff + 6 + i * 12;
        const plat = u16(r), nameID = u16(r + 6), len = u16(r + 8), so = u16(r + 10);
        if (nameID !== 1) continue;
        if (plat === 3) {                                 // Windows, UTF-16BE
          let s = "";
          for (let j = 0; j + 1 < len; j += 2) s += String.fromCharCode(u16(strOff + so + j));
          best = s; break;
        }
        if (plat === 1 && !best) best = buf.toString("latin1", strOff + so, strOff + so + len);
      }
      return best;
    } catch (e) { return null; }
  }
  function registerFontFile(p) {
    const buf = fsD.readFileSync(p);
    const fam = fontFamilyName(buf) || pathD.basename(p).replace(/\.[^.]+$/, "");
    try {
      const ff = new FontFace(fam, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
      ff.load().then(f => document.fonts.add(f)).catch(e => console.warn("font load:", e));
    } catch (e) { console.warn("FontFace:", e); }
    return fam;
  }
  // re-register previously added fonts at startup
  try {
    fsD.readdirSync(fontsDir()).filter(f => /\.(ttf|otf)$/i.test(f))
       .forEach(f => registerFontFile(pathD.join(fontsDir(), f)));
  } catch (e) {}
  window.addUserFont = async function () {
    const res = await ipcRenderer.invoke("dialog:openFont");
    if (!res || !res.filePath) return;
    try {
      const dest = pathD.join(fontsDir(), pathD.basename(res.filePath));
      fsD.copyFileSync(res.filePath, dest);
      const fam = registerFontFile(dest);
      settings.stylePreset = "custom";
      settings.customStyle = Object.assign({}, settings.customStyle || {}, { font: fam });
      saveSettings();
      if (typeof populateCustomForm === "function") try { populateCustomForm(); } catch (e) {}
      updateStylePreview();
      showToast((settings.uiLang === "tr" ? "Font eklendi, Custom stile uygulandı: " : "Font added, applied to Custom: ") + fam, "success", 5000);
    } catch (e) { showToast(e.message, "error", 5000); }
  };
  // "Add font" button under the position sliders (they appear at ~40ms)
  setTimeout(() => {
    const posWrap = document.getElementById("ui2-pos-wrap");
    if (posWrap && !document.getElementById("addfont-btn")) {
      const b = document.createElement("button");
      b.id = "addfont-btn"; b.className = "btn-secondary";
      b.style.cssText = "width:100%; margin-top:8px";
      b.textContent = settings.uiLang === "tr" ? "Font dosyası ekle (.ttf / .otf)" : "Add a font file (.ttf / .otf)";
      b.onclick = () => window.addUserFont();
      posWrap.appendChild(b);
      const h = document.createElement("div");
      h.className = "setting-hint"; h.style.marginTop = "6px";
      h.textContent = settings.uiLang === "tr"
        ? "Eklenen font önizlemede ve videoya gömme çıktısında kullanılır."
        : "Added fonts render in the preview and in burned-in exports.";
      posWrap.appendChild(h);
    }
  }, 90);

  // Map the active ASS style (preset/gallery/custom + X/Y pin) onto the video
  // overlay so the preview matches the .ass/burned output as closely as CSS can
  // Real displayed video rectangle inside the (letterboxed) element box
  function videoRect() {
    const cw = mediaEl ? mediaEl.clientWidth : 0, ch = mediaEl ? mediaEl.clientHeight : 0;
    const vw = mediaEl ? mediaEl.videoWidth : 0, vh = mediaEl ? mediaEl.videoHeight : 0;
    if (!vw || !vh || !cw || !ch) return { left: 0, top: 0, width: cw, height: ch };
    const s = Math.min(cw / vw, ch / vh);
    const w = vw * s, h = vh * s;
    return { left: (cw - w) / 2, top: (ch - h) / 2, width: w, height: h };
  }

  function applyOverlayStyle() {
    if (!subOverlay || typeof getActivePreset !== "function") return;
    const p = getActivePreset();
    const span = document.getElementById("sub-overlay-t");
    if (!span) return;
    // pin the overlay to the actual video frame, not the element box —
    // a vertical video in a wide box was pushing the text into the letterbox
    const rct = videoRect();
    // no reliable geometry yet (pre-metadata / hidden panel) → keep hidden,
    // otherwise the text painted as a word-stack at the window's top-left
    const ready = rct.width > 20 && rct.height > 20 && mediaEl && mediaEl.videoWidth > 0;
    subOverlay.dataset.ready = ready ? "1" : "";
    if (!ready) { subOverlay.style.display = "none"; return; }
    subOverlay.style.left = rct.left + "px";
    subOverlay.style.top = rct.top + "px";
    subOverlay.style.width = rct.width + "px";
    subOverlay.style.height = rct.height + "px";
    const scale = (rct.height || 220) / (window.__videoH || 1080);   // ASS PlayResY → preview px
    const ow = Math.max(0, (p.outlineW || 0) * scale);
    span.style.fontFamily = `"${p.font}", Arial, sans-serif`;
    span.style.fontSize = Math.max(9, p.size * scale) + "px";
    span.style.fontWeight = p.bold ? "800" : "400";
    span.style.fontStyle = p.italic ? "italic" : "normal";
    span.style.color = "#" + (p.primary || "FFFFFF");
    span.style.textShadow = ow
      ? [[-ow, 0], [ow, 0], [0, -ow], [0, ow], [-ow, -ow], [ow, -ow], [-ow, ow], [ow, ow]]
          .map(([x, y]) => `${x.toFixed(1)}px ${y.toFixed(1)}px #${p.outline || "000000"}`).join(", ")
      : "none";
    // ASS BackColour alpha: 0 = opaque, 255 = invisible
    span.style.background = p.box
      ? `rgba(${parseInt((p.boxColor || "000000").slice(0, 2), 16)},${parseInt((p.boxColor || "000000").slice(2, 4), 16)},${parseInt((p.boxColor || "000000").slice(4, 6), 16)},${(1 - (p.boxAlpha != null ? p.boxAlpha : 96) / 255).toFixed(2)})`
      : "transparent";
    // place the text WITHIN the video frame; width follows the safe-box slider
    const s = span.style;
    s.maxWidth = (settings.subMaxW != null ? Math.min(settings.subMaxW, 96) : 94) + "%";
    if (settings.subPosX != null && settings.subPosY != null) {
      s.left = settings.subPosX + "%"; s.bottom = "auto";
      s.top = settings.subPosY + "%";
      s.transform = "translate(-50%,-50%)";
    } else {
      s.left = "50%"; s.transform = "translateX(-50%)";
      if (p.align === 8)      { s.top = "4%";  s.bottom = "auto"; }
      else if (p.align === 5) { s.top = "50%"; s.bottom = "auto"; s.transform = "translate(-50%,-50%)"; }
      else                    { s.bottom = "5%"; s.top = "auto"; }
    }
  }
  // restyle whenever the style UI changes (chains after features-v2's own wrapper)
  setTimeout(() => {
    const _usp = window.updateStylePreview;
    if (typeof _usp === "function")
      window.updateStylePreview = function () {
        const r = _usp.apply(this, arguments);
        try { applyOverlayStyle(); } catch (e) {}
        return r;
      };
    applyOverlayStyle();
    if (mediaEl) mediaEl.addEventListener("loadedmetadata", () => setTimeout(applyOverlayStyle, 60));
    window.addEventListener("resize", () => applyOverlayStyle());
  }, 120);

  window.__stripVer = "strip-v11";   // bump when the waveform strip changes (update check)
  async function buildWaveform() {
    if (!WCPP || !mediaPath || !mediaEl) return;
    let scroll = document.getElementById("waveform-scroll");
    let canvas = document.getElementById("waveform-canvas");
    if (!scroll) {
      scroll = document.createElement("div");
      scroll.id = "waveform-scroll";
      scroll.style.cssText = "position:relative;width:100%;overflow-x:auto;overflow-y:hidden;background:var(--bg3,#111);border-radius:6px;margin-bottom:10px";
      scroll.title = settings.uiLang === "tr"
        ? "Dikey kaydır: yakınlaş · yatay kaydır: gezin · tık: o ana git"
        : "Scroll ↕ to zoom · scroll ↔ to pan · click to seek";
      // sticky viewport-sized canvas + a spacer that provides the scroll width
      canvas = document.createElement("canvas");
      canvas.id = "waveform-canvas";
      // 12px gap above the wave = grab zone for the playhead triangle
      canvas.style.cssText = "height:44px;display:block;cursor:pointer;position:sticky;left:0;margin-top:12px";
      const spacer = document.createElement("div");
      spacer.id = "waveform-spacer";
      spacer.style.cssText = "height:1px;margin-top:-1px;pointer-events:none";
      scroll.appendChild(canvas);
      scroll.appendChild(spacer);
      // after the video WRAP (not the video) — the overlay must not cover the strip
      (document.getElementById("video-wrap") || mediaEl).insertAdjacentElement("afterend", scroll);
      // Cursor x in VIEWPORT space (within the visible strip)
      const relX = e => e.clientX - scroll.getBoundingClientRect().left;
      canvas.onclick = (e) => {
        if (!mediaEl.duration) return;
        const frac = (scroll.scrollLeft + relX(e)) / Math.max(1, waveVirtualW());
        mediaEl.currentTime = Math.max(0, Math.min(1, frac)) * mediaEl.duration;
      };
      scroll.addEventListener("wheel", (e) => {
        // horizontal scroll = native pan — don't steal it (it used to freeze)
        if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
        e.preventDefault();
        const vx = relX(e);
        const frac = (scroll.scrollLeft + vx) / Math.max(1, waveVirtualW());
        const k = e.deltaMode === 1 ? 0.12 : 0.006;    // lines vs pixels
        const f = Math.max(0.67, Math.min(1.5, Math.exp(-e.deltaY * k)));
        _waveZoom = Math.max(1, Math.min(60, _waveZoom * f));
        scroll.scrollLeft = frac * waveVirtualW() - vx;   // anchor under cursor
        _drawWave();
      }, { passive: false });
      // panning re-renders the visible slice (rAF-throttled)
      let _rafPending = false;
      scroll.addEventListener("scroll", () => {
        if (_rafPending) return;
        _rafPending = true;
        requestAnimationFrame(() => { _rafPending = false; _drawWave(); });
      });
      // playhead: draggable line + Premiere-style triangle handle on top
      const ph = document.createElement("div");
      ph.id = "waveform-ph";
      ph.style.cssText = "position:absolute;top:0;bottom:0;width:14px;margin-left:-7px;cursor:ew-resize;z-index:3";
      ph.innerHTML =
        '<div style="position:absolute;left:50%;top:11px;bottom:0;width:2px;margin-left:-1px;background:#fff"></div>' +
        '<div style="position:absolute;left:50%;top:0;width:0;height:0;margin-left:-7px;' +
          'border-left:7px solid transparent;border-right:7px solid transparent;border-top:11px solid #fff"></div>';
      ph.addEventListener("mousedown", (ev) => {
        ev.preventDefault(); ev.stopPropagation();
        const scrub = (mv) => {
          const x = scroll.scrollLeft + (mv.clientX - scroll.getBoundingClientRect().left);
          const frac = Math.max(0, Math.min(1, x / Math.max(1, waveVirtualW())));
          if (mediaEl.duration) mediaEl.currentTime = frac * mediaEl.duration;
          ph.style.left = (frac * waveVirtualW()) + "px";
        };
        scrub(ev);
        const up = () => {
          document.removeEventListener("mousemove", scrub);
          document.removeEventListener("mouseup", up);
        };
        document.addEventListener("mousemove", scrub);
        document.addEventListener("mouseup", up);
      });
      scroll.appendChild(ph);
      canvas._phTimer = setInterval(() => {
        if (!mediaEl.duration || !scroll.isConnected) return;
        // content-space left — the marker scrolls with the content
        ph.style.left = (mediaEl.currentTime / mediaEl.duration * waveVirtualW()) + "px";
      }, 100);
    }
    try {
      const raw = pathD.join(osD.tmpdir(), "subsper_wave_" + Date.now() + ".pcm");
      await new Promise((resolve, reject) => {
        const ff = spawnD(WCPP.ffmpegBin(extDir()),
          ["-y", "-i", mediaPath, "-ac", "1", "-ar", "1000", "-f", "s16le", raw]);
        ff.on("error", reject);
        ff.on("close", c => c === 0 ? resolve() : reject(new Error("wave extract failed")));
      });
      const buf = fsD.readFileSync(raw);
      try { fsD.unlinkSync(raw); } catch (e) {}
      _waveSamples = new Int16Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 2));
      // reference = 98th percentile of |samples| (sampled) — robust against a
      // single loud spike squashing the whole strip
      const step = Math.max(1, Math.floor(_waveSamples.length / 40000));
      const pick = [];
      for (let i = 0; i < _waveSamples.length; i += step) pick.push(Math.abs(_waveSamples[i]));
      pick.sort((a, b) => a - b);
      _waveRef = Math.max(1, pick[Math.floor(pick.length * 0.98)] || 32768);
      _waveZoom = 1;
      _drawWave();
    } catch (e) { console.warn("waveform failed:", e); }
  }
  const _origLoadMedia = loadMedia;
  loadMedia = function (p) { _origLoadMedia(p); setTimeout(buildWaveform, 50); };
  window.__loadMedia = p => loadMedia(p);   // test hook (loadMedia is IIFE-private)

  // Multi-file drag & drop → batch
  document.addEventListener("drop", e => {
    if (!e.dataTransfer || e.dataTransfer.files.length < 2) return;
    const paths = [...e.dataTransfer.files]
      .filter(f => MEDIA_EXTS.includes((f.name.split(".").pop() || "").toLowerCase()))
      .map(f => f.path);
    if (paths.length >= 2) { e.preventDefault(); e.stopPropagation(); batchTranscribe(paths); }
  }, true);

  // Desktop UI injections (deferred so main.js's feature pack has run)
  setTimeout(() => {
    try {
      // Export menu: burn-in under the "Video" group
      if (window.menuGroupAdd) {
        menuGroupAdd("export-grp-video", "grp_video",
          settings.uiLang === "tr" ? "Videoya göm (burn-in MP4)" : "Burn into video (MP4)",
          exportBurnedVideo, "Renders the styled subtitles INTO a new video file");
      }
      // Batch → compact secondary-actions row
      if (window.secondaryAdd) {
        secondaryAdd(settings.uiLang === "tr" ? "📁 Toplu transcribe" : "📁 Batch transcribe",
          () => batchTranscribe(null),
          settings.uiLang === "tr" ? "Birden çok dosya seç; her birinin yanına .srt kaydedilir" : "Pick multiple files; an .srt is saved next to each");
      }
      // Edit tools: filler-cut card
      const edPanel = (document.querySelector("#panel-ed-work .setup-scroll") || document.getElementById("panel-ed-work"));
      if (edPanel) {
        const card = document.createElement("div");
        card.className = "setting-item tool-card";
        card.innerHTML = `
          <div class="setting-row"><div class="setting-info">
            <div class="setting-name">${settings.uiLang === "tr" ? "Dolgu Kelime Kes" : "Cut Filler Words"}</div>
            <div class="setting-desc">${settings.uiLang === "tr" ? "ee, ıı, şey… kelimeleri çıkarılmış kırpılmış dosya üretir. Önce Transcribe." : "Exports a trimmed file with ee/um/uh words removed. Transcribe first."}</div>
          </div></div>
          <button class="btn-transcribe btn-compact" style="margin-top:8px" onclick="cutFillerWordsDesktop()">${settings.uiLang === "tr" ? "Dolguları Kes" : "Cut Fillers"}</button>`;
        edPanel.appendChild(card);
      }
    } catch (e) { console.error("[Desktop] v1.9 UI injection failed:", e); }
  }, 30);

  /* ── v1.10 desktop: beep · hook clips · native project open · waveform boxes ── */

  // Beep profanity → exports a beeped copy (video stream copied, audio filtered)
  window.beepProfanityDesktop = async function (ranges, mute) {
    if (!mediaPath || !WCPP) { showToast("Open a file first", "info", 2000); return; }
    const inExt = (mediaPath.split(".").pop() || "mp4").toLowerCase();
    const isAudio = ["mp3","wav","m4a","aac","flac","ogg"].includes(inExt);
    const outExt = isAudio ? "wav" : "mp4";
    const res = await ipcRenderer.invoke("dialog:saveFile",
      { defaultName: baseName() + (mute ? "_muted." : "_beeped.") + outExt, ext: outExt });
    if (!res || !res.filePath) return;
    setStatus(`${mute ? "Muting" : "Beeping"} ${ranges.length} range(s)…`, "info"); showProgress(true);
    try {
      await WCPP.beepRanges(extDir(), mediaPath, res.filePath, ranges,
        { video: !isAudio, mode: mute ? "mute" : "beep",
          duck: mute ? 0 : (settings.beepDuck || 0) / 100 });
      setStatus(`✓ ${mute ? "Muted" : "Beeped"} file → ${res.filePath}`, "success");
      showToast(`${mute ? "Muted" : "Beeped"} copy saved`, "success", 5000);
    } catch (e) { setStatus(e.message, "error"); showToast(e.message, "error", 6000); }
    finally { showProgress(false); }
  };

  // Hook clips → exports each AI-suggested range as its own file
  window.exportAiClipsDesktop = async function (ranges) {
    if (!mediaPath || !WCPP) { showToast("Open a file first", "info", 2000); return; }
    const dir = await ipcRenderer.invoke("dialog:saveFile",
      { defaultName: baseName() + "_hook1.mp4", ext: "mp4" });
    if (!dir || !dir.filePath) return;
    const base = dir.filePath.replace(/(_hook\d+)?\.mp4$/i, "");
    let ok = 0;
    showProgress(true);
    try {
      for (let i = 0; i < ranges.length; i++) {
        const r = ranges[i];
        setStatus(`Exporting hook ${i + 1}/${ranges.length} (${(r.end - r.start).toFixed(0)}s)…`, "info");
        try {
          await WCPP.cutMedia(extDir(), mediaPath, `${base}_hook${i + 1}.mp4`, [[r.start, r.end]], { video: true });
          ok++;
        } catch (e) { console.warn("hook export failed:", e); }
      }
      setStatus(`✓ ${ok}/${ranges.length} hook clip(s) exported`, ok ? "success" : "error");
      showToast(`${ok} hook clip(s) saved`, ok ? "success" : "error", 5000);
    } finally { showProgress(false); }
  };

  // Native project open (replaces the cep/hidden-input fallback)
  openProject = async function () {
    const res = await ipcRenderer.invoke("dialog:openProject");
    const p = res && res.filePath;
    if (!p) return;
    try { _loadProjectData(JSON.parse(fsD.readFileSync(p, "utf8"))); }
    catch (e) { showToast("Open failed: " + e.message, "error"); }
  };
  // Native project save
  saveProject = async function () {
    if (!segments.length) { showToast("Nothing to save yet", "info", 2000); return; }
    const res = await ipcRenderer.invoke("dialog:saveFile",
      { defaultName: baseName() + ".subsper", ext: "subsper" });
    if (!res || !res.filePath) return;
    try {
      window.__SUBSPER_MEDIA__ = mediaPath;
      fsD.writeFileSync(res.filePath, JSON.stringify(_projectData(), null, 1), "utf8");
      setStatus(`Project saved → ${res.filePath}`, "success");
      showToast("Project saved", "success");
    } catch (e) { showToast("Save failed: " + e.message, "error"); }
  };

  // Strip-local selection: mark the row + outline the clicked box, but never
  // scroll the subtitle list — the user stays where they are
  function stripSelect(i) {
    document.querySelectorAll(".segment").forEach(n => n.classList.remove("selected"));
    selectedIndex = i;
    const row = document.querySelector(`.segment[data-idx="${i}"]`);
    if (row) row.classList.add("selected");
    const layer = document.getElementById("waveform-segs");
    if (layer) [...layer.children].forEach((b, bi) => {
      b.style.borderColor = bi === i ? "rgba(255,255,255,.95)" : "rgba(59,130,246,.55)";
      b.style.background  = bi === i ? "rgba(59,130,246,.32)"  : "rgba(59,130,246,.18)";
    });
  }

  // Waveform segment boxes + edge-drag timing (visual editing on the strip)
  function drawSegmentBoxes() {
    const canvas = document.getElementById("waveform-canvas");
    if (!canvas || !mediaEl || !isFinite(mediaEl.duration) || !mediaEl.duration) return;
    let layer = document.getElementById("waveform-segs");
    if (!layer) {
      const host = canvas.parentElement;         // relative wrap made by playhead code
      if (!host || getComputedStyle(host).position !== "relative") return;
      layer = document.createElement("div");
      layer.id = "waveform-segs";
      layer.style.cssText = "position:absolute;left:0;top:12px;bottom:0;pointer-events:none";   // below the triangle zone
      host.appendChild(layer);
    }
    // inset:0 sized the layer to the VISIBLE strip, so the % boxes drifted off
    // the waveform when zoomed — pin it to the canvas (content) width instead
    layer.style.width = waveVirtualW() + "px";   // content space (canvas is viewport-sized now)
    const D = mediaEl.duration;
    layer.innerHTML = "";
    segments.forEach((s, i) => {
      const el = document.createElement("div");
      const l = Math.max(0, s.seqStart / D * 100), w = Math.max(0.3, (s.seqEnd - s.seqStart) / D * 100);
      const isSel = (typeof selectedIndex !== "undefined" && selectedIndex === i);
      el.style.cssText = `position:absolute;top:2px;bottom:2px;left:${l}%;width:${w}%;` +
        `background:rgba(59,130,246,${isSel ? ".32" : ".18"});` +
        `border:1px solid ${isSel ? "rgba(255,255,255,.95)" : "rgba(59,130,246,.55)"};` +
        `border-radius:3px;pointer-events:auto;cursor:grab`;
      el.title = `#${i + 1} ${s.text.slice(0, 40)}`;
      // select in place — no seek, no play, no list scroll; the thin white
      // stroke on the box shows what's selected
      el.onclick = (ev) => { ev.stopPropagation(); stripSelect(i); };
      // drag the box BODY to slide the whole segment left/right (duration
      // kept, clamped to the neighbours so overlap stays impossible)
      el.onmousedown = (ev) => {
        if (ev.target !== el) return;            // edge handles do their own thing
        ev.preventDefault(); ev.stopPropagation();
        stripSelect(i);
        const rect0 = layer.getBoundingClientRect();   // spans the full content width
        const startX = ev.clientX, s0 = s.seqStart, dur = s.seqEnd - s.seqStart;
        const lo = i > 0 ? segments[i - 1].seqEnd : 0;
        const hi = (i < segments.length - 1 ? segments[i + 1].seqStart : D) - dur;
        if (hi < lo) return;                     // no room to move at all
        let moved = false;
        const move = (mv) => {
          if (!moved && Math.abs(mv.clientX - startX) < 3) return;   // click tolerance
          if (!moved) { pushUndo(); moved = true; el.style.cursor = "grabbing"; }
          const dt = (mv.clientX - startX) / rect0.width * D;
          const ns = Math.max(lo, Math.min(hi, s0 + dt));
          s.seqStart = ns; s.seqEnd = ns + dur;
          s.start = ns - seqInTime; s.end = s.seqEnd - seqInTime;
          el.style.left = (ns / D * 100) + "%";
        };
        const up = () => {
          document.removeEventListener("mousemove", move);
          document.removeEventListener("mouseup", up);
          if (moved) { renderSegments(); stripSelect(i); drawSegmentBoxes(); }
        };
        document.addEventListener("mousemove", move);
        document.addEventListener("mouseup", up);
      };
      // edge drag handles
      ["start", "end"].forEach(edge => {
        const h = document.createElement("div");
        h.style.cssText = `position:absolute;top:0;bottom:0;${edge === "start" ? "left" : "right"}:-3px;width:7px;cursor:ew-resize`;
        h.onmousedown = (ev) => {
          ev.preventDefault(); ev.stopPropagation();
          pushUndo();
          const move = (mv) => {
            const rect = layer.getBoundingClientRect();   // content-space mapping
            let t = Math.max(0, Math.min(D, (mv.clientX - rect.left) / rect.width * D));
            // segments may never overlap: a start can reach back only to the
            // previous segment's end, an end forward only to the next's start
            const lo = i > 0 ? segments[i - 1].seqEnd : 0;
            const hi = i < segments.length - 1 ? segments[i + 1].seqStart : D;
            if (edge === "start") {
              t = Math.max(lo, Math.min(t, s.seqEnd - 0.05));
              s.seqStart = t; s.start = t - seqInTime;
            } else {
              t = Math.min(hi, Math.max(t, s.seqStart + 0.05));
              s.seqEnd = t; s.end = t - seqInTime;
            }
            const li = Math.max(0, s.seqStart / D * 100), wi = Math.max(0.3, (s.seqEnd - s.seqStart) / D * 100);
            el.style.left = li + "%"; el.style.width = wi + "%";
          };
          const up = () => {
            document.removeEventListener("mousemove", move);
            document.removeEventListener("mouseup", up);
            renderSegments(); stripSelect(i); drawSegmentBoxes();
          };
          document.addEventListener("mousemove", move);
          document.addEventListener("mouseup", up);
        };
        el.appendChild(h);
      });
      layer.appendChild(el);
    });
  }
  /* ── v1.12 desktop: text-cut export · vertical 9:16 clip ─────────────── */

  // Text-based editing: export a copy with the deleted-row ranges removed
  window.applyTextCutsDesktop = async function (removed) {
    if (!mediaPath || !WCPP) { showToast("Open a file first", "info", 2000); return; }
    const dur = (mediaEl && isFinite(mediaEl.duration) && mediaEl.duration > 0)
      ? mediaEl.duration : (segments.length ? segments[segments.length - 1].seqEnd + 1 : 0);
    const keep = [];
    let cursor = 0;
    for (const r of removed.slice().sort((a, b) => a.start - b.start)) {
      if (r.start > cursor) keep.push([cursor, r.start]);
      cursor = Math.max(cursor, r.end);
    }
    if (cursor < dur) keep.push([cursor, dur]);
    const inExt = (mediaPath.split(".").pop() || "mp4").toLowerCase();
    const isAudio = ["mp3","wav","m4a","aac","flac","ogg"].includes(inExt);
    const res = await ipcRenderer.invoke("dialog:saveFile",
      { defaultName: baseName() + "_edited." + (isAudio ? inExt : "mp4"), ext: isAudio ? inExt : "mp4" });
    if (!res || !res.filePath) return;
    setStatus(`Cutting ${removed.length} range(s)…`, "info"); showProgress(true);
    try {
      await WCPP.cutMedia(extDir(), mediaPath, res.filePath, keep, { video: !isAudio });
      snapshotOriginalSegments();
      setStatus(`✓ Edited file → ${res.filePath}`, "success");
      showToast("Video now follows your text ✂", "success", 5000);
    } catch (e) { setStatus(e.message, "error"); }
    finally { showProgress(false); }
  };

  // Vertical 9:16 clip: center-crop to 1080x1920 + burn the styled subtitles.
  async function exportVerticalClip() {
    if (!mediaPath) { showToast("Open a video first", "info", 2000); return; }
    if (!WCPP) { showToast("Engine unavailable", "error"); return; }
    const res = await ipcRenderer.invoke("dialog:saveFile",
      { defaultName: baseName() + "_vertical.mp4", ext: "mp4" });
    if (!res || !res.filePath) return;
    setStatus("Exporting vertical 9:16 clip… (re-encodes)", "info"); showProgress(true);
    const assPath = pathD.join(osD.tmpdir(), "subsper_vert_" + Date.now() + ".ass");
    try {
      let vf = "crop=ih*9/16:ih,scale=1080:1920";
      if (segments.length) {
        fsD.writeFileSync(assPath, segmentsToASS(), "utf8");
        const esc = assPath.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'");
        const fdEsc = fontsDir().replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'");
        vf += ",subtitles='" + esc + "':fontsdir='" + fdEsc + "'";
      }
      await new Promise((resolve, reject) => {
        const ff = spawnD(WCPP.ffmpegBin(extDir()),
          ["-y", "-i", mediaPath, "-vf", vf,
           ...WCPP.videoEncodeArgs(extDir()), "-c:a", "copy", res.filePath]);
        let err = "";
        ff.stderr.on("data", d => {
          err += d.toString(); if (err.length > 60000) err = err.slice(-30000);
          const m = /time=(\d+):(\d+):(\d+)/.exec(d.toString());
          if (m && mediaEl && mediaEl.duration > 0) {
            const t2 = (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]);
            setStatus(`Vertical export… ${Math.min(99, Math.round(t2 / mediaEl.duration * 100))}%`, "info");
          }
        });
        ff.on("error", e => reject(new Error("ffmpeg could not run: " + e.message)));
        ff.on("close", c => c === 0 ? resolve() : reject(new Error("Export failed: " + err.slice(-300))));
      });
      setStatus(`✓ Vertical clip → ${res.filePath}`, "success");
      showToast("9:16 clip ready — TikTok/Reels/Shorts", "success", 5000);
    } catch (e) { setStatus(e.message, "error"); showToast(e.message, "error", 6000); }
    finally { showProgress(false); try { fsD.unlinkSync(assPath); } catch (e) {} }
  }
  setTimeout(() => {
    if (window.menuGroupAdd) {
      menuGroupAdd("export-grp-video", "grp_video",
        settings.uiLang === "tr" ? "Dikey klip 9:16 (TikTok/Reels)" : "Vertical clip 9:16 (TikTok/Reels)",
        exportVerticalClip, "Center-crops to 1080x1920 and burns the styled subtitles in");
    }
  }, 60);

  // redraw boxes whenever segments re-render (post-hoc wrap, cheap)
  setTimeout(() => {
    const origRender = window.renderSegments;
    if (typeof origRender === "function") {
      window.renderSegments = function () {
        const r = origRender.apply(this, arguments);
        try { drawSegmentBoxes(); } catch (e) {}
        return r;
      };
    }
    mediaEl && mediaEl.addEventListener("loadedmetadata", () => setTimeout(drawSegmentBoxes, 300));
  }, 40);
})();
