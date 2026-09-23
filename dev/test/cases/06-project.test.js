group("project and text cuts");

(function projectRoundTrip() {
    resetEnv({ segments: [seg("saved text", 0, 1)] });
    window.__SUBSPER_MEDIA__ = "/video.mp4";
    _originalSegments = [{ seqStart: 0, seqEnd: 4 }];
    settings.subPosX = 23; settings.subPosY = 44; settings.subMaxW = 60;
    settings.styleAnimation = "bounce"; settings.styleAnimationMs = 320;
    settings.speakerColors = { A: "FF0000" };
    var data = _projectData();
    eq("project remembers media", data.mediaPath, "/video.mp4");
    eq("project remembers text-cut baseline", data.originalSegments, [{ seqStart: 0, seqEnd: 4 }]);
    eq("project remembers position", [data.settings.subPosX, data.settings.subPosY, data.settings.subMaxW], [23, 44, 60]);
    eq("project remembers subtitle animation", [data.settings.styleAnimation, data.settings.styleAnimationMs], ["bounce", 320]);
    settings.aiProvider = "gemini";
    data.settings.aiProvider = "custom";
    data.settings.customApiUrl = "https://example.invalid";
    data.settings.customStyle = { font: 'Arial"><img src=x>', primary: "not-a-color", size: 99999 };
    _loadProjectData(data);
    eq("project cannot change AI provider", settings.aiProvider, "gemini");
    eq("project preserves restored media reference", window.__SUBSPER_MEDIA__, "/video.mp4");
    eq("project restores text-cut baseline", _originalSegments, [{ seqStart: 0, seqEnd: 4 }]);
    eq("project rejects unsafe font and color", [settings.customStyle.font, settings.customStyle.primary], ["Arial", "FFFFFF"]);
    eq("project bounds style size", settings.customStyle.size, 160);
    data.settings.styleAnimation = "bad-effect"; data.settings.styleAnimationMs = 9999;
    _loadProjectData(data);
    eq("project rejects invalid animation settings", [settings.styleAnimation, settings.styleAnimationMs], ["bounce", 320]);
    throws("rejects invalid subtitle time", function () {
        _loadProjectData({ app: "subsper", segments: [{ seqStart: 2, seqEnd: 1, text: "bad" }] });
    });
})();

(function partialDeletion() {
    _originalSegments = [{ seqStart: 0, seqEnd: 10 }];
    segments = [seg("first", 0, 4)];
    eq("right half is removed", computeDeletedRanges(), [{ start: 4, end: 10 }]);
    segments = [seg("second", 4, 10)];
    eq("left half is removed", computeDeletedRanges(), [{ start: 0, end: 4 }]);
    segments = [seg("whole", 0, 10)];
    eq("kept segment has no cuts", computeDeletedRanges(), []);
})();
