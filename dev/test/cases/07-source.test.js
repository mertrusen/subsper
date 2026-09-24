group("Premiere speech source and suspect transcript");

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
