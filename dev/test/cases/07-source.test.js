group("Premiere speech source and suspect transcript");

(function playbackShortcutRegistration() {
    var captured = [];
    var cep = { registerKeyEventsInterest: function (s) { captured.push(JSON.parse(s)); return true; } };
    eq("macOS Space is registered with native key code", registerPremierePlaybackShortcut(cep, "darwin"), true);
    eq("macOS key interest is unmodified Space", captured[0], [{ keyCode: 49, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false }]);
    registerPremierePlaybackShortcut(cep, "win32");
    eq("Windows uses VK_SPACE without intercepting another key", captured[1], [{ keyCode: 32, ctrlKey: false, altKey: false, shiftKey: false }]);
    eq("missing CEP API leaves host shortcut alone", registerPremierePlaybackShortcut({}, "darwin"), false);
})();

(function sourceSelection() {
    var info = { allClips: [
        { path: "camera.mov", track: "video0" },
        { path: "music.wav", track: "audio0" },
        { path: "mic.wav", track: "audio1" },
    ] };
    eq("auto prefers camera sound over mixed audio", chooseTranscriptionClips(info, "auto").clips[0].path, "camera.mov");
    eq("explicit mic track contains only mic", chooseTranscriptionClips(info, "audio1").clips.map(function (c) { return c.path; }), ["mic.wav"]);
    eq("missing track cannot silently fall back", chooseTranscriptionClips(info, "audio7").clips.length, 0);
    eq("audio-only auto chooses one track", chooseTranscriptionClips({ allClips: info.allClips.slice(1) }, "auto").clips.map(function (c) { return c.path; }), ["music.wav"]);
    eq("silence analysis follows the caption source", silenceSourceInfo({ sequenceName: "S", allClips: info.allClips, duration: 3 }).clips.map(function (c) { return c.path; }), ["camera.mov"]);
    settings.silenceAudioSource = "audio1";
    eq("explicit silence source excludes music", silenceSourceInfo({ sequenceName: "S", allClips: info.allClips, duration: 3 }).clips.map(function (c) { return c.path; }), ["mic.wav"]);
    settings.silenceAudioSource = "same";
    var layered = { allClips: info.allClips.concat([{ path: "overlay.mov", track: "video1" }]) };
    eq("automatic camera source ignores overlay video", chooseTranscriptionClips(layered, "auto").clips.map(function (c) { return c.path; }), ["camera.mov"]);
    eq("explicit video source also ignores overlay video", chooseTranscriptionClips(layered, "video").clips.map(function (c) { return c.path; }), ["camera.mov"]);
})();

(function captionGapFallback() {
    transcriptSequenceName = "Current";
    settings.silenceMinDur = 0.6;
    segments = [
        { text: "Konuşma", seqStart: 0, seqEnd: 2 },
        { text: "Devam", seqStart: 3.2, seqEnd: 5 },
        { text: "Bitiş", seqStart: 5.2, seqEnd: 7 },
    ];
    var seq = { sequenceName: "Current", inTime: 0, outTime: 8 };
    eq("caption fallback finds only a real speech gap", transcriptGapRanges(seq).map(function (r) { return [r.start, r.end, r.selected]; }), [[2, 3.2, false]]);
    eq("caption fallback refuses stale sequence", transcriptGapRanges({ sequenceName: "Other", inTime: 0, outTime: 8 }), []);
    transcriptSequenceName = null; segments = [];
})();


(function suspectResult() {
    var repeated = [
        { text: "Thank you.", start: 0, end: 29.98 },
        { text: "Thank you.", start: 30, end: 43.58 },
    ];
    eq("repeated long English placeholder is rejected", isLikelyHallucinatedTranscript(repeated, 43.58), true);
    eq("short genuine thanks are not rejected", isLikelyHallucinatedTranscript(repeated, 10), false);
    eq("varied speech is accepted", isLikelyHallucinatedTranscript([
        { text: "Merhaba nasılsınız", start: 0, end: 15 },
        { text: "Bu konuda konuşalım", start: 15, end: 30 },
    ], 30), false);
})();
