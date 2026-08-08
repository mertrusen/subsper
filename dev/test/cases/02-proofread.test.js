group("offline proofreader (no AI)");

(function turkish() {
    resetEnv({
        lang: "tr",
        segments: [
            { text: "herkez  gitti .yarın bir kaç kişi gelecek!!!" },
            { text: "istanbul'a  gittik ,çok güzeldi" },
            { text: "ve sonra eve döndük." },
            { text: "fiyat 3,14 ve saat 10:30 idi" },
        ],
    });
    applyProofread({ silent: true });
    eq("typo + spacing + sentence caps", segments[0].text, "Herkes gitti. Yarın birkaç kişi gelecek!");
    eq("Turkish i becomes İ, not I", segments[1].text, "İstanbul'a gittik, çok güzeldi");
    eq("continuation of an unfinished sentence stays lowercase",
       segments[2].text, "ve sonra eve döndük.");
    eq("decimals and clock times survive", segments[3].text, "Fiyat 3,14 ve saat 10:30 idi");
})();

(function englishStaysEnglish() {
    resetEnv({ lang: "en", segments: [{ text: "teh meeting  was seperate .i think alot of people came" }] });
    applyProofread({ silent: true });
    eq("english typos and standalone i", segments[0].text,
       "The meeting was separate. I think a lot of people came");
})();

(function idempotent() {
    // Running it twice must not keep changing the text — otherwise every run
    // shows spurious "N fixes" and users stop trusting it.
    resetEnv({ lang: "tr", segments: [{ text: "Herkes gitti. Yarın birkaç kişi gelecek!" }] });
    applyProofread({ silent: true });
    var once = segments[0].text;
    applyProofread({ silent: true });
    eq("clean text is left alone", segments[0].text, once);
    eq("and it is the expected text", once, "Herkes gitti. Yarın birkaç kişi gelecek!");
})();

(function preservesCase() {
    resetEnv({ lang: "tr", segments: [{ text: "Herkez geldi." }] });
    applyProofread({ silent: true });
    eq("capitalised typo stays capitalised", segments[0].text, "Herkes geldi.");
})();

(function languageSniffing() {
    resetEnv({ lang: "", segments: [{ text: "çok güzel bir şey oldu" }] });
    eq("Turkish detected from the text when no language is set", proofLang(), "tr");
    resetEnv({ lang: "", segments: [{ text: "just a plain english line" }] });
    eq("English otherwise", proofLang(), "en");
})();

(function reportsWhatItDid() {
    resetEnv({ lang: "tr", segments: [{ text: "herkez  geldi" }] });
    applyProofread();
    ok("tells the user something changed", _toasts.length > 0 || _statuses.length > 0);
    resetEnv({ lang: "tr", segments: [{ text: "Herkes geldi." }] });
    applyProofread();
    ok("says so when nothing needed fixing", _toasts.length > 0);
})();

(function doesNotTouchWhatItCannotJudge() {
    // de/da, ki and proper nouns need meaning, not rules — they belong to the
    // AI pass. Rule-based edits here would corrupt correct text.
    resetEnv({ lang: "tr", segments: [{ text: "Ali de geldi ve dedi ki gidiyorum." }] });
    applyProofread({ silent: true });
    eq("separate 'de' and 'ki' left alone", segments[0].text, "Ali de geldi ve dedi ki gidiyorum.");
})();
