group("subtitle formatting");

(function wrapping() {
    eq("short line is not wrapped", wrapText("kısa satır", 42, 2), "kısa satır");
    var wrapped = wrapText("Kanser hücreleri kontrolsüz ve hızlı büyürler ve yayılırlar", 30, 2);
    ok("long line gains a break", wrapped.indexOf("\n") !== -1);
    eq("never exceeds the line budget", wrapped.split("\n").length <= 2, true);
})();

(function timecodes() {
    eq("SRT timecode format", formatTime(0), "00:00:00,000");
    eq("sub-second precision", formatTime(4.98), "00:00:04,980");
    eq("minutes and hours roll over", formatTime(3661.5), "01:01:01,500");
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
