group("segment splitting");

// The regression this suite exists for: clicking the LAST word used to be
// swallowed by a `wi >= words.length - 1` guard, so the line stayed long and
// Premiere word-wrapped it onto a second line — which reads exactly like
// someone hit Enter instead of cutting.
(function lastWordSplit() {
    var words = [
        W("Kanser", 4.98, 5.32), W("hücreleri", 5.32, 5.90),
        W("kontrolsüz", 5.90, 6.55), W("ve", 6.55, 6.70),
        W("hızlı", 6.70, 7.05), W("büyürler.", 7.20, 7.82),
    ];
    resetEnv({ segments: [seg("Kanser hücreleri kontrolsüz ve hızlı büyürler.", 4.98, 7.82, words)] });
    splitAtWord(0, 5);

    eq("clicking the last word splits", segments.length, 2);
    eq("first half text", segments[0].text, "Kanser hücreleri kontrolsüz ve hızlı");
    eq("second half text", segments[1].text, "büyürler.");
    near("cut lands in the gap between words", segments[0].end, 7.125);
    eq("halves meet with no gap", segments[0].end, segments[1].start);
    eq("word list is split, not duplicated",
       [segments[0].words.length, segments[1].words.length], [5, 1]);
    eq("second half owns the right word", segments[1].words[0].word, "büyürler.");
    eq("ids renumbered", segments.map(function (s) { return s.id; }), [0, 1]);
})();

(function guards() {
    resetEnv({ segments: [seg("bir iki üç", 0, 3)] });
    splitAtWord(0, 0);
    eq("wi=0 stays a no-op (nothing precedes it)", segments.length, 1);

    resetEnv({ segments: [seg("bir iki üç", 0, 3)] });
    splitAtWord(0, 9);
    eq("out-of-range index is a no-op", segments.length, 1);

    resetEnv({ segments: [seg("tekkelime", 0, 3)] });
    splitSegmentHalf(0);
    eq("single-word segment cannot be halved", segments.length, 1);
})();

(function fallbackWithoutWordTimings() {
    // Text edited by hand → word list no longer lines up → proportional split.
    resetEnv({ segments: [seg("bir iki üç", 0, 3)] });
    splitAtWord(0, 1);
    eq("still splits without timings", segments.length, 2);
    near("proportional cut point", segments[0].end, 1.0);
    eq("no stale word timings carried over", segments[0].words.length, 0);
})();

(function mismatchedWordListFallsBack() {
    // A three-word text but only two timed words: trusting the list would
    // mis-time the cut, so it must fall back to interpolation.
    resetEnv({ segments: [seg("bir iki üç", 0, 3, [W("bir", 0, 1), W("iki", 1, 2)])] });
    splitAtWord(0, 1);
    eq("mismatch still splits", segments.length, 2);
    near("used the proportional path", segments[0].end, 1.0);
})();

(function sequenceAxisFollows() {
    // Media time and sequence time differ by an offset; both must stay in step.
    resetEnv({ segments: [{ id: 0, text: "bir iki üç dört", start: 0, end: 6,
                            seqStart: 10, seqEnd: 16, words: [] }] });
    splitSegmentHalf(0);
    eq("halves at the word midpoint", texts(), ["bir iki", "üç dört"]);
    eq("sequence offset preserved", [segments[0].seqEnd, segments[1].seqStart], [13, 13]);
    eq("media axis matches", [segments[0].end, segments[1].start], [3, 3]);
})();

(function repeatedSplitsStayConsistent() {
    var words = [W("a", 0, 1), W("b", 1, 2), W("c", 2, 3), W("d", 3, 4)];
    resetEnv({ segments: [seg("a b c d", 0, 4, words)] });
    splitAtWord(0, 2);          // → "a b" | "c d"
    splitAtWord(0, 1);          // → "a" | "b" | "c d"
    eq("three segments after two splits", texts(), ["a", "b", "c d"]);
    eq("every segment keeps its own words",
       segments.map(function (s) { return s.words.length; }), [1, 1, 2]);
    eq("timings stay monotonic",
       segments[0].end <= segments[1].start && segments[1].end <= segments[2].start, true);
})();
