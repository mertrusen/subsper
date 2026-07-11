// host.jsx - ExtendScript for Premiere Pro
// Runs inside Premiere's JavaScript engine

var TICKS_PER_SECOND = 254016000000;

function ticksToSeconds(ticks) {
    return parseInt(ticks) / TICKS_PER_SECOND;
}

// Premiere sometimes returns file:// URLs with %20 encoding — clean them up
function decodePath(p) {
    if (!p) return p;
    // Strip file:// variants
    p = p.replace(/^file:\/\/\//, "/")
         .replace(/^file:\/\//, "//")
         .replace(/^file:\//, "/");
    // Decode %XX sequences (simple version for ExtendScript which lacks decodeURIComponent)
    try { p = decodeURIComponent(p); } catch (e) {
        p = p.replace(/%20/g, " ").replace(/%28/g, "(").replace(/%29/g, ")")
             .replace(/%5B/g, "[").replace(/%5D/g, "]").replace(/%26/g, "&");
    }
    return p;
}

// Read an In/Out point in seconds. Prefers the Time-object API (…AsTime, which
// exposes .ticks/.seconds) and falls back to the string API. Returns NaN if unset.
function readPointSecs(seq, which) {
    try {
        var tm = (which === "in") ? seq.getInPointAsTime() : seq.getOutPointAsTime();
        if (tm) {
            if (tm.ticks != null && tm.ticks !== "") { var tk = ticksToSeconds(tm.ticks); if (!isNaN(tk)) return tk; }
            if (typeof tm.seconds === "number") return tm.seconds;
        }
    } catch (e) {}
    try {
        var s = (which === "in") ? seq.getInPoint() : seq.getOutPoint();
        var f = parseFloat(s);
        if (!isNaN(f)) return f;
    } catch (e2) {}
    return NaN;
}

// Largest clip end (seconds) across all video + audio tracks = the real end of
// timeline CONTENT, ignoring trailing empty space.
function seqContentEnd(seq) {
    var end = 0;
    function scan(tracks) {
        for (var t = 0; t < tracks.numTracks; t++) {
            var trk = tracks[t];
            for (var c = 0; c < trk.clips.numItems; c++) {
                try { var e = ticksToSeconds(trk.clips[c].end.ticks); if (e > end) end = e; } catch (eC) {}
            }
        }
    }
    try { scan(seq.videoTracks); } catch (eV) {}
    try { scan(seq.audioTracks); } catch (eA) {}
    return end;
}

// Returns sequence info + clip paths. Uses the In/Out range if set; otherwise
// falls back to the WHOLE timeline (no "set In/Out" nag) — the requested behaviour.
function getSequenceInfo() {
    try {
        var seq = app.project.activeSequence;
        if (!seq) {
            return JSON.stringify({ success: false, error: "No active sequence. Open a sequence in the timeline." });
        }

        var contentEnd = seqContentEnd(seq);
        if (contentEnd <= 0) {
            return JSON.stringify({ success: false, error: "The timeline is empty. Add a clip, then try again." });
        }

        var inTimeSecs  = readPointSecs(seq, "in");
        var outTimeSecs = readPointSecs(seq, "out");
        var wholeSequence = false;

        // No usable In/Out → transcribe the whole timeline (0 → content end).
        if (isNaN(inTimeSecs) || isNaN(outTimeSecs) || outTimeSecs <= inTimeSecs) {
            inTimeSecs = 0; outTimeSecs = contentEnd; wholeSequence = true;
        }
        if (inTimeSecs < 0) inTimeSecs = 0;
        // Cap Out at real content end (an unset Out can report the full sequence
        // duration incl. trailing gap, or a huge number).
        if (outTimeSecs > contentEnd + 0.001) outTimeSecs = contentEnd;
        // If In≈0 and Out≈content end, it's effectively the whole timeline.
        if (inTimeSecs <= 0.01 && outTimeSecs >= contentEnd - 0.05) wholeSequence = true;

        if (outTimeSecs <= inTimeSecs) {
            return JSON.stringify({ success: false, error: "Invalid In/Out points. Out must be after In." });
        }

        var duration = outTimeSecs - inTimeSecs;
        var clips = [];

        // Extensions that cannot contain audio — skip these entirely
        var SKIP_EXTS = { aegraphic:1, mogrt:1, png:1, jpg:1, jpeg:1, gif:1,
                          tif:1, tiff:1, bmp:1, svg:1, psd:1, ai:1, srt:1, vtt:1 };

        function collectClips(clip, trackLabel) {
            try {
                var clipStartSecs = ticksToSeconds(clip.start.ticks);
                var clipEndSecs   = ticksToSeconds(clip.end.ticks);

                // skip clips outside in/out range
                if (clipEndSecs <= inTimeSecs || clipStartSecs >= outTimeSecs) return;

                var mediaPath = decodePath(clip.projectItem.getMediaPath());
                if (!mediaPath || mediaPath === "") return;

                // skip Motion Graphics Templates and image files — no audio to extract
                var extMatch = mediaPath.match(/\.([^.]+)$/);
                var ext = extMatch ? extMatch[1].toLowerCase() : "";
                if (SKIP_EXTS[ext]) return;

                var mediaInSecs = ticksToSeconds(clip.inPoint.ticks);

                // Intersection of clip with the in/out range
                var useStart = Math.max(clipStartSecs, inTimeSecs);
                var useEnd   = Math.min(clipEndSecs, outTimeSecs);

                // Offset into source media where our extraction should begin
                var srcStart = mediaInSecs + (useStart - clipStartSecs);

                clips.push({
                    path:          mediaPath,
                    timelineStart: useStart - inTimeSecs,
                    duration:      useEnd - useStart,
                    srcStart:      srcStart,
                    track:         trackLabel
                });
            } catch (e) { /* skip inaccessible clips */ }
        }

        // Video tracks (carry the main audio in most timelines)
        for (var v = 0; v < seq.videoTracks.numTracks; v++) {
            var vt = seq.videoTracks[v];
            for (var vc = 0; vc < vt.clips.numItems; vc++) {
                collectClips(vt.clips[vc], "video" + v);
            }
        }

        // Audio-only tracks
        for (var a = 0; a < seq.audioTracks.numTracks; a++) {
            var at = seq.audioTracks[a];
            for (var ac = 0; ac < at.clips.numItems; ac++) {
                collectClips(at.clips[ac], "audio" + a);
            }
        }

        // Deduplicate linked clips (same source file + same srcStart appear on both video & audio tracks)
        var seen = {};
        var uniqueClips = [];
        for (var ci = 0; ci < clips.length; ci++) {
            var key = clips[ci].path + "|" + Math.round(clips[ci].srcStart * 100) + "|" + Math.round(clips[ci].duration * 100);
            if (!seen[key]) { seen[key] = true; uniqueClips.push(clips[ci]); }
        }

        // Prefer video-track clips — they carry the main mic/camera audio.
        // Audio-only tracks are almost always background music or SFX, not speech.
        // Only fall back to audio-only clips if there are no video clips at all.
        var videoClips = [];
        for (var vi = 0; vi < uniqueClips.length; vi++) {
            if (uniqueClips[vi].track.indexOf("video") === 0) videoClips.push(uniqueClips[vi]);
        }
        var finalClips = videoClips.length > 0 ? videoClips : uniqueClips;

        return JSON.stringify({
            success:       true,
            sequenceName:  seq.name,
            inTime:        inTimeSecs,
            outTime:       outTimeSecs,
            duration:      duration,
            wholeSequence: wholeSequence,
            clips:         finalClips
        });

    } catch (e) {
        return JSON.stringify({ success: false, error: "ExtendScript error: " + e.toString() });
    }
}

// Tracks whether we last issued a play or stop, so Space toggles correctly.
var _wsIsPlaying = false;

// Play / pause the active sequence via the QE DOM.
// QE doesn't depend on panel focus or macOS Accessibility permissions, so it works
// even when the CEP panel has keyboard focus.
function togglePlayback() {
    var errs = [];
    try {
        app.enableQE();
    } catch(eQE) {
        return JSON.stringify({ success: false, error: "enableQE failed: " + eQE.toString() });
    }
    var qeSeq = null;
    try { qeSeq = qe.project.getActiveSequence(); } catch(eS) {}
    if (!qeSeq) return JSON.stringify({ success: false, error: "No active QE sequence" });

    if (_wsIsPlaying) {
        // Stop — try every known QE stop variant
        var stops = [
            function() { qeSeq.stop(); },
            function() { qeSeq.play(0); },
            function() { qeSeq.player.stop(); }
        ];
        for (var s = 0; s < stops.length; s++) {
            try { stops[s](); _wsIsPlaying = false; return JSON.stringify({ success: true, playing: false }); }
            catch(e1) { errs.push(e1.toString()); }
        }
        return JSON.stringify({ success: false, error: "stop failed: " + errs.join(" | ") });
    } else {
        var plays = [
            function() { qeSeq.play(1); },
            function() { qeSeq.play(1.0); },
            function() { qeSeq.player.play(); }
        ];
        for (var p = 0; p < plays.length; p++) {
            try { plays[p](); _wsIsPlaying = true; return JSON.stringify({ success: true, playing: true }); }
            catch(e2) { errs.push(e2.toString()); }
        }
        return JSON.stringify({ success: false, error: "play failed: " + errs.join(" | ") });
    }
}

// Stateless play / stop — the PANEL decides which to call (it can tell if the
// playhead is moving), so Premiere-initiated playback never desyncs a flag.
function wsPlay() {
    var errs = [];
    try { app.enableQE(); } catch (eQ) { return JSON.stringify({ success: false, error: "enableQE: " + eQ.toString() }); }
    var qeSeq = null;
    try { qeSeq = qe.project.getActiveSequence(); } catch (eS) {}
    if (!qeSeq) return JSON.stringify({ success: false, error: "No active QE sequence" });
    var plays = [function () { qeSeq.play(1); }, function () { qeSeq.play(1.0); }, function () { qeSeq.player.play(); }];
    for (var p = 0; p < plays.length; p++) {
        try { plays[p](); _wsIsPlaying = true; return JSON.stringify({ success: true, playing: true }); }
        catch (e2) { errs.push(e2.toString()); }
    }
    return JSON.stringify({ success: false, error: "play failed: " + errs.join(" | ") });
}
function wsStop() {
    var errs = [];
    try { app.enableQE(); } catch (eQ) { return JSON.stringify({ success: false, error: "enableQE: " + eQ.toString() }); }
    var qeSeq = null;
    try { qeSeq = qe.project.getActiveSequence(); } catch (eS) {}
    if (!qeSeq) return JSON.stringify({ success: false, error: "No active QE sequence" });
    var stops = [function () { qeSeq.stop(); }, function () { qeSeq.play(0); }, function () { qeSeq.player.stop(); }];
    for (var s = 0; s < stops.length; s++) {
        try { stops[s](); _wsIsPlaying = false; return JSON.stringify({ success: true, playing: false }); }
        catch (e1) { errs.push(e1.toString()); }
    }
    return JSON.stringify({ success: false, error: "stop failed: " + errs.join(" | ") });
}

// Probe the real playback state if this Premiere build exposes it via QE.
// known:false → caller falls back to playhead-motion sampling.
function wsIsPlayingProbe() {
    try {
        app.enableQE();
        var qeSeq = qe.project.getActiveSequence();
        if (qeSeq && qeSeq.player) {
            var p = qeSeq.player;
            if (typeof p.isPlaying === "boolean") return JSON.stringify({ success: true, known: true, playing: p.isPlaying });
            if (typeof p.isPlaying === "function") return JSON.stringify({ success: true, known: true, playing: !!p.isPlaying() });
            if (typeof p.playing === "boolean")   return JSON.stringify({ success: true, known: true, playing: p.playing });
        }
    } catch (e) {}
    return JSON.stringify({ success: true, known: false });
}

// Duck (lower) the ORIGINAL audio during given ranges by keyframing each audio
// clip's Volume→Level. payload = { ranges:[{start,end}], level:0..1 }.
// Level keyframe values are linear gain here; guarded — returns keyed count + diag.
function duckAudioRanges(payloadJson) {
    var diag = [], keyed = 0;
    try {
        var data = JSON.parse(payloadJson);
        var ranges = data.ranges || [];
        var level = (typeof data.level === "number") ? data.level : 0;
        // Only duck the clips that were actually transcribed (speech source) —
        // never music beds or the beep track we just inserted.
        var pathSet = null;
        if (data.paths && data.paths.length) {
            pathSet = {};
            for (var ps = 0; ps < data.paths.length; ps++) pathSet[String(data.paths[ps])] = true;
        }
        var skipTrack = (typeof data.skipTrack === "number") ? data.skipTrack : -1;
        var allowTracks = data.tracks || null;
        function trackAllowed(ti) {
            if (!allowTracks) return true;
            for (var q = 0; q < allowTracks.length; q++) if (allowTracks[q] === ti) return true;
            return false;
        }
        var seq = app.project.activeSequence;
        if (!seq) return JSON.stringify({ success: false, error: "No active sequence." });
        var EDGE = 0.03;   // seconds of ramp on each side

        for (var t = 0; t < seq.audioTracks.numTracks; t++) {
            if (t === skipTrack || !trackAllowed(t)) continue;
            var trk = seq.audioTracks[t];
            for (var c = 0; c < trk.clips.numItems; c++) {
                var clip = trk.clips[c];
                var cs, ce;
                try { cs = ticksToSeconds(clip.start.ticks); ce = ticksToSeconds(clip.end.ticks); } catch (e0) { continue; }
                if (pathSet) {
                    var mp = "";
                    try { mp = decodePath(clip.projectItem.getMediaPath()); } catch (eMP) {}
                    if (!pathSet[mp]) { continue; }   // not a transcribed source → leave it alone
                }
                // Keyframe times on clip properties are in MEDIA time: offset by the
                // clip's source inPoint (a head-trimmed clip otherwise gets its dip
                // shifted earlier by exactly the trimmed amount).
                var inP = 0;
                try { inP = ticksToSeconds(clip.inPoint.ticks); } catch (eIP) {}
                var toKey = function (seqT) { return inP + (seqT - cs); };

                // find Volume → Level
                var vol = null;
                try {
                    for (var i = 0; i < clip.components.numItems; i++) {
                        var dn = ""; try { dn = clip.components[i].displayName; } catch (e1) {}
                        if (dn === "Volume" || dn === "Ses Düzeyi" || dn === "Ses") { vol = clip.components[i]; break; }
                    }
                } catch (e2) {}
                if (!vol) continue;
                var lev = null;
                try {
                    for (var p2 = 0; p2 < vol.properties.numItems; p2++) {
                        var pn = ""; try { pn = vol.properties[p2].displayName; } catch (e3) {}
                        if (pn === "Level" || pn === "Düzey") { lev = vol.properties[p2]; break; }
                    }
                } catch (e4) {}
                if (!lev) continue;

                var base = 1.0;
                try { var bv = lev.getValue(); if (typeof bv === "number" && bv > 0.01 && bv <= 4) base = bv; } catch (e5) {}
                var duckVal = base * level;

                for (var r = 0; r < ranges.length; r++) {
                    var rs = parseFloat(ranges[r].start), re = parseFloat(ranges[r].end);
                    if (isNaN(rs) || isNaN(re)) continue;
                    if (re <= cs || rs >= ce) continue;   // no overlap with this clip
                    var a = Math.max(cs, rs), b = Math.min(ce, re);
                    try {
                        try { lev.setTimeVarying(true); } catch (eTV) {}
                        var k1 = toKey(Math.max(cs, a - EDGE)), k4 = toKey(Math.min(ce, b + EDGE));
                        var ka = toKey(a), kb = toKey(b);
                        lev.addKey(k1); lev.setValueAtKey(k1, base, true);
                        lev.addKey(ka); lev.setValueAtKey(ka, duckVal, true);
                        lev.addKey(kb); lev.setValueAtKey(kb, duckVal, true);
                        lev.addKey(k4); lev.setValueAtKey(k4, base, true);
                        keyed++;
                    } catch (eK) { if (keyed === 0) diag.push("keyframe failed: " + eK.toString()); }
                }
            }
        }
        return JSON.stringify({ success: true, keyed: keyed, diag: diag });
    } catch (e) {
        return JSON.stringify({ success: false, error: e.toString(), diag: diag });
    }
}

// Seek the timeline playhead to a given position in seconds
function seekToTime(seconds) {
    try {
        var seq = app.project.activeSequence;
        if (!seq) return JSON.stringify({ success: false, error: "No active sequence." });
        var ticks = Math.round(parseFloat(seconds) * 254016000000);
        seq.setPlayerPosition(ticks.toString());
        // Seeking stops playback in Premiere — keep our toggle state in sync so the
        // next Space press starts playing rather than trying to stop.
        _wsIsPlaying = false;
        return JSON.stringify({ success: true });
    } catch(e) {
        return JSON.stringify({ success: false, error: e.toString() });
    }
}

// Remove markers previously added by the silence detector (named "Silence …")
function clearSilenceMarkers() {
    try {
        var seq = app.project.activeSequence;
        if (!seq) return JSON.stringify({ success: false, error: "No active sequence." });
        var removed = 0;
        var mk = seq.markers.getFirstMarker();
        var toRemove = [];
        while (mk) {
            if (mk.name && mk.name.indexOf("Silence") === 0) toRemove.push(mk);
            mk = seq.markers.getNextMarker(mk);
        }
        for (var i = 0; i < toRemove.length; i++) {
            try { seq.markers.deleteMarker(toRemove[i]); removed++; } catch(e) {}
        }
        return JSON.stringify({ success: true, removed: removed });
    } catch(e) {
        return JSON.stringify({ success: false, error: e.toString() });
    }
}

// Add a timeline marker at the start of each detected silence.
// timesJson: array of { start, end, dur } in TIMELINE seconds.
function addSilenceMarkers(timesJson) {
    try {
        var seq = app.project.activeSequence;
        if (!seq) return JSON.stringify({ success: false, error: "No active sequence." });
        var times = JSON.parse(timesJson);
        var added = 0;
        for (var i = 0; i < times.length; i++) {
            var t = parseFloat(times[i].start);
            if (isNaN(t)) continue;
            // createMarker takes time in seconds (number) in Premiere Pro
            var mk = seq.markers.createMarker(t);
            try {
                mk.name     = "Silence " + (i + 1);
                mk.comments = "Silent gap " + times[i].dur + "s";
                if (mk.setColorByIndex) mk.setColorByIndex(1); // red-ish
            } catch(eM) {}
            added++;
        }
        return JSON.stringify({ success: true, added: added });
    } catch(e) {
        return JSON.stringify({ success: false, error: e.toString() });
    }
}

// ── Auto Zoom: subtle Motion push-in on each clip in the In/Out range ──────
// options = { amount: %, style: "alternate" | "in" }. EXPERIMENTAL — keyframe
// time base varies by PR version, so we try sequence-time then clip-time + diag.
function _wsApplyZoomToClip(clip, amount, style, idx, diag) {
    try {
        var motion = null, comps = clip.components;
        for (var i = 0; i < comps.numItems; i++) {
            var dn = ""; try { dn = comps[i].displayName; } catch (e) {}
            if (dn === "Motion" || dn === "Hareket") { motion = comps[i]; break; }
        }
        if (!motion) { if (idx === 0) diag.push("no Motion component (clip may be a graphic)"); return false; }

        var scale = null;
        for (var p = 0; p < motion.properties.numItems; p++) {
            var pn = ""; try { pn = motion.properties[p].displayName; } catch (e) {}
            if (pn === "Scale" || pn === "Ölçek") { scale = motion.properties[p]; break; }
        }
        if (!scale) { if (idx === 0) diag.push("no Scale property"); return false; }

        var cs = ticksToSeconds(clip.start.ticks);
        var ce = ticksToSeconds(clip.end.ticks);
        var startScale = 100, endScale = 100 + amount;
        if (style === "alternate" && (idx % 2 === 1)) { startScale = 100 + amount; endScale = 100; }

        try { scale.setTimeVarying(true); } catch (eTV) { if (idx === 0) diag.push("setTimeVarying: " + eTV.toString()); }

        // Smooth ease-out: 5 keyframes along 1-(1-p)^2 so the push-in starts
        // faster and settles gently — reads as "YouTuber zoom" even with the
        // linear interpolation Premiere gives scripted keys.
        function easeKeys(t0, t1) {
            var STEPS = 4;   // 5 keys
            for (var s = 0; s <= STEPS; s++) {
                var p = s / STEPS;
                var v = startScale + (endScale - startScale) * (1 - Math.pow(1 - p, 2));
                var tt = t0 + (t1 - t0) * p;
                scale.addKey(tt);
                scale.setValueAtKey(tt, v, s === STEPS);
            }
        }

        // Try sequence-time seconds
        try { easeKeys(cs, ce); return true; }
        catch (eK) { if (idx === 0) diag.push("seq-time keyframe failed: " + eK.toString()); }

        // Fallback: clip-relative seconds (0..duration)
        try { easeKeys(0, ce - cs); return true; }
        catch (eK2) { if (idx === 0) diag.push("clip-time keyframe failed: " + eK2.toString()); }

        return false;
    } catch (e) { if (idx === 0) diag.push("zoom clip threw: " + e.toString()); return false; }
}

function applyAutoZoom(optionsJson) {
    var diag = [];
    try {
        var opt = JSON.parse(optionsJson);
        var amount = parseFloat(opt.amount); if (isNaN(amount)) amount = 8;
        var style = opt.style || "alternate";
        var seq = app.project.activeSequence;
        if (!seq) return JSON.stringify({ success: false, error: "No active sequence." });

        var inS = parseFloat(seq.getInPoint()), outS = parseFloat(seq.getOutPoint());
        if (isNaN(inS) || isNaN(outS) || outS <= inS) return JSON.stringify({ success: false, error: "Set In (I) and Out (O) points first.", count: 0 });

        var count = 0, idx = 0;
        for (var v = 0; v < seq.videoTracks.numTracks; v++) {
            var trk = seq.videoTracks[v];
            for (var c = 0; c < trk.clips.numItems; c++) {
                var clip = trk.clips[c];
                var cs = ticksToSeconds(clip.start.ticks), ce = ticksToSeconds(clip.end.ticks);
                if (ce <= inS || cs >= outS) continue;   // outside In/Out
                if (_wsApplyZoomToClip(clip, amount, style, idx, diag)) count++;
                idx++;
            }
        }
        return JSON.stringify({ success: true, count: count, diag: diag });
    } catch (e) {
        return JSON.stringify({ success: false, error: e.toString(), diag: diag });
    }
}

// ── Styled text graphics via MOGRT (Essential Graphics) ───────────────────
// Places each subtitle line as an editable Motion Graphics Template clip,
// animated captions template. payload = { mogrtPath, items:[{text,start,end}], probe }.
// Times are TIMELINE seconds. EXPERIMENTAL — param names vary by PR version, so
// the diag array reports what was found for tuning.
function _wsListMgtParams(item) {
    var names = [];
    try {
        var comp = item.getMGTComponent();
        if (comp && comp.properties) {
            for (var p = 0; p < comp.properties.numItems; p++) {
                try { names.push(comp.properties[p].displayName); } catch (e) { names.push("?"); }
            }
        }
    } catch (e2) {}
    return names;
}

function _wsSetMgtText(item, text, diag, first) {
    var ok = false;
    try {
        var comp = item.getMGTComponent();
        if (!comp || !comp.properties) { if (first) diag.push("no MGT component"); return false; }
        if (first) diag.push("MGT params: " + _wsListMgtParams(item).join(" | "));
        // Pass 1: a param whose name looks like a text/source/caption field
        for (var p = 0; p < comp.properties.numItems; p++) {
            var prop = comp.properties[p], dn = "";
            try { dn = prop.displayName; } catch (e) {}
            if (/text|source|caption|subtitle|title/i.test(dn)) {
                try { prop.setValue(text, true); ok = true; break; } catch (eS) { if (first) diag.push("setValue failed on '" + dn + "': " + eS.toString()); }
            }
        }
        // Pass 2: fall back to the first param that accepts a string
        if (!ok) {
            for (var q = 0; q < comp.properties.numItems; q++) {
                try { comp.properties[q].setValue(text, true); ok = true; if (first) diag.push("text set on fallback param #" + q); break; } catch (eQ) {}
            }
        }
    } catch (e3) { if (first) diag.push("text set threw: " + e3.toString()); }
    return ok;
}

function importTextGraphics(payloadJson) {
    var diag = [];
    try {
        var seq = app.project.activeSequence;
        if (!seq) return JSON.stringify({ success: false, error: "No active sequence." });

        var data = JSON.parse(payloadJson);
        var mogrt = data.mogrtPath;
        if (!mogrt || !new File(mogrt).exists) {
            return JSON.stringify({ success: false, error: "MOGRT template not found: " + mogrt, needTemplate: true });
        }
        var items = data.items || [];
        if (!items.length) return JSON.stringify({ success: false, error: "No subtitles to place." });

        // Add a fresh video track on top so graphics never overwrite footage.
        var vIdx = seq.videoTracks.numTracks;   // index of the track we'll add
        try {
            app.enableQE();
            var qeSeq = qe.project.getActiveSequence();
            if (qeSeq) { qeSeq.addTracks(1, vIdx, 0); diag.push("added video track at " + vIdx); }
        } catch (eT) { diag.push("addTracks failed (" + eT.toString() + "); using top track"); vIdx = seq.videoTracks.numTracks - 1; }
        if (vIdx >= seq.videoTracks.numTracks) vIdx = seq.videoTracks.numTracks - 1;
        if (vIdx < 0) vIdx = 0;

        var placed = 0;
        for (var i = 0; i < items.length; i++) {
            var it = items[i];
            var startTicks = Math.round(parseFloat(it.start) * TICKS_PER_SECOND);
            var endTicks   = Math.round(parseFloat(it.end)   * TICKS_PER_SECOND);
            var newItem = null;

            try { newItem = seq.importMGT(mogrt, startTicks.toString(), vIdx, -1); }
            catch (eImp) { if (i === 0) diag.push("importMGT threw: " + eImp.toString()); }

            // Some PR versions return undefined → locate the clip we just added
            if (!newItem) {
                try {
                    var trk = seq.videoTracks[vIdx];
                    for (var c = trk.clips.numItems - 1; c >= 0; c--) {
                        if (Math.abs(parseInt(trk.clips[c].start.ticks, 10) - startTicks) < 3) { newItem = trk.clips[c]; break; }
                    }
                } catch (eFind) {}
            }
            if (!newItem) { if (i === 0) diag.push("no item created for #0"); continue; }

            // Duration: set the clip's end to the subtitle's end time
            try { newItem.end = endTicks.toString(); }
            catch (eEnd) { try { newItem.end.ticks = endTicks.toString(); } catch (eEnd2) { if (i === 0) diag.push("could not set end"); } }

            _wsSetMgtText(newItem, it.text, diag, i === 0);
            placed++;
        }

        return JSON.stringify({ success: true, placed: placed, track: vIdx, diag: diag });
    } catch (e) {
        return JSON.stringify({ success: false, error: e.toString(), diag: diag });
    }
}

// ── Read captions from the timeline (EXPERIMENTAL) ─────────────────────────
// Premiere's ExtendScript DOM has no official caption-content API; newer builds
// expose captionTracks / getCaptionTrackAt on Sequence. We probe every known
// surface and return items [{start,end,text}] or a clear "not supported" error.
function readTimelineCaptions() {
    var diag = [];
    try {
        var seq = app.project.activeSequence;
        if (!seq) return JSON.stringify({ success: false, error: "No active sequence." });

        var tracks = null;
        // Probe 1: seq.captionTracks collection
        try { if (seq.captionTracks && seq.captionTracks.numTracks > 0) tracks = seq.captionTracks; } catch (e1) { diag.push("captionTracks: " + e1.toString()); }
        // Probe 2: getCaptionTrackCount()/getCaptionTrackAt()
        var viaGetter = [];
        if (!tracks) {
            try {
                var n = seq.getCaptionTrackCount ? seq.getCaptionTrackCount() : 0;
                for (var g = 0; g < n; g++) viaGetter.push(seq.getCaptionTrackAt(g));
            } catch (e2) { diag.push("getCaptionTrackAt: " + e2.toString()); }
        }

        var trackList = [];
        if (tracks) { for (var t = 0; t < tracks.numTracks; t++) trackList.push(tracks[t]); }
        else trackList = viaGetter;

        if (!trackList.length) {
            return JSON.stringify({ success: false, diag: diag,
                error: "This Premiere version doesn't expose caption tracks to extensions. Workaround: select the caption track, File > Export > Captions to SRT, then use Load SRT." });
        }

        var items = [];
        for (var ti = 0; ti < trackList.length; ti++) {
            var trk = trackList[ti];
            var count = 0;
            try { count = trk.clips ? trk.clips.numItems : (trk.getItemCount ? trk.getItemCount() : 0); } catch (e3) {}
            for (var c = 0; c < count; c++) {
                try {
                    var it = trk.clips ? trk.clips[c] : trk.getItemAt(c);
                    var st = ticksToSeconds(it.start.ticks);
                    var en = ticksToSeconds(it.end.ticks);
                    var txt = "";
                    try { txt = it.getCaptionText ? it.getCaptionText() : (it.captionText || it.name || ""); } catch (e4) { txt = it.name || ""; }
                    if (txt) items.push({ start: st, end: en, text: String(txt) });
                } catch (e5) {}
            }
        }
        if (!items.length) {
            return JSON.stringify({ success: false, diag: diag,
                error: "Caption tracks were found but their text isn't readable via scripting on this version. Use File > Export > Captions (SRT) + Load SRT." });
        }
        items.sort(function (a, b) { return a.start - b.start; });
        return JSON.stringify({ success: true, items: items, diag: diag });
    } catch (e) {
        return JSON.stringify({ success: false, error: e.toString(), diag: diag });
    }
}

// ── Audio enhancement: import a cleaned WAV into a project bin ─────────────
function importAudioToProject(audioPath) {
    try {
        if (!new File(audioPath).exists) {
            return JSON.stringify({ success: false, error: "Enhanced file not found: " + audioPath });
        }
        var root = app.project.rootItem;
        var BIN_NAME = "Whisper Audio";
        var bin = null;
        // Reuse an existing bin if present
        for (var i = 0; i < root.children.numItems; i++) {
            var ch = root.children[i];
            try { if (ch && ch.name === BIN_NAME && ch.type === 2) { bin = ch; break; } } catch (e) {}
        }
        if (!bin) { try { bin = root.createBin(BIN_NAME); } catch (eB) {} }
        var target = bin || root;
        var ok = app.project.importFiles([audioPath], true, target, false);
        return JSON.stringify({ success: !!ok, bin: BIN_NAME, path: audioPath });
    } catch (e) {
        return JSON.stringify({ success: false, error: e.toString() });
    }
}

// ── Insert an audio file onto a NEW audio track at time 0 (beep overlay) ───
function insertAudioAtStart(audioPath) {
    try {
        if (!new File(audioPath).exists) return JSON.stringify({ success: false, error: "File not found: " + audioPath });
        var seq = app.project.activeSequence;
        if (!seq) return JSON.stringify({ success: false, error: "No active sequence." });

        // Import into the Whisper Audio bin (reuses importAudioToProject plumbing)
        var root = app.project.rootItem;
        var bin = null;
        for (var i = 0; i < root.children.numItems; i++) {
            try { if (root.children[i].name === "Whisper Audio" && root.children[i].type === 2) { bin = root.children[i]; break; } } catch (e) {}
        }
        if (!bin) { try { bin = root.createBin("Whisper Audio"); } catch (eB) {} }
        var target = bin || root;
        var before = {};
        for (var s = 0; s < target.children.numItems; s++) { try { before[target.children[s].nodeId] = true; } catch (e2) {} }
        app.project.importFiles([audioPath], true, target, false);
        var item = null;
        for (var n = target.children.numItems - 1; n >= 0; n--) {
            try { if (!before[target.children[n].nodeId]) { item = target.children[n]; break; } } catch (e3) {}
        }
        if (!item) return JSON.stringify({ success: false, error: "Import succeeded but item not found." });

        // Add a fresh audio track (QE), fall back to the last existing one.
        var aIdx = seq.audioTracks.numTracks;
        try {
            app.enableQE();
            var qeSeq = qe.project.getActiveSequence();
            if (qeSeq) { qeSeq.addTracks(0, 0, 1, 1, aIdx); }
        } catch (eT) {}
        if (aIdx >= seq.audioTracks.numTracks) aIdx = seq.audioTracks.numTracks - 1;
        if (aIdx < 0) return JSON.stringify({ success: false, error: "No audio track available." });

        var trk = seq.audioTracks[aIdx];
        try { trk.overwriteClip(item, 0); }
        catch (eO) {
            try { trk.insertClip(item, 0); }
            catch (eI) { return JSON.stringify({ success: false, error: "Could not place clip: " + eI.toString() }); }
        }
        return JSON.stringify({ success: true, track: aIdx });
    } catch (e) {
        return JSON.stringify({ success: false, error: e.toString() });
    }
}

// ── Find .srt items in the project (fallback source for "pull captions") ───
function findProjectSRTs() {
    var found = [];
    function scan(item, depth) {
        if (!item || depth > 6) return;
        var n = 0;
        try { n = item.children ? item.children.numItems : 0; } catch (e) { return; }
        for (var i = 0; i < n; i++) {
            var ch = item.children[i];
            try {
                if (ch.type === 2) { scan(ch, depth + 1); continue; }   // bin
                var p = ch.getMediaPath ? decodePath(ch.getMediaPath()) : "";
                if (p && /\.srt$/i.test(p) && new File(p).exists) found.push({ path: p, name: ch.name });
            } catch (e2) {}
        }
    }
    try { scan(app.project.rootItem, 0); } catch (e) {}
    return JSON.stringify({ success: true, items: found });
}

// ── Silence auto-cut: ripple-delete time ranges across all tracks ──────────
// rangesJson: [{start,end}] in TIMELINE seconds. EXPERIMENTAL — undoable.
function _wsGetFps(seq) {
    try {
        var s = seq.getSettings();
        if (s && s.videoFrameRate && s.videoFrameRate.seconds) return 1.0 / s.videoFrameRate.seconds;
    } catch (e) {}
    try {
        var tb = parseInt(seq.timebase, 10);   // ticks per frame
        if (tb > 0) return TICKS_PER_SECOND / tb;
    } catch (e2) {}
    return 25;
}

// Convert a QE TrackItem time (object with .ticks/.seconds, or a timecode string) to seconds
function _wsQeSecs(t, fps) {
    if (t == null) return null;
    try { if (typeof t === "object") {
        if (t.ticks != null)   return parseFloat(t.ticks) / TICKS_PER_SECOND;
        if (t.seconds != null) return parseFloat(t.seconds);
    } } catch (e) {}
    var str = String(t);
    if (str.indexOf(":") !== -1 || str.indexOf(";") !== -1) {
        var p = str.split(/[:;]/);
        if (p.length >= 4) {
            return (parseInt(p[0],10)||0)*3600 + (parseInt(p[1],10)||0)*60 +
                   (parseInt(p[2],10)||0) + (parseInt(p[3],10)||0)/fps;
        }
    }
    var f = parseFloat(str);
    return isNaN(f) ? null : f;
}

function rippleDeleteRanges(rangesJson) {
    var diag = [];
    try {
        app.enableQE();
    } catch (eQE) {
        return JSON.stringify({ success: false, error: "enableQE failed: " + eQE.toString() });
    }
    var seq = app.project.activeSequence;
    var qeSeq = null;
    try { qeSeq = qe.project.getActiveSequence(); } catch (eS) {}
    if (!seq || !qeSeq) return JSON.stringify({ success: false, error: "No active QE sequence" });

    var ranges, vSel = null, aSel = null;
    try {
        var parsed = JSON.parse(rangesJson);
        if (parsed && parsed.ranges) { ranges = parsed.ranges; vSel = parsed.v || null; aSel = parsed.a || null; }
        else ranges = parsed;
    } catch (eP) { return JSON.stringify({ success: false, error: "Bad ranges JSON" }); }
    function inSel(list, idx) {
        if (!list) return true;
        for (var q = 0; q < list.length; q++) if (list[q] === idx) return true;
        return false;
    }
    // Process from LAST to FIRST so earlier timeline positions stay valid after each ripple
    ranges.sort(function (a, b) { return b.start - a.start; });

    var fps = _wsGetFps(seq);
    var removed = 0;

    // Move CTI to a time and return the QE timecode (guarantees correct format for razor)
    function tcAt(secs) {
        var ticks = Math.round(secs * TICKS_PER_SECOND);
        try { seq.setPlayerPosition(ticks.toString()); } catch (e) {}
        try { return qeSeq.CTI.timecode; } catch (e2) { return null; }
    }
    function razorAll(secs) {
        var tc = tcAt(secs);
        if (!tc) return;
        var vN = 0, aN = 0;
        try { vN = qeSeq.numVideoTracks; } catch (e) {}
        try { aN = qeSeq.numAudioTracks; } catch (e) {}
        for (var v = 0; v < vN; v++) { if (!inSel(vSel, v)) continue; try { qeSeq.getVideoTrackAt(v).razor(tc); } catch (e3) {} }
        for (var a = 0; a < aN; a++) { if (!inSel(aSel, a)) continue; try { qeSeq.getAudioTrackAt(a).razor(tc); } catch (e4) {} }
    }
    function removeMid(midSecs) {
        var n = 0;
        function scan(track) {
            if (!track) return;
            var cnt = 0;
            try { cnt = track.numItems; } catch (e) { return; }
            for (var i = 0; i < cnt; i++) {
                var it = null;
                try { it = track.getItemAt(i); } catch (e2) { continue; }
                if (!it) continue;
                var st = null, en = null;
                try { st = _wsQeSecs(it.start, fps); en = _wsQeSecs(it.end, fps); } catch (e3) { continue; }
                if (st == null || en == null) continue;
                // skip empty/gap items
                var nm = "";
                try { nm = it.name; } catch (eN) {}
                if (nm === "" || nm == null) continue;
                if (midSecs > st + 0.002 && midSecs < en - 0.002) {
                    try { it.remove(true, true); n++; } catch (eR) { diag.push("remove threw: " + eR.toString()); }
                    return; // one item per track per range
                }
            }
        }
        var vN = 0, aN = 0;
        try { vN = qeSeq.numVideoTracks; } catch (e) {}
        try { aN = qeSeq.numAudioTracks; } catch (e) {}
        for (var v = 0; v < vN; v++) { if (!inSel(vSel, v)) continue; scan(qeSeq.getVideoTrackAt(v)); }
        for (var a = 0; a < aN; a++) { if (!inSel(aSel, a)) continue; scan(qeSeq.getAudioTrackAt(a)); }
        return n;
    }

    for (var r = 0; r < ranges.length; r++) {
        var s = parseFloat(ranges[r].start), e = parseFloat(ranges[r].end);
        if (isNaN(s) || isNaN(e) || e <= s) continue;
        razorAll(e);
        razorAll(s);
        removed += removeMid((s + e) / 2);
    }

    return JSON.stringify({ success: true, removed: removed, diag: diag });
}

// Import SRT content as captions into the active sequence
function importSRTToProject(srtContent) {
    try {
        var seq = app.project.activeSequence;
        if (!seq) return JSON.stringify({ success: false, error: "No active sequence." });

        // Write SRT to a file Premiere can access.
        // Folder.temp is sandboxed on macOS — use the project dir or Desktop instead.
        var stamp    = Math.floor(Date.now() / 1000);
        var filename = "whisper_" + stamp + ".srt";
        var tmpPath;

        try {
            // Prefer the project's own folder
            var projFile = new File(app.project.path);
            if (projFile.exists && projFile.parent && projFile.parent.exists) {
                tmpPath = projFile.parent.fsName + "/" + filename;
            }
        } catch (e2) {}

        if (!tmpPath) {
            // Fall back to ~/Desktop
            var home = $.getenv("HOME") || "/Users/" + $.getenv("USER");
            tmpPath = home + "/Desktop/" + filename;
        }

        // Clean up previous whisper_*.srt files in the same folder so they don't
        // pile up on the user's Desktop / project folder every time we send.
        try {
            var newName = new File(tmpPath).name;
            var folder  = new File(tmpPath).parent;
            if (folder && folder.exists) {
                var stale = folder.getFiles(function (fl) {
                    return (fl instanceof File) && fl.name !== newName && /^whisper_\d+\.srt$/.test(fl.name);
                });
                for (var st = 0; st < stale.length; st++) { try { stale[st].remove(); } catch (eRm) {} }
            }
        } catch (eClean) {}

        // ExtendScript on macOS defaults to CR-only (\r) line endings.
        // Premiere's SRT importer requires CRLF (\r\n) — set lineFeed explicitly.
        var f = new File(tmpPath);
        f.open("w");
        f.encoding = "UTF-8";
        f.lineFeed = "Windows";   // forces \n → \r\n when writing
        f.write(srtContent);
        f.close();

        if (!new File(tmpPath).exists) {
            return JSON.stringify({ success: false, error: "Could not write SRT file to: " + tmpPath });
        }

        var diag = [];
        var root = app.project.rootItem;
        var BIN_NAME = "Whisper Captions";

        // (A) Delete the previous "Whisper Captions" bin. Deleting a bin removes the SRT
        //     items it holds, which also removes the caption clips those items back from
        //     the timeline — so old whisper captions disappear and we don't stack up.
        for (var i = root.children.numItems - 1; i >= 0; i--) {
            var ch = root.children[i];
            try {
                if (ch && ch.name === BIN_NAME && ch.type === 2 /* BIN */) {
                    ch.deleteBin();
                    diag.push("deleted old bin");
                }
            } catch(eDel) { diag.push("deleteBin threw: " + eDel.toString()); }
        }

        // (B) Best-effort: remove tracks left empty by the deletion above (QE DOM)
        try {
            app.enableQE();
            var qeClean = qe.project.getActiveSequence();
            if (qeClean) {
                try { qeClean.removeEmptyVideoTracks(); diag.push("removeEmptyVideoTracks ok"); } catch(eV) { diag.push("removeEmptyVideoTracks: " + eV.toString()); }
                try { qeClean.removeEmptyAudioTracks(); } catch(eA) {}
            }
        } catch(eQE) { diag.push("QE cleanup skipped: " + eQE.toString()); }

        // (C) Fresh bin to hold this SRT
        var bin = null;
        try { bin = root.createBin(BIN_NAME); } catch(eBin) { diag.push("createBin threw: " + eBin.toString()); }
        var target = bin || root;

        // (D) Import the SRT into the bin, then locate the new caption projectItem
        var beforeIds = {};
        for (var s = 0; s < target.children.numItems; s++) {
            try { beforeIds[target.children[s].nodeId] = true; } catch(eSnap) {}
        }
        try {
            var ok = app.project.importFiles([tmpPath], true, target, false);
            diag.push("importFiles=" + ok);
        } catch(eImp) { diag.push("importFiles threw: " + eImp.toString()); }

        var capItem = null;
        for (var ni = target.children.numItems - 1; ni >= 0; ni--) {
            var c = target.children[ni];
            try { if (!beforeIds[c.nodeId]) { capItem = c; break; } } catch(e5) {}
        }
        // Fallback: importFiles may ignore the target bin and drop into root
        if (!capItem) {
            for (var nj = root.children.numItems - 1; nj >= 0; nj--) {
                var cj = root.children[nj];
                if (cj.name && cj.name.indexOf("whisper_") !== -1 && cj.type !== 2) { capItem = cj; break; }
            }
        }
        diag.push(capItem ? ("found item: " + capItem.name) : "NO new item found");

        // (E) Place captions on the timeline. createCaptionTrack is the correct API
        //     (insertMyselfAtTime is for media clips). SRT timestamps are absolute → tick 0.
        var startTicks = "0";
        if (capItem) {
            var attempts = [
                ["createCaptionTrack(item,'0')",    function(){ return seq.createCaptionTrack(capItem, startTicks); }],
                ["createCaptionTrack(item,'0',0)",  function(){ return seq.createCaptionTrack(capItem, startTicks, 0); }],
                ["createCaptionTrack(item,'0',1)",  function(){ return seq.createCaptionTrack(capItem, startTicks, 1); }],
                ["insertMyselfAtTime(item,'0')",    function(){ capItem.insertMyselfAtTime(startTicks, seq); return true; }]
            ];
            for (var b = 0; b < attempts.length; b++) {
                try {
                    var r = attempts[b][1]();
                    diag.push(attempts[b][0] + " => " + r);
                    if (r !== false && r !== null) {
                        return JSON.stringify({
                            success: true, autoAdded: true, srtPath: tmpPath,
                            message: "Captions added to timeline!", diag: diag
                        });
                    }
                } catch(eAtt) {
                    diag.push(attempts[b][0] + " threw: " + eAtt.toString());
                }
            }
        }

        // Could not auto-place — return path + diagnostics for manual import
        return JSON.stringify({ success: true, autoAdded: false, srtPath: tmpPath, diag: diag });

    } catch (e) {
        return JSON.stringify({ success: false, error: "Import error: " + e.toString() });
    }
}

// ── Named chapter/hook markers ─────────────────────────────────────────────
// payload = [{start:sec, name:"...", comment:"..."}]
function addNamedMarkers(json) {
    try {
        var seq = app.project.activeSequence;
        if (!seq) return JSON.stringify({ success: false, error: "No active sequence." });
        var items = JSON.parse(json);
        var added = 0;
        for (var i = 0; i < items.length; i++) {
            var t = parseFloat(items[i].start);
            if (isNaN(t) || t < 0) continue;
            var mk = seq.markers.createMarker(t);
            try {
                mk.name = items[i].name || ("Marker " + (i + 1));
                if (items[i].comment) mk.comments = items[i].comment;
                if (mk.setColorByIndex) mk.setColorByIndex(items[i].color != null ? items[i].color : 4);
            } catch (eM) {}
            added++;
        }
        return JSON.stringify({ success: true, added: added });
    } catch (e) {
        return JSON.stringify({ success: false, error: e.toString() });
    }
}

// ── Vertical / square copy of the active sequence ─────────────────────────
// payload = {w, h, label}. Clones the sequence, changes frame size, scales
// every video clip to cover the new frame (center crop). EXPERIMENTAL:
// clone()/setSettings() need Premiere 2019+; no subject tracking.
function createResizedSequence(optJson) {
    var diag = [];
    try {
        var opt = JSON.parse(optJson);
        var w = parseInt(opt.w, 10), h = parseInt(opt.h, 10);
        if (!w || !h) return JSON.stringify({ success: false, error: "Bad target size." });
        var seq = app.project.activeSequence;
        if (!seq) return JSON.stringify({ success: false, error: "No active sequence." });

        var oldW = 0, oldH = 0;
        try { var os_ = seq.getSettings(); oldW = os_.videoFrameWidth; oldH = os_.videoFrameHeight; }
        catch (eO) { return JSON.stringify({ success: false, error: "This Premiere version can't read sequence settings (needs 2019+)." }); }

        var before = {};
        for (var i = 0; i < app.project.sequences.numSequences; i++) {
            try { before[app.project.sequences[i].sequenceID] = 1; } catch (eB) {}
        }
        try { seq.clone(); }
        catch (eC) { return JSON.stringify({ success: false, error: "Sequence clone failed: " + eC.toString() }); }

        var dup = null;
        for (var j = 0; j < app.project.sequences.numSequences; j++) {
            var s2 = app.project.sequences[j];
            var sid = ""; try { sid = s2.sequenceID; } catch (eI) {}
            if (sid && !before[sid]) { dup = s2; break; }
        }
        if (!dup) return JSON.stringify({ success: false, error: "Cloned sequence not found." });
        try { dup.name = seq.name + " · " + (opt.label || (w + "x" + h)); } catch (eN) {}

        try {
            var st = dup.getSettings();
            st.videoFrameWidth = w;
            st.videoFrameHeight = h;
            dup.setSettings(st);
        } catch (eS) {
            return JSON.stringify({ success: false, error: "Could not change frame size: " + eS.toString() });
        }
        var factor = Math.max(w / oldW, h / oldH);
        var count = 0, skipped = 0;
        for (var v = 0; v < dup.videoTracks.numTracks; v++) {
            var trk = dup.videoTracks[v];
            for (var c = 0; c < trk.clips.numItems; c++) {
                var clip = trk.clips[c];
                var motion = null, comps = clip.components;
                if (!comps) continue;
                for (var m = 0; m < comps.numItems; m++) {
                    var dn = ""; try { dn = comps[m].displayName; } catch (eD) {}
                    if (dn === "Motion" || dn === "Hareket") { motion = comps[m]; break; }
                }
                if (!motion) continue;
                var scale = null;
                for (var p = 0; p < motion.properties.numItems; p++) {
                    var pn = ""; try { pn = motion.properties[p].displayName; } catch (eP) {}
                    if (pn === "Scale" || pn === "Ölçek") { scale = motion.properties[p]; break; }
                }
                if (!scale) continue;
                // setValue on a keyframed (time-varying) property hard-crashes
                // Premiere — skip those clips and report them instead
                var tv = false;
                try { tv = scale.isTimeVarying(); } catch (eTv) {}
                if (tv) { skipped++; continue; }
                try {
                    var cur = 100;
                    try { cur = parseFloat(scale.getValue()); if (isNaN(cur)) cur = 100; } catch (eG) {}
                    scale.setValue(cur * factor, true);
                    count++;
                    // optional anchor (0-8 grid): shift Position so the chosen
                    // corner/edge of the (now overflowing) picture stays in frame
                    if (opt.anchor != null && opt.anchor !== 4) {
                        var posP = _wsFindMotionProp(clip, ["Position", "Konum"]);
                        var ptv = false;
                        try { ptv = posP && posP.isTimeVarying(); } catch (ePtv) {}
                        if (posP && !ptv) {
                            var ax = (opt.anchor % 3) * 0.5, ay = Math.floor(opt.anchor / 3) * 0.5;
                            var ox = Math.max(0, (oldW * factor) / w - 1);
                            var oy = Math.max(0, (oldH * factor) / h - 1);
                            try { posP.setValue([0.5 + (0.5 - ax) * ox, 0.5 + (0.5 - ay) * oy], true); } catch (ePos) {}
                        }
                    }
                } catch (eV) { if (count === 0) diag.push("scale set: " + eV.toString()); }
            }
        }
        try { app.project.activeSequence = dup; } catch (eA) { diag.push("activate: " + eA.toString()); }
        return JSON.stringify({ success: true, count: count, skipped: skipped, name: dup.name, diag: diag });
    } catch (e) {
        return JSON.stringify({ success: false, error: e.toString(), diag: diag });
    }
}

// ── Select the whole sequence as the working range (In=0, Out=content end) ─
function wsSelectWholeRange() {
    try {
        var seq = app.project.activeSequence;
        if (!seq) return JSON.stringify({ success: false, error: "No active sequence." });
        var end = seqContentEnd(seq);
        if (!end || end <= 0) return JSON.stringify({ success: false, error: "Timeline is empty." });
        seq.setInPoint(0);
        seq.setOutPoint(end);
        return JSON.stringify({ success: true, end: end });
    } catch (e) {
        return JSON.stringify({ success: false, error: e.toString() });
    }
}

// ── Zoom Pro: trigger-based zooms with anchor, style and handheld ──────────
// payload = { times:[sec], useCuts, amount(105-150), anchor(0-8),
//             style:"smooth"|"jump"|"snap", handheld:bool }
function _wsFindMotionProp(clip, names) {
    try {
        var comps = clip.components;
        for (var i = 0; i < comps.numItems; i++) {
            var dn = ""; try { dn = comps[i].displayName; } catch (e) {}
            if (dn === "Motion" || dn === "Hareket") {
                var mo = comps[i];
                for (var p = 0; p < mo.properties.numItems; p++) {
                    var pn = ""; try { pn = mo.properties[p].displayName; } catch (e2) {}
                    for (var n = 0; n < names.length; n++) if (pn === names[n]) return mo.properties[p];
                }
            }
        }
    } catch (e3) {}
    return null;
}
function _wsZoomEvent(clip, t0, t1, opt, diag) {
    var scale = _wsFindMotionProp(clip, ["Scale", "Ölçek"]);
    if (!scale) return 0;
    var pos = (opt.anchor !== 4) ? _wsFindMotionProp(clip, ["Position", "Konum"]) : null;
    var target = opt.amount || 120;
    var ax = (opt.anchor % 3) * 0.5, ay = Math.floor(opt.anchor / 3) * 0.5;
    function posFor(v) {
        var f = v / 100 - 1;
        return [0.5 + (0.5 - ax) * f, 0.5 + (0.5 - ay) * f];
    }
    var keys = 0;
    function key(t, v) {
        try {
            scale.addKey(t); scale.setValueAtKey(t, v, true); keys++;
            if (pos) { try { pos.addKey(t); pos.setValueAtKey(t, posFor(v), true); } catch (eP) {} }
        } catch (eK) { if (diag.length < 3) diag.push("key@" + t.toFixed(2) + ": " + eK.toString()); }
    }
    try { scale.setTimeVarying(true); } catch (eTV) {}
    if (pos) { try { pos.setTimeVarying(true); } catch (eTV2) {} }

    var ramp = opt.style === "smooth" ? 0.6 : 0.25;
    key(Math.max(t0 - 0.04, 0), 100);
    if (opt.style === "jump") {
        key(t0, target);
    } else if (opt.style === "snap") {
        key(t0 + ramp * 0.7, Math.min(target * 1.04, target + 6));
        key(t0 + ramp, target);
    } else {
        var STEPS = 4;
        for (var s = 1; s <= STEPS; s++) {
            var p = s / STEPS;
            key(t0 + ramp * p, 100 + (target - 100) * (1 - Math.pow(1 - p, 2)));
        }
    }
    // hold (with optional handheld jitter on Position), then settle back
    var back = 0.35, holdEnd = t1 - back;
    if (opt.handheld && pos && holdEnd > t0 + ramp + 0.4) {
        var jt = t0 + ramp + 0.4, jn = 0;
        while (jt < holdEnd && jn < 14) {
            try {
                pos.addKey(jt);
                var b = posFor(target);
                pos.setValueAtKey(jt, [b[0] + (Math.random() - 0.5) * 0.006, b[1] + (Math.random() - 0.5) * 0.006], true);
            } catch (eJ) {}
            jt += 0.45; jn++;
        }
    }
    key(Math.max(holdEnd, t0 + ramp + 0.05), target);
    key(t1, 100);
    return keys;
}
function wsZoomPro(optJson) {
    var diag = [];
    try {
        var opt = JSON.parse(optJson);
        var seq = app.project.activeSequence;
        if (!seq) return JSON.stringify({ success: false, error: "No active sequence." });
        var inS = readPointSecs(seq, "in"), outS = readPointSecs(seq, "out");
        if (isNaN(inS) || isNaN(outS) || outS <= inS) { inS = 0; outS = seqContentEnd(seq); }
        if (!outS || outS <= 0) return JSON.stringify({ success: false, error: "Timeline is empty." });

        var times = [];
        var given = opt.times || [];
        for (var g = 0; g < given.length; g++) {
            var tv = parseFloat(given[g]);
            if (!isNaN(tv) && tv >= inS && tv < outS) times.push(tv);
        }
        // collect topmost video clips (and cut-trigger times)
        var clips = [];
        for (var v = seq.videoTracks.numTracks - 1; v >= 0; v--) {
            var trk = seq.videoTracks[v];
            for (var c = 0; c < trk.clips.numItems; c++) {
                var clip = trk.clips[c];
                var cs = ticksToSeconds(clip.start.ticks), ce = ticksToSeconds(clip.end.ticks);
                if (ce <= inS || cs >= outS) continue;
                clips.push({ clip: clip, cs: cs, ce: ce });
                if (opt.useCuts && cs > inS + 0.2) times.push(cs);
            }
        }
        if (!clips.length) return JSON.stringify({ success: false, error: "No video clips in the range." });
        if (!times.length) times.push(inS);   // at least one zoom at range start

        times.sort(function (a, b) { return a - b; });
        var evs = [];
        for (var i = 0; i < times.length; i++)
            if (!evs.length || times[i] - evs[evs.length - 1] >= 1.5) evs.push(times[i]);

        var applied = 0, keys = 0;
        for (var e2 = 0; e2 < evs.length; e2++) {
            var t = evs[e2];
            var host = null;
            for (var k = 0; k < clips.length; k++)
                if (t >= clips[k].cs - 0.05 && t < clips[k].ce) { host = clips[k]; break; }
            if (!host) continue;
            var tEnd = Math.min(
                (e2 + 1 < evs.length) ? evs[e2 + 1] - 0.2 : t + 4,
                host.ce - 0.05, outS, t + 5);
            if (tEnd - t < 0.6) continue;
            var kk = _wsZoomEvent(host.clip, Math.max(t, host.cs + 0.02), tEnd, opt, diag);
            if (kk > 0) { applied++; keys += kk; }
        }
        return JSON.stringify({ success: applied > 0, count: applied, keys: keys,
                                error: applied ? undefined : "Could not apply any zoom (see diag)", diag: diag });
    } catch (e) {
        return JSON.stringify({ success: false, error: e.toString(), diag: diag });
    }
}

// ── Podcast multicam: disable video-track clips while their speaker is
//    not talking. payload = { segs:[{start,end,spk}], videoMap:{trackIndex:spk} }
//    Only razors + disables the mapped video tracks — nothing is deleted.
function wsMulticamApply(payloadJson) {
    var diag = [];
    try { app.enableQE(); } catch (eQE) {
        return JSON.stringify({ success: false, error: "enableQE failed: " + eQE.toString() });
    }
    var seq = app.project.activeSequence;
    var qeSeq = null;
    try { qeSeq = qe.project.getActiveSequence(); } catch (eS) {}
    if (!seq || !qeSeq) return JSON.stringify({ success: false, error: "No active QE sequence" });
    try {
        var data = JSON.parse(payloadJson);
        var segs = data.segs || [];
        var map = data.videoMap || {};
        if (!segs.length) return JSON.stringify({ success: false, error: "No switch segments." });

        function tcAt(secs) {
            var ticks = Math.round(secs * TICKS_PER_SECOND);
            try { seq.setPlayerPosition(ticks.toString()); } catch (e) {}
            try { return qeSeq.CTI.timecode; } catch (e2) { return null; }
        }

        var disabled = 0, tracksDone = 0;
        for (var key in map) {
            if (!map.hasOwnProperty(key)) continue;
            var T = parseInt(key, 10);
            var S = map[key];
            if (isNaN(T) || T < 0 || T >= seq.videoTracks.numTracks) continue;

            // merge consecutive foreign segments into cut ranges
            var foreign = [], cur = null;
            for (var i = 0; i < segs.length; i++) {
                if (segs[i].spk === S) { cur = null; continue; }
                if (cur && Math.abs(segs[i].start - cur.end) < 0.01) cur.end = segs[i].end;
                else { cur = { start: segs[i].start, end: segs[i].end }; foreign.push(cur); }
            }
            var qet = null;
            try { qet = qeSeq.getVideoTrackAt(T); } catch (eT) {}
            for (var f = 0; f < foreign.length; f++) {
                if (!qet) break;
                var tc1 = tcAt(foreign[f].start), tc2 = tcAt(foreign[f].end);
                try { if (tc1) qet.razor(tc1); } catch (eR1) { if (diag.length < 3) diag.push("razor: " + eR1.toString()); }
                try { if (tc2) qet.razor(tc2); } catch (eR2) {}
            }
            var trk = seq.videoTracks[T];
            for (var c = 0; c < trk.clips.numItems; c++) {
                var clip = trk.clips[c];
                var cs, ce;
                try { cs = ticksToSeconds(clip.start.ticks); ce = ticksToSeconds(clip.end.ticks); } catch (e0) { continue; }
                for (var f2 = 0; f2 < foreign.length; f2++) {
                    if (cs >= foreign[f2].start - 0.05 && ce <= foreign[f2].end + 0.05) {
                        try { clip.disabled = true; disabled++; } catch (eD) { if (diag.length < 3) diag.push("disable: " + eD.toString()); }
                        break;
                    }
                }
            }
            tracksDone++;
        }
        return JSON.stringify({ success: tracksDone > 0, tracks: tracksDone, disabled: disabled, diag: diag });
    } catch (e) {
        return JSON.stringify({ success: false, error: e.toString(), diag: diag });
    }
}


// ── Track inventory for track-targeted cutting ─────────────────────────────
function wsListAllTracks() {
    try {
        var seq = app.project.activeSequence;
        if (!seq) return JSON.stringify({ success: false, error: "No active sequence." });
        var out = { success: true, video: [], audio: [] };
        for (var v = 0; v < seq.videoTracks.numTracks; v++) {
            var vt = seq.videoTracks[v], vn = "";
            try { vn = vt.name || ""; } catch (eV) {}
            out.video.push({ i: v, label: "V" + (v + 1) + (vn ? " \u00b7 " + vn : ""), clips: vt.clips.numItems });
        }
        for (var a = 0; a < seq.audioTracks.numTracks; a++) {
            var at = seq.audioTracks[a], an = "";
            try { an = at.name || ""; } catch (eA) {}
            out.audio.push({ i: a, label: "A" + (a + 1) + (an ? " \u00b7 " + an : ""), clips: at.clips.numItems });
        }
        return JSON.stringify(out);
    } catch (e) {
        return JSON.stringify({ success: false, error: e.toString() });
    }
}

// ── Sync-safe range cutter for TARGETED tracks ────────────────────────────
// Premiere blocks a ripple when any UNLOCKED track has content spanning the
// gap — that is why cutting a subset of tracks left holes. So: temporarily
// LOCK every unselected track (locked tracks neither block the ripple nor
// shift), razor the selected tracks, delete the middles without ripple, then
// close each hole with a single gap ripple. Locks are restored afterwards.
// payload = { ranges, v:[idx], a:[idx] }
function wsCutRangesSync(payloadJson) {
    var diag = [];
    try { app.enableQE(); } catch (eQE) {
        return JSON.stringify({ success: false, error: "enableQE failed: " + eQE.toString() });
    }
    var seq = app.project.activeSequence;
    var qeSeq = null;
    try { qeSeq = qe.project.getActiveSequence(); } catch (eS) {}
    if (!seq || !qeSeq) return JSON.stringify({ success: false, error: "No active QE sequence" });
    try {
        var data = JSON.parse(payloadJson);
        var ranges = data.ranges || [];
        var vSel = data.v || [];
        var aSel = data.a || [];
        ranges.sort(function (a, b) { return b.start - a.start; });   // last → first

        var fps = _wsGetFps(seq);
        function tcAt(secs) {
            var ticks = Math.round(secs * TICKS_PER_SECOND);
            try { seq.setPlayerPosition(ticks.toString()); } catch (e) {}
            try { return qeSeq.CTI.timecode; } catch (e2) { return null; }
        }
        function inList(list, idx) {
            for (var q = 0; q < list.length; q++) if (list[q] === idx) return true;
            return false;
        }
        function qeTrack(kind, idx) {
            try { return kind === "v" ? qeSeq.getVideoTrackAt(idx) : qeSeq.getAudioTrackAt(idx); } catch (e) { return null; }
        }
        function setLock(kind, idx, state) {
            var qt = qeTrack(kind, idx);
            try { if (qt && qt.setLock) { qt.setLock(state); return true; } } catch (e) {}
            return false;
        }

        // lock every track that is NOT selected; remember what we locked
        var vN = 0, aN = 0;
        try { vN = qeSeq.numVideoTracks; } catch (e) {}
        try { aN = qeSeq.numAudioTracks; } catch (e) {}
        var locked = [], lockFail = 0, k;
        for (k = 0; k < vN; k++) if (!inList(vSel, k)) { if (setLock("v", k, true)) locked.push(["v", k]); else lockFail++; }
        for (k = 0; k < aN; k++) if (!inList(aSel, k)) { if (setLock("a", k, true)) locked.push(["a", k]); else lockFail++; }
        function unlockAll() {
            for (var u = 0; u < locked.length; u++) setLock(locked[u][0], locked[u][1], false);
        }
        if (lockFail > 0) {
            unlockAll();
            return JSON.stringify({ success: false, error: "This Premiere version can't lock tracks from a script — use all-tracks cutting instead.", diag: diag });
        }

        function selTracks() {
            var out = [], i;
            for (i = 0; i < vSel.length; i++) { var t1 = qeTrack("v", vSel[i]); if (t1) out.push(t1); }
            for (i = 0; i < aSel.length; i++) { var t2 = qeTrack("a", aSel[i]); if (t2) out.push(t2); }
            return out;
        }
        function itemAtMid(track, mid) {
            var cnt = 0;
            try { cnt = track.numItems; } catch (e) { return null; }
            for (var i = 0; i < cnt; i++) {
                var it = null;
                try { it = track.getItemAt(i); } catch (e2) { continue; }
                if (!it) continue;
                var st = null, en = null;
                try { st = _wsQeSecs(it.start, fps); en = _wsQeSecs(it.end, fps); } catch (e3) { continue; }
                if (st == null || en == null) continue;
                if (mid > st + 0.002 && mid < en - 0.002) return it;
            }
            return null;
        }

        var removed = 0, holes = 0;
        for (var r = 0; r < ranges.length; r++) {
            var s0 = parseFloat(ranges[r].start), e0 = parseFloat(ranges[r].end);
            if (isNaN(s0) || isNaN(e0) || e0 <= s0) continue;
            var tcE = tcAt(e0), tcS = tcAt(s0);
            if (!tcS || !tcE) continue;
            var trks = selTracks(), t;
            for (t = 0; t < trks.length; t++) {
                try { trks[t].razor(tcE); } catch (e1) {}
                try { trks[t].razor(tcS); } catch (e2) {}
            }
            var mid = (s0 + e0) / 2;
            // delete the middle chunks WITHOUT ripple (positions stay stable)
            for (t = 0; t < trks.length; t++) {
                var it = itemAtMid(trks[t], mid);
                var nm = ""; try { nm = it && it.name; } catch (eN) {}
                if (it && nm) {
                    try { it.remove(false, false); removed++; }
                    catch (eR) { if (diag.length < 4) diag.push("remove: " + eR.toString()); }
                }
            }
            // close the hole once. QE's gap-removal API is undocumented and
            // varies by build, so try each known call and VERIFY the gap is
            // actually gone before trusting it (some calls no-op silently).
            function gapAt(track) {
                var g = itemAtMid(track, mid);
                if (!g) return null;
                var nm = "x"; try { nm = g.name; } catch (eG) {}
                return (nm === "" || nm == null) ? g : null;   // only true gaps
            }
            function gapStillThere(track) { return gapAt(track) != null; }
            var closedHole = false;
            for (t = 0; t < trks.length && !closedHole; t++) {
                var track = trks[t];
                if (!gapStillThere(track)) { closedHole = true; break; }
                var g1 = gapAt(track);
                if (g1) {
                    try { if (g1.rippleDelete) g1.rippleDelete(); } catch (eH1) { if (diag.length < 6) diag.push("rippleDelete: " + eH1.toString()); }
                    if (!gapStillThere(track)) { closedHole = true; break; }
                }
                var g2 = gapAt(track);
                if (g2) {
                    try { g2.remove(true, true); } catch (eH2) { if (diag.length < 6) diag.push("gap remove(t,t): " + eH2.toString()); }
                    if (!gapStillThere(track)) { closedHole = true; break; }
                }
                var g3 = gapAt(track);
                if (g3) {
                    try { g3.remove(true, false); } catch (eH3) { if (diag.length < 6) diag.push("gap remove(t,f): " + eH3.toString()); }
                    if (!gapStillThere(track)) { closedHole = true; break; }
                }
                if (diag.length < 6) {
                    var ms = [], pr;
                    var gx = gapAt(track);
                    if (gx) { for (pr in gx) { try { if (typeof gx[pr] === "function") ms.push(pr); } catch (eP) {} } }
                    diag.push("gap methods: " + ms.join(","));
                }
            }
            if (!closedHole) holes++;
        }
        unlockAll();
        return JSON.stringify({ success: true, removed: removed, holes: holes, diag: diag });
    } catch (e) {
        try {
            // best-effort unlock if something blew up mid-way
            var vN2 = qeSeq.numVideoTracks, aN2 = qeSeq.numAudioTracks, z;
            for (z = 0; z < vN2; z++) { try { qeSeq.getVideoTrackAt(z).setLock(false); } catch (u1) {} }
            for (z = 0; z < aN2; z++) { try { qeSeq.getAudioTrackAt(z).setLock(false); } catch (u2) {} }
        } catch (eU) {}
        return JSON.stringify({ success: false, error: e.toString(), diag: diag });
    }
}
