#!/usr/bin/env python3
"""Emit a standalone HTML page that exercises the segment list in a real DOM.

The unit suite runs in JavaScriptCore, which has no DOM, so it cannot see the
part of the editor users actually touch: clicking a word to split, the action
buttons, double-click to edit. That wiring moved from a thousand inline
onclick attributes to one delegated listener, and "it parses" is not evidence
that a click still lands on the right handler.

This reuses build-bundle.py's extractor, so the page runs the REAL functions
from extension/js/main.js — not a copy that drifts.

    dev/test/build-dom-harness.py out.html
    open out.html          # results render on the page and go to the console
"""
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from importlib import import_module

bundle = import_module("build-bundle".replace("-", "_")) if False else None
# build-bundle.py has a hyphen, so import it by path instead.
import importlib.util
spec = importlib.util.spec_from_file_location("bb", HERE / "build-bundle.py")
bb = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bb)

ROOT = HERE.parents[1]
SRC = ROOT / "extension" / "js" / "main.js"

WANTED = [
    "escRe", "WORD_CHARS", "wordRe", "upperIn", "matchCase",
    "p2", "p3", "formatTime", "escHtml", "highlightMatches",
    "splitPoint", "cutSegment", "splitSegmentHalf", "splitAtWord",
    "sourceInfo", "formatClock",
    "renderSegments", "_segDelegationBound", "bindSegmentDelegation", "selectSegment",
    "deleteSegment", "editSegment", "syncControlVisibility", "updateSegCount",
]

STUBS = """
var segments = [], selectedIndex = -1, activeFindRegex = null, findMatchSegs = [];
var settings = { uiLang: "en" };
var segmentsWrap = document.getElementById("segments");
var segCountEl = null, actionsBar = { style: {} }, sendBtn = { };
var calls = [];
function icon(n) { return '<span class="ic" data-icon="' + n + '"></span>'; }
function t(k) { return k; }
function seekToSegment(i) { calls.push("seek:" + i); }
function renameSpeaker(s) { calls.push("rename:" + s); }
function pushUndo() {}
function showToast() {}
function setStatus() {}
function seg(text, start, end, words) {
  return { id: 0, text: text, start: start, end: end,
           seqStart: start, seqEnd: end, words: words || [] };
}
function W(w, s, e) { return { word: w, start: s, end: e }; }
"""

FRAMEWORK = """
var _pass = 0, _fail = 0, _log = [];
function say(s) { _log.push(s); }
function ok(name, cond) {
  if (cond) { _pass++; say("  ok   " + name); }
  else { _fail++; say("  FAIL " + name); }
}
function eq(name, got, want) {
  var g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { _pass++; say("  ok   " + name); }
  else { _fail++; say("  FAIL " + name + "\\n        got  " + g + "\\n        want " + w); }
}
function group(n) { say("\\n— " + n + " —"); }
function click(el, opts) {
  el.dispatchEvent(new MouseEvent("click", Object.assign({ bubbles: true }, opts || {})));
}
function dblclick(el) { el.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); }
function report() {
  say("\\n" + _pass + " passed, " + _fail + " failed");
  document.getElementById("out").textContent = _log.join("\\n");
  document.getElementById("out").className = _fail ? "fail" : "pass";
  console.log(_log.join("\\n"));
  window.__RESULT__ = { pass: _pass, fail: _fail, text: _log.join("\\n") };
  // The headless runner reads the TITLE, not the body: --dump-dom gives a
  // single line for it, whereas scraping a multi-line <div> out of serialised
  // HTML is fragile enough to fail for reasons unrelated to the tests.
  document.title = "SUBSPER-DOM pass=" + _pass + " fail=" + _fail;
}
"""

TESTS = r"""
group("rendering");
segments = [
  seg("Kanser hücreleri kontrolsüz ve hızlı büyürler.", 4.98, 7.82,
      [W("Kanser",4.98,5.32),W("hücreleri",5.32,5.9),W("kontrolsüz",5.9,6.55),
       W("ve",6.55,6.7),W("hızlı",6.7,7.05),W("büyürler.",7.2,7.82)]),
  seg("Kemoterapi ilaçları vücutta çok hızlı çoğalan", 8.36, 10.84),
];
renderSegments();
var els = segmentsWrap.querySelectorAll(".segment");
eq("renders one node per segment", els.length, 2);
eq("first segment shows its index", els[0].querySelector(".seg-index").textContent, "1");
eq("timecodes rendered", els[0].querySelector(".seg-time").textContent,
   "00:00:04,980 → 00:00:07,820");
eq("words are split into spans", els[0].querySelectorAll(".seg-word").length, 6);
ok("no inline onclick attributes remain",
   segmentsWrap.innerHTML.indexOf("onclick=") === -1);

group("word click splits");
calls = [];
var words = els[0].querySelectorAll(".seg-word");
click(words[5]);                       // the LAST word — the original bug
eq("clicking the last word splits it off", segments.length, 3);
eq("first half", segments[0].text, "Kanser hücreleri kontrolsüz ve hızlı");
eq("second half", segments[1].text, "büyürler.");
ok("clicking a word does not also seek", calls.indexOf("seek:0") === -1);

group("action buttons");
renderSegments();
els = segmentsWrap.querySelectorAll(".segment");
var before = segments.length;
click(els[2].querySelector('[data-act="delete"]'));
eq("delete button removes the segment", segments.length, before - 1);

calls = [];
renderSegments();
els = segmentsWrap.querySelectorAll(".segment");
// A click lands on the ICON inside the button, which carries no data-act.
var iconInsideButton = els[0].querySelector('[data-act="split"] .ic')
                    || els[0].querySelector('[data-act="split"]').firstChild;
click(iconInsideButton);
ok("clicking the icon inside Split does not also seek", calls.indexOf("seek:0") === -1);

group("seek");
calls = [];
renderSegments();
els = segmentsWrap.querySelectorAll(".segment");
click(els[0].querySelector(".seg-index"));
eq("index seeks", calls, ["seek:0"]);
calls = [];
click(els[1].querySelector(".seg-time"));
eq("timecode seeks", calls, ["seek:1"]);
calls = [];
click(els[1]);                          // blank area of the row
eq("clicking the row seeks", calls, ["seek:1"]);

group("edit");
renderSegments();
els = segmentsWrap.querySelectorAll(".segment");
dblclick(els[0].querySelector(".seg-text"));
var ta = segmentsWrap.querySelector("textarea");
ok("double-click opens a textarea", !!ta);
if (ta) {
  ta.value = "  yeni   metin  ";
  ta.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  eq("Enter saves and collapses whitespace", segments[0].text, "yeni metin");
  ok("textarea is gone after saving", !segmentsWrap.querySelector("textarea"));
}

group("selection");
renderSegments();
selectSegment(1);
eq("one segment is selected", segmentsWrap.querySelectorAll(".segment.selected").length, 1);
selectSegment(0);
eq("selecting another moves it, not adds", segmentsWrap.querySelectorAll(".segment.selected").length, 1);
eq("the right one is selected",
   segmentsWrap.querySelector(".segment.selected").dataset.idx, "0");

group("delegation survives rebuilds");
calls = [];
for (var i = 0; i < 5; i++) renderSegments();
els = segmentsWrap.querySelectorAll(".segment");
click(els[0].querySelector(".seg-index"));
eq("still exactly one handler after five rebuilds", calls, ["seek:0"]);

group("empty state");
// Nothing here runs while a transcript exists, which is why it went untested
// and why a change to it can break unnoticed.
segments = [];
sourceInfo = null;
renderSegments();
ok("shows an empty state", !!segmentsWrap.querySelector(".empty-state"));
ok("no segments rendered", segmentsWrap.querySelectorAll(".segment").length === 0);
ok("no source line before the probe answers", !segmentsWrap.querySelector(".empty-src"));

sourceInfo = { label: "Sequence 01", detail: "4:12 konuşma" };
renderSegments();
var srcEl = segmentsWrap.querySelector(".empty-src");
ok("source line appears once known", !!srcEl);
ok("names the sequence", srcEl && srcEl.textContent.indexOf("Sequence 01") !== -1);
ok("says how much speech", srcEl && srcEl.textContent.indexOf("4:12") !== -1);

sourceInfo = { label: "Açık sekans yok", detail: "", warn: true };
renderSegments();
ok("a missing sequence is flagged, not silent",
   segmentsWrap.querySelector(".empty-src.warn") !== null);

// The label comes from Premiere and is not ours to trust.
sourceInfo = { label: '<img src=x onerror="window.__XSS__=1">', detail: "" };
renderSegments();
// escHtml turns the tags into text, so "onerror=" still appears in innerHTML
// as escaped characters — searching for that string reports a break that is
// not there. What matters is that no element was created and nothing ran.
ok("sequence name is escaped, not executed",
   !window.__XSS__ && segmentsWrap.querySelector("img") === null);
ok("and it is still shown to the user as text",
   (segmentsWrap.querySelector(".empty-src") || {}).textContent.indexOf("<img") !== -1);

eq("mm:ss for humans", [formatClock(0), formatClock(9), formatClock(252), formatClock(3661)],
   ["0:00", "0:09", "4:12", "61:01"]);

group("scale");
segments = [];
for (var i = 0; i < 800; i++) {
  segments.push(seg("bu bir test cümlesi ve biraz daha uzun olsun diye " + i, i, i + 1));
}
var t0 = performance.now();
renderSegments();
var t1 = performance.now();
eq("renders 800 segments", segmentsWrap.querySelectorAll(".segment").length, 800);
say("        800-segment render: " + (t1 - t0).toFixed(1) + " ms");
ok("under 400 ms", (t1 - t0) < 400);
calls = [];
click(segmentsWrap.querySelectorAll(".segment")[799].querySelector(".seg-index"));
eq("last of 800 still responds", calls, ["seek:799"]);

report();
"""


def main() -> None:
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("dom-harness.html")
    src = SRC.read_text(encoding="utf-8")
    css = (ROOT / "extension" / "css" / "style.css").read_text(encoding="utf-8")
    code = "\n".join(bb.extract(src, n) for n in WANTED)

    html = f"""<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Subsper — DOM harness</title>
<style>{css}</style>
<style>
  body {{ margin: 0; font: 13px/1.5 ui-monospace, Menlo, monospace; }}
  #segments {{ height: 240px; overflow: auto; border-bottom: 2px solid #444; }}
  #out {{ white-space: pre; padding: 12px; font-size: 12px; }}
  #out.pass {{ color: #7bb389; }} #out.fail {{ color: #c4726a; }}
</style></head>
<body>
  <div id="segments"></div>
  <div id="out">running…</div>
<script>
{STUBS}
{FRAMEWORK}
// ─── real code, extracted from extension/js/main.js ───
{code}
// ─── tests ───
try {{ {TESTS} }} catch (e) {{
  document.getElementById("out").className = "fail";
  document.getElementById("out").textContent = "CRASHED: " + e.message + "\\n" + e.stack;
  window.__RESULT__ = {{ pass: 0, fail: 1, text: "CRASHED: " + e.message }};
}}
</script></body></html>"""
    out.write_text(html, encoding="utf-8")
    print(f"[dom-harness] {out}")


if __name__ == "__main__":
    main()
