#!/usr/bin/env python3
"""Assert that a tool page shows only its own tool.

Subtitles and Batch share #panel-tx-work, so "which page am I on" is decided by
CSS (the data-ui2page rules in ui-v2.css) rather than by applyView(). That was
not a style preference: applyView walks the DOM once, when the page opens, and
the batch card is injected after that — so for months it sat on the Subtitles
page permanently, eating ~140px of a panel that has none to spare.

A CSS contract needs a CSS test. This renders the real markup with the real
stylesheets, drives the body attributes exactly as ui2Open() does, and asks the
browser what is actually on screen at each state. It also pins the structural
half of the fix — the batch card must not be a child of .controls again, or the
CSS has nothing to hide independently.

    dev/test/build-page-isolation.py [out.html]
    dev/test/page-isolation.sh              # headless
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EXT = ROOT / "extension"

# Exactly what injectBatch() builds, minus the handlers. Kept in this shape so
# the test fails loudly if the injection point moves back inside .controls.
BATCH_CARD = """
<div id="batch-card" class="setting-item tool-card">
  <div class="setting-row"><div class="setting-info">
    <div class="setting-name">Toplu Transcribe (sekanslar)</div>
    <div class="setting-desc">Projedeki birden çok sekansı sırayla yazıya döker.</div>
  </div></div>
  <button class="btn-load-srt" id="batch-scan" style="width:100%; margin-top:4px">1 · Sekansları Tara</button>
  <div id="batch-list"></div>
  <button class="btn-transcribe btn-compact" id="batch-run" style="display:none; margin-top:8px">2 · Toplu Başlat</button>
</div>
"""

HARNESS = """
<script>
(function () {
  var log = [], pass = 0, fail = 0;
  function shown(sel) {
    var el = document.querySelector(sel);
    if (!el) return null;                      // missing is not the same as hidden
    return el.getClientRects().length > 0;
  }
  function check(name, got, want) {
    if (got === want) { pass++; log.push("ok   " + name); }
    else { fail++; log.push("FAIL " + name + " — bekleniyor " + want + ", gelen " + got); }
  }
  function state(page) {
    document.body.classList.toggle("ui2-home", page === null);
    if (page === null) document.body.removeAttribute("data-ui2page");
    else document.body.setAttribute("data-ui2page", page);
    document.body.offsetHeight;                // force layout before measuring
  }

  // Structure: the card must be a sibling of .controls, not a child of it.
  // Inside .controls no selector can hide it without hiding the buttons too.
  var card = document.getElementById("batch-card");
  check("batch-card DOM'da", !!card, true);
  check("batch-card .controls'un cocugu DEGIL", !!(card && card.closest(".controls")), false);
  check("batch-card panel-tx-work icinde", !!(card && card.closest("#panel-tx-work")), true);

  state(null);
  check("ana ekran: batch karti gizli", shown("#batch-card"), false);

  state("subtitles");
  check("Altyazi sayfasi: batch karti gizli",  shown("#batch-card"), false);
  check("Altyazi sayfasi: kontroller gorunur", shown("#panel-tx-work .controls"), true);
  check("Altyazi sayfasi: transkript gorunur", shown("#panel-tx-work .work-right"), true);

  // Premiere's transcript should claim the title space as soon as it scrolls.
  // Its primary action must remain in the same row and to the right of tools.
  document.body.classList.add("premiere-app", "v3-caption-scrolled");
  check("kaydirilan altyazida baslik kapanir", shown("#page-bar"), false);
  state("settings");
  check("ayarlar sayfasinda baslik gorunur", shown("#page-bar"), true);
  document.body.classList.remove("v3-caption-scrolled");
  state("subtitles");
  check("yukari donunce baslik gorunur", shown("#page-bar"), true);
  var bar = document.getElementById("actions-bar");
  bar.style.display = "flex";
  var tools = document.getElementById("actions-tools");
  var send = document.getElementById("send-btn");
  check("araclar gonderme dugmesinden ayri", !!(tools && send && tools.parentElement === bar && send.parentElement === bar), true);
  check("gonderme dugmesi ayni satirda", Math.abs(send.getBoundingClientRect().top - tools.getBoundingClientRect().top) < 2, true);
  check("gonderme dugmesi en sagda", send.getBoundingClientRect().right <= bar.getBoundingClientRect().right + 1 && send.getBoundingClientRect().left >= tools.getBoundingClientRect().right - 1, true);

  state("batch");
  check("Toplu sayfasi: batch karti gorunur",  shown("#batch-card"), true);
  check("Toplu sayfasi: Tara butonu gorunur",  shown("#batch-scan"), true);
  check("Toplu sayfasi: kontroller gizli",     shown("#panel-tx-work .controls"), false);
  check("Toplu sayfasi: transkript gizli",     shown("#panel-tx-work .work-right"), false);
  check("Toplu sayfasi: durum cubugu gorunur", shown("#status-bar"), true);

  // Leaving the page must put things back — a one-way rule would strand the
  // user on an empty Subtitles page after one visit to Batch.
  state("subtitles");
  check("geri donus: kontroller yeniden gorunur", shown("#panel-tx-work .controls"), true);
  check("geri donus: batch karti yeniden gizli",  shown("#batch-card"), false);

  var out = document.createElement("div");
  out.id = "iso-out";
  out.textContent = log.join(" | ");
  document.body.appendChild(out);
  document.title = "SUBSPER-ISO pass=" + pass + " fail=" + fail;
})();
</script>
"""


def build() -> str:
    html = (EXT / "index.html").read_text(encoding="utf-8")
    # No Node, no Premiere host. The cascade does not need either.
    html = re.sub(r"<script\b.*?</script>", "", html, flags=re.S)

    # Inject the batch card where injectBatch() puts it: immediately after the
    # .controls block, inside .work-left.
    marker = '<input type="file" id="srt-file-input" accept=".srt" style="display:none">\n    </div>'
    if marker not in html:
        raise SystemExit("build-page-isolation: .controls block not found — "
                         "markup moved, update this harness before trusting it")
    html = html.replace(marker, marker + BATCH_CARD, 1)
    return html.replace("</body>", HARNESS + "</body>")


def main() -> None:
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("page-isolation.html")
    out.write_text(build(), encoding="utf-8")
    for sub in ("css", "js"):
        d = out.parent / sub
        d.mkdir(parents=True, exist_ok=True)
        for f in (EXT / sub).glob("*"):
            if f.is_file():
                (d / f.name).write_bytes(f.read_bytes())
    print(f"[iso] {out}")


if __name__ == "__main__":
    main()
