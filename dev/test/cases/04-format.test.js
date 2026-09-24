group("subtitle formatting");

(function wrapping() {
    eq("short line is not wrapped", wrapText("kısa satır", 42, 2), "kısa satır");
    var wrapped = wrapText("Kanser hücreleri kontrolsüz ve hızlı büyürler ve yayılırlar", 30, 2);
    ok("long line gains a break", wrapped.indexOf("\n") !== -1);
    eq("never exceeds the line budget", wrapped.split("\n").length <= 2, true);
})();

(function visualLinePreviewAndManualEdits() {
    var text = "bir iki uc dort bes alti yedi";
    var lines = captionVisualLines(text, { width: 9 }, function (s) { return s.length; });
    eq("font-metric preview shows the third-line word", lines[2].startWord, 4);
    var words = [W("bir", 0, 1), W("iki", 1, 2), W("uc", 2, 3), W("dort", 3, 4),
                 W("bes", 4, 5), W("alti", 5, 6), W("yedi", 6, 7)];
    var source = { id: 0, text: text, start: 0, end: 7, seqStart: 10, seqEnd: 17, words: words };
    resetEnv({ segments: [source] });
    splitAtWord(0, 4);
    eq("manual split keeps all words", segments.map(function (s) { return s.text; }).join(" "), text);
    eq("manual split preserves sequence start", segments[0].seqStart, 10);
    eq("manual split preserves sequence end", segments[1].seqEnd, 17);
    mergeWithPrevious(1);
    eq("merge reverses manual split text", segments[0].text, text);
    eq("merge restores the full time span", [segments[0].seqStart, segments[0].seqEnd], [10, 17]);
    eq("merge restores timed words", segments[0].words.length, 7);
    settings.autoSplit = true;
    eq("Premiere SRT keeps manually chosen cue without character wrapping",
       premiereCaptionSRT([source]).split("\n").slice(2, 3)[0], text);
    settings.autoSplit = false;
})();

(function timecodes() {
    eq("SRT timecode format", formatTime(0), "00:00:00,000");
    eq("sub-second precision", formatTime(4.98), "00:00:04,980");
    eq("minutes and hours roll over", formatTime(3661.5), "01:01:01,500");
    eq("SRT rounding carries into next minute", formatTime(59.9996), "00:01:00,000");
    eq("ASS rounding carries into next minute", fmtASS(59.999), "0:01:00.00");
})();

(function editedWordsAndFormats() {
    resetEnv({ segments: [seg("corrected", 0, 1, [W("original", 0, 1)])] });
    eq("word export uses corrected text", buildWordSRT().indexOf("corrected") > 0, true);
    segments = [seg("two edited", 0, 1, [W("original", 0, 1)])];
    ok("word count change still exports edited tokens", buildWordSRT().indexOf("two\n\n2\n") !== -1 && buildWordSRT().indexOf("edited") !== -1);
    settings.gapFill = true; settings.gapMax = 2;
    segments = [seg("A", 0, 1), seg("B", 2, 3)];
    ok("SRT shares gap fill policy", segmentsToSRT().indexOf("00:00:00,000 --> 00:00:02,000") !== -1);
    settings.gapFill = false;
})();

(function subtitleAnimations() {
    var cue = seg("Deneme", 1, 3);
    settings.styleAnimation = "none";
    eq("no animation leaves ASS text plain", assEffectTag(cue), "");
    settings.styleAnimation = "fade"; settings.styleAnimationMs = 220;
    eq("fade exports ASS entry and exit", assEffectTag(cue), "{\\fad(220,220)}");
    settings.styleAnimation = "pop";
    ok("pop exports scale transition", assEffectTag(cue).indexOf("\\t(0,220,\\fscx100\\fscy100)") !== -1);
    settings.styleAnimation = "bounce";
    ok("bounce exports two-stage scale", (assEffectTag(cue).match(/\\t\(/g) || []).length === 2);
    settings.styleAnimationMs = 700;
    ok("short cue caps animation duration", assEffectTag(seg("x", 0, .3)).indexOf("700") === -1);
    settings.styleAnimation = "none";
})();

group("auto-format (smart split)");

(function splitsOnlyWhatNeedsIt() {
    var opt = { maxCharsPerLine: 42, maxLines: 2, maxCps: 17, maxDur: 7 };
    var short = { id: 0, text: "kısa", start: 0, end: 1, seqStart: 0, seqEnd: 1, words: [] };
    eq("a short segment is left alone", applySmartSplit([short], opt).length, 1);

    var longText = "bir iki üç dört beş altı yedi sekiz dokuz on " +
                   "on bir on iki on üç on dört on beş on altı on yedi";
    var long = { id: 0, text: longText, start: 0, end: 20, seqStart: 0, seqEnd: 20, words: [] };
    var out = applySmartSplit([long], opt);
    ok("an over-long segment is split", out.length > 1);
    ok("every piece fits the budget", out.every(function (s) {
        return s.text.length <= opt.maxCharsPerLine * opt.maxLines;
    }));
    ok("pieces stay in time order", out.every(function (s, i) {
        return i === 0 || out[i - 1].end <= s.start + 1e-9;
    }));
    eq("ids are renumbered", out.map(function (s) { return s.id; }),
       out.map(function (_, i) { return i; }));
})();

(function usesWordTimingsWhenPresent() {
    var opt = { maxCharsPerLine: 10, maxLines: 1, maxCps: 99, maxDur: 99 };
    var words = [W("bir", 0, 1), W("iki", 1, 2), W("üç", 2, 3), W("dört", 3, 4)];
    var s = { id: 0, text: "bir iki üç dört", start: 0, end: 4, seqStart: 0, seqEnd: 4, words: words };
    var out = applySmartSplit([s], opt);
    ok("split by real word times", out.length > 1);
    eq("first piece starts at the first word", out[0].start, 0);
    eq("last piece ends at the last word", out[out.length - 1].end, 4);
})();
