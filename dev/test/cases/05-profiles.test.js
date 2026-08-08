group("settings profiles");

(function roundTrip() {
    resetEnv({});
    localStorage.clear();
    settings.maxCharsPerLine = 32;
    settings.maxCps = 12;
    settings.fillerWords = "şey, hani";
    settings.stylePreset = "bold";

    ok("saving needs a name", saveProfile("   ") === false);
    ok("saves under a name", saveProfile("Müşteri A") === true);
    eq("appears in the list", Object.keys(listProfiles()), ["Müşteri A"]);

    // Change everything, then load the profile back.
    settings.maxCharsPerLine = 99;
    settings.maxCps = 99;
    settings.fillerWords = "";
    settings.stylePreset = "clean";
    ok("loads", loadProfile("Müşteri A") === true);
    eq("line length restored", settings.maxCharsPerLine, 32);
    eq("reading speed restored", settings.maxCps, 12);
    eq("word lists restored", settings.fillerWords, "şey, hani");
    eq("style restored", settings.stylePreset, "bold");
})();

(function neverStoresSecrets() {
    resetEnv({});
    localStorage.clear();
    // These live on the person, not the project. A profile shared with a
    // colleague must not carry a paid API key or a licence with it.
    settings.geminiApiKey = "SECRET-KEY";
    settings.anthropicApiKey = "SECRET-KEY-2";
    settings.pexelsKey = "SECRET-KEY-3";
    saveProfile("shared");
    const blob = JSON.stringify(listProfiles());
    ok("no API key ends up in the profile", blob.indexOf("SECRET-KEY") === -1);
    ok("nothing licence-shaped either", blob.indexOf("licen") === -1);
})();

(function deleteAndMissing() {
    resetEnv({});
    localStorage.clear();
    saveProfile("temp");
    ok("deletes", deleteProfile("temp") === true);
    eq("gone from the list", Object.keys(listProfiles()), []);
    ok("deleting a missing one is harmless", deleteProfile("temp") === false);
    ok("loading a missing one fails cleanly", loadProfile("nope") === false);
})();

(function overwrite() {
    resetEnv({});
    localStorage.clear();
    settings.maxCps = 10; saveProfile("A");
    settings.maxCps = 20; saveProfile("A");
    eq("same name overwrites rather than duplicating", Object.keys(listProfiles()).length, 1);
    settings.maxCps = 99;
    loadProfile("A");
    eq("keeps the newer values", settings.maxCps, 20);
})();

group("bilingual SRT");

(function bilingual() {
    resetEnv({ segments: [
        { text: "Kanser hücreleri hızlı büyür.", seqStart: 0, seqEnd: 2 },
        { text: "Kemoterapi bunu hedef alır.",  seqStart: 2, seqEnd: 4 },
    ] });
    _aiOutput = "1. Cancer cells grow fast.\n2. Chemotherapy targets that.";

    const srt = buildBilingualSRT("source-first");
    ok("produces a file", !!srt);
    ok("keeps the original", srt.indexOf("Kanser hücreleri hızlı büyür.") !== -1);
    ok("adds the translation", srt.indexOf("Cancer cells grow fast.") !== -1);
    ok("original sits above the translation",
       srt.indexOf("Kanser hücreleri hızlı büyür.") < srt.indexOf("Cancer cells grow fast."));
    ok("timecodes survive", srt.indexOf("00:00:00,000 --> 00:00:02,000") !== -1);

    const flipped = buildBilingualSRT("translation-first");
    ok("order can be flipped",
       flipped.indexOf("Cancer cells grow fast.") < flipped.indexOf("Kanser hücreleri hızlı büyür."));
})();

(function bilingualNeedsBothLanguages() {
    resetEnv({ segments: [{ text: "tek dil", seqStart: 0, seqEnd: 1 }] });
    _aiOutput = "";
    eq("no translation means no file, not a half-broken one", buildBilingualSRT("source-first"), null);
})();

(function bilingualSkipsIdenticalLines() {
    // A line the model returned unchanged should not be printed twice.
    resetEnv({ segments: [{ text: "OK", seqStart: 0, seqEnd: 1 }] });
    _aiOutput = "1. OK";
    const srt = buildBilingualSRT("source-first");
    eq("identical line appears once", (srt.match(/OK/g) || []).length, 1);
})();
