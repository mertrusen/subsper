#!/usr/bin/env python3
"""Render the REAL home screen at docked panel sizes.

build-panel-sizes.py renders hand-written sample markup, which is fine for
testing the shell but cannot show what renderHome() actually produces. This
loads the real ui-v2.js against stubs for the handful of globals it takes from
main.js, so the home screen you see is the one that ships.

Each size gets its own iframe: media queries measure the viewport, and inside
CEP the panel IS the viewport.

    dev/test/build-home-preview.py [outdir]
    open <outdir>/home-preview.html
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EXT = ROOT / "extension"

SIZES = [
    (260, 620, "sliver"),
    (320, 480, "narrow + short"),
    (360, 560, "common dock"),
    (420, 680, "roomy"),
    (520, 400, "shelf"),
]

# Everything ui-v2.js reaches for outside its own IIFE.
STUBS = """
  var settings = { uiLang: "tr", theme: "dark" };
  var APP_VERSION = "1.3.0";
  var currentSubTab = { transcribe: "work", edit: "work", audio: "work", setup: "main" };
  var sourceInfo = __SOURCE__;
  function $(id) { return document.getElementById(id); }
  function switchMainTab() {}
  function switchSubTab() {}
  function toggleAiPanel() {}
  function maybeShowOnboarding() {}
  function setLanguage() {}
  window.__licensingEnabled = false;
  __DESK__
"""

PAGE = """<!doctype html><html lang="tr"><head><meta charset="utf-8">
<title>Subsper — yeni ana ekran</title>
<style>
  :root{color-scheme:dark}
  body{margin:0;background:#0d1113;color:#e9eff2;
       font:14px/1.5 system-ui,-apple-system,sans-serif;padding:22px}
  h1{font-size:19px;margin:0 0 4px;letter-spacing:-.02em}
  p.l{color:#93a3ab;margin:0 0 20px;font-size:13.5px}
  .tabs{display:flex;gap:6px;margin-bottom:20px;flex-wrap:wrap}
  .tabs button{background:#1a2126;color:#93a3ab;border:1px solid #263038;border-radius:7px;
               padding:7px 14px;font:600 12.5px/1 system-ui;cursor:pointer}
  .tabs button.on{background:#17304a;color:#8fc4ff;border-color:#2d5580}
  .grid{display:flex;flex-wrap:wrap;gap:22px;align-items:flex-start}
  figure{margin:0}
  figcaption{font:600 12px/1.4 system-ui;margin-bottom:7px}
  figcaption span{display:block;font-weight:400;color:#6d7c84;font-size:11px;
                  font-family:ui-monospace,Menlo,monospace}
  iframe{border:1px solid #2a343b;border-radius:9px;background:#000;display:block;
         box-shadow:0 8px 26px rgba(0,0,0,.42)}
</style></head><body>
<h1>Yeni ana ekran</h1>
<p class="l">Gerçek <code>ui-v2.js</code>, gerçek CSS. Her boyut kendi iframe'inde.</p>
<div class="tabs">
  <button class="on" onclick="show('ext-seq',this)">Eklenti · sekans var</button>
  <button onclick="show('ext-none',this)">Eklenti · sekans yok</button>
  <button onclick="show('desk',this)">Masaüstü</button>
</div>
<div class="grid" id="g"></div>
<script>
  var SIZES = __SIZES__;
  function show(v, b) {
    document.querySelectorAll(".tabs button").forEach(function (x) { x.classList.remove("on"); });
    if (b) b.classList.add("on");
    var g = document.getElementById("g"); g.innerHTML = "";
    SIZES.forEach(function (s) {
      var f = document.createElement("figure");
      f.innerHTML = '<figcaption>' + s[2] + '<span>' + s[0] + ' × ' + s[1] + '</span></figcaption>' +
        '<iframe src="home-' + v + '.html" width="' + s[0] + '" height="' + s[1] + '" title="' + s[2] + '"></iframe>';
      g.appendChild(f);
    });
  }
  show("ext-seq", null);
  document.querySelector(".tabs button").classList.add("on");
</script></body></html>
"""

VARIANTS = {
    "ext-seq":  ('{ label: "Sequence 01", detail: "4:12 konuşma" }', ""),
    "ext-none": ('{ label: "Açık sekans yok", detail: "", warn: true }', ""),
    "desk":     ("null", "window.IS_DESKTOP = true;"),
}


def snapshot(source_js: str, desk_js: str) -> str:
    html = (EXT / "index.html").read_text(encoding="utf-8")
    # Drop the boot guard and the app scripts; keep ui-v2.js, which is the
    # thing under test.
    html = re.sub(r"<script>.*?</script>", "", html, flags=re.S)
    for src in ("js/CSInterface.js", "js/main.js", "js/features-v2.js"):
        html = html.replace(f'<script src="{src}"></script>', "")
    stubs = STUBS.replace("__SOURCE__", source_js).replace("__DESK__", desk_js)
    html = html.replace('<script src="js/ui-v2.js"></script>',
                        f"<script>{stubs}</script>\n<script src=\"js/ui-v2.js\"></script>")
    return html


def main() -> None:
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(".")
    out.mkdir(parents=True, exist_ok=True)
    for name, (src, desk) in VARIANTS.items():
        (out / f"home-{name}.html").write_text(snapshot(src, desk), encoding="utf-8")
    css = out / "css"; css.mkdir(exist_ok=True)
    for f in (EXT / "css").glob("*.css"):
        (css / f.name).write_text(f.read_text(encoding="utf-8"), encoding="utf-8")
    js = out / "js"; js.mkdir(exist_ok=True)
    (js / "ui-v2.js").write_text((EXT / "js" / "ui-v2.js").read_text(encoding="utf-8"), encoding="utf-8")

    sizes = "[" + ",".join(f'[{w},{h},"{d}"]' for w, h, d in SIZES) + "]"
    (out / "home-preview.html").write_text(PAGE.replace("__SIZES__", sizes), encoding="utf-8")
    print(f"[home-preview] {out / 'home-preview.html'}  ({len(SIZES)} sizes × {len(VARIANTS)} states)")


if __name__ == "__main__":
    main()
