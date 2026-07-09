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
        var seq = app.project.activeSequence;
        if (!seq) return JSON.stringify({ success: false, error: "No active sequence." });
        var EDGE = 0.03;   // seconds of ramp on each side

        for (var t = 0; t < seq.audioTracks.numTracks; t++) {
            if (t === skipTrack) continue;
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

    var ranges;
    try { ranges = JSON.parse(rangesJson); } catch (eP) { return JSON.stringify({ success: false, error: "Bad ranges JSON" }); }
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
        for (var v = 0; v < vN; v++) { try { qeSeq.getVideoTrackAt(v).razor(tc); } catch (e3) {} }
        for (var a = 0; a < aN; a++) { try { qeSeq.getAudioTrackAt(a).razor(tc); } catch (e4) {} }
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
        for (var v = 0; v < vN; v++) scan(qeSeq.getVideoTrackAt(v));
        for (var a = 0; a < aN; a++) scan(qeSeq.getAudioTrackAt(a));
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
