group("transcript clean-up · Turkish word boundaries");

// These encode the behaviour users pay for. They fail against the old
// ASCII-\b matching, which never matched a word starting or ending in
// ç/ğ/ı/ö/ş/ü — because a space and "ş" are both non-word characters, so no
// boundary exists between them.

(function fillersThatUsedToBeInvisible() {
    resetEnv({ segments: [
        { text: "şey bugün geldim" },
        { text: "ııı bilmiyorum" },
        { text: "yani öyle işte" },
    ] });
    removeFillers({ silent: true });
    eq("'şey' is removed", segments[0].text, "Bugün geldim");
    eq("'ııı' is removed", segments[1].text, "Bilmiyorum");
    eq("ASCII-safe fillers still work", segments[2].text, "Öyle");
})();

(function fillersInsideWordsAreSafe() {
    // "şeyler" and "yanisi" contain filler strings but are real words.
    resetEnv({ segments: [{ text: "şeyler getirdim" }, { text: "peyzaj güzel" }] });
    removeFillers({ silent: true });
    eq("does not eat 'şeyler'", segments[0].text, "Şeyler getirdim");
    eq("does not eat inside other words", segments[1].text, "Peyzaj güzel");
})();

(function profanityEndingInTurkishLetters() {
    resetEnv({ segments: [
        { text: "bu oç ne diyor" },
        { text: "tam bir piç" },
    ], profanityMode: "asterisk", profStem: false });
    censorProfanity({ silent: true });
    ok("'oç' is censored", segments[0].text.indexOf("oç") === -1);
    ok("'piç' is censored", segments[1].text.indexOf("piç") === -1);
})();

(function inflectedProfanity() {
    // Two separate Turkish problems land here. The trailing \b dropped forms
    // ending in ü/ı/ş, and consonant softening (k→ğ) means the stem itself is
    // not a substring of the inflected word: "yarrak" appears nowhere inside
    // "yarrağı".
    resetEnv({ segments: [
        { text: "şu amcığı gördün mü" },
        { text: "yarrağı yedik" },
        { text: "götü kalktı" },
        { text: "siktiğimin işi" },
    ], profanityMode: "asterisk", profStem: true });
    censorProfanity({ silent: true });
    ok("softened 'amcığı' censored", segments[0].text.indexOf("amcığı") === -1);
    ok("softened 'yarrağı' censored", segments[1].text.indexOf("yarrağı") === -1);
    ok("'götü' censored", segments[2].text.indexOf("götü") === -1);
    ok("'siktiğimin' censored", segments[3].text.indexOf("siktiğimin") === -1);

    // The suffix has to be swallowed whole. The old pattern matched the bare
    // stem inside the word and left the ending stranded ("g**ü").
    ok("no stranded suffix letter left behind", !/[*]+[a-zçğıöşü]/.test(segments[2].text));
})();

(function softeningIsOnlyForStemming() {
    resetEnv({ segments: [{ text: "yarrağı yedik" }], profStem: false });
    censorProfanity({ silent: true });
    eq("with stemming off the inflected form is left alone",
       segments[0].text, "yarrağı yedik");
})();

(function profanityDoesNotOvermatch() {
    // "sikke" (coin) and "götürdü" (took) must survive; over-censoring is a
    // worse bug than under-censoring for a paid product.
    resetEnv({ segments: [{ text: "eski bir sikke buldum" }], profStem: false });
    censorProfanity({ silent: true });
    eq("'sikke' untouched with stemming off", segments[0].text, "eski bir sikke buldum");
})();

(function customDictionary() {
    resetEnv({
        segments: [{ text: "şarz aleti nerede" }, { text: "kablo şarzı bitti" }],
        customDict: "şarz=şarj",
    });
    applyDictionary({ silent: true });
    eq("dictionary rule with a Turkish-letter word applies", segments[0].text, "şarj aleti nerede");
    eq("but only on whole words", segments[1].text, "kablo şarzı bitti");
})();

(function dictionaryKeepsCase() {
    resetEnv({ segments: [{ text: "Şarz bitti" }], customDict: "şarz=şarj" });
    applyDictionary({ silent: true });
    ok("replacement is applied", segments[0].text.toLowerCase().indexOf("şarj") !== -1);
})();

group("punctuation filter");

(function punctuationFilter() {
    resetEnv({ segments: [{ text: "Merhaba, dünya! Nasılsın?" }] });
    settings.punctAllowed = "";
    applyPunctuationFilter({ silent: true });
    eq("empty allow-list strips punctuation", segments[0].text, "Merhaba dünya Nasılsın");
    settings.punctAllowed = ".,?!:;\"'()[]{}-";
})();
