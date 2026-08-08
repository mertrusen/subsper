#!/usr/bin/env python3
"""Render the real panel at the sizes people actually dock it to.

A CEP panel is whatever gap the editor had spare: a narrow strip beside the
Program monitor, a short shelf under the timeline, sometimes a wide float. The
layout has to survive all of them, and "it looked fine in my window" is not
evidence.

Media queries measure the viewport, and inside CEP the panel IS the viewport —
so each size has to be its own iframe. A fixed-size <div> would never trigger
them and would quietly report everything as fine.

The snapshot is generated from extension/index.html with the scripts stripped
and sample content injected, so it tracks the real markup instead of drifting
into a hand-written copy.

    dev/test/build-panel-sizes.py [outdir]
    open <outdir>/panel-sizes.html
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EXT = ROOT / "extension"

# width, height, what it represents
SIZES = [
    (260, 620, "sliver — docked beside the Program monitor"),
    (320, 480, "narrow + short"),
    (360, 460, "the measured worst case"),
    (420, 680, "the size the panel was designed for"),
    (520, 400, "shelf under the timeline"),
    (760, 520, "wide dock / floating"),
]

SAMPLE_CUES = [
    ("00:00:00,090", "Kemoterapi alan hastalarda görülen saç dökülmesinin", ""),
    ("00:00:02,598", "sebebi tam olarak nedir?", ""),
    ("00:00:04,980", "Kanser hücreleri kontrolsüz ve hızlı büyürler.", "playing"),
    ("00:00:08,360", "Kemoterapi ilaçları vücutta çok hızlı çoğalan", "selected"),
    ("00:00:10,844", "tüm hücreleri hedef alır.", ""),
    ("00:00:13,120", "Saç kökündeki hücreler de hızlı bölünen hücrelerdir.", ""),
]


def snapshot(view: str) -> str:
    """view: 'home' | 'work'"""
    html = (EXT / "index.html").read_text(encoding="utf-8")

    # Scripts need Node and a Premiere host; the layout does not.
    html = re.sub(r"<script\b.*?</script>", "", html, flags=re.S)

    if view == "home":
        html = html.replace('<body class="ui2-home">', '<body class="ui2-home">')
        cards = ""
        groups = [
            ("Altyazı", [("Altyazı Oluştur", "Konuşmayı yazıya döker, düzenle ve timeline'a gönder"),
                         ("AI Araçları", "Özet, çeviri, dilbilgisi ve içerik fikirleri")]),
            ("Kurgu", [("Sessizlikleri Kes", "Sessiz boşlukları bulur, işaretler veya keser"),
                       ("Tekrarları Sil", "Tekrar çekimleri bulur, kötü take'leri atar"),
                       ("Dolgu Kelimeleri Kes", "ee, ıı, şey… kelimelerini temizler"),
                       ("Otomatik Zoom", "Kliplere yumuşak yakınlaşmalar ekler")]),
            ("Ses", [("Küfür Sansürü", "Küfürleri bulur; bipler ya da susturur"),
                     ("Sesi İyileştir", "Gürültüyü azaltır, seviyeyi dengeler")]),
        ]
        for label, items in groups:
            cards += f'<div class="home-cat-label">{label}</div><div class="home-grid">'
            for name, desc in items:
                cards += (
                    '<button class="home-card">'
                    '<span class="hc-art"><svg viewBox="0 0 120 56" xmlns="http://www.w3.org/2000/svg">'
                    '<rect x="18" y="14" width="84" height="28" rx="6" fill="none" stroke="#6b9fd8" stroke-width="2"/>'
                    '<path d="M30 28h14M52 28h30" stroke="#6b9fd8" stroke-width="3" stroke-linecap="round"/></svg></span>'
                    f'<span class="hc-label">{name}</span>'
                    f'<span class="hc-desc">{desc}</span></button>')
            cards += "</div>"
        html = html.replace('<div id="home-cats"></div>', f'<div id="home-cats">{cards}</div>')
        html = html.replace('<div class="home-foot" id="home-foot"></div>',
                            '<div class="home-foot" id="home-foot">Subsper v1.3.0 · zipheron</div>')
    else:
        # Work view: home hidden, transcribe panel showing, real segment markup.
        html = html.replace('<body class="ui2-home">', "<body>")
        html = html.replace('<div id="home-screen">', '<div id="home-screen" style="display:none">')
        segs = ""
        for i, (tc, text, cls) in enumerate(SAMPLE_CUES):
            words = " ".join(f'<span class="seg-word" data-w="{w}">{p}</span>'
                             for w, p in enumerate(text.split(" ")))
            segs += (
                f'<div class="segment {cls}" data-idx="{i}">'
                f'<div class="seg-header">'
                f'<span class="seg-index">{i + 1}</span>'
                f'<span class="seg-time">{tc} → {tc}</span>'
                f'<div class="seg-actions">'
                f'<button class="seg-btn">✎</button><button class="seg-btn">✂</button>'
                f'<button class="seg-btn del">✕</button></div></div>'
                f'<div class="seg-text">{words}</div></div>')
        html = re.sub(r'(<div[^>]*id="segments-wrap"[^>]*>)', r"\1" + segs, html, count=1)
        html = html.replace('<div class="actions-bar" id="actions-bar" style="display:none">',
                            '<div class="actions-bar" id="actions-bar">')
        html = html.replace('<span class="seg-count" id="seg-count"></span>',
                            '<span class="seg-count" id="seg-count">6 segments</span>')
    return html


PAGE = """<!doctype html><html lang="tr"><head><meta charset="utf-8">
<title>Subsper — panel boyutları</title>
<style>
  :root{ color-scheme: dark; }
  body{margin:0;background:#0d1113;color:#e9eff2;
       font:14px/1.5 system-ui,-apple-system,sans-serif;padding:22px}
  h1{font-size:19px;margin:0 0 4px;letter-spacing:-.02em}
  p.lede{color:#93a3ab;margin:0 0 22px;font-size:13.5px}
  .tabs{display:flex;gap:6px;margin-bottom:20px}
  .tabs button{background:#1a2126;color:#93a3ab;border:1px solid #263038;
               border-radius:7px;padding:7px 14px;font:600 12.5px/1 system-ui;cursor:pointer}
  .tabs button.on{background:#17304a;color:#8fc4ff;border-color:#2d5580}
  .grid{display:flex;flex-wrap:wrap;gap:22px;align-items:flex-start}
  figure{margin:0}
  figcaption{font:600 12px/1.4 system-ui;color:#e9eff2;margin-bottom:7px}
  figcaption span{display:block;font-weight:400;color:#6d7c84;font-size:11px;
                  font-family:ui-monospace,Menlo,monospace}
  iframe{border:1px solid #2a343b;border-radius:9px;background:#000;display:block;
         box-shadow:0 8px 26px rgba(0,0,0,.42)}
  .warn{margin-top:26px;padding:12px 14px;border-radius:9px;background:#2a2114;
        color:#dfa955;font-size:12.5px;max-width:70ch}
</style></head><body>
<h1>Panel boyutları</h1>
<p class="lede">Gerçek işaretleme, gerçek CSS. Her boyut kendi iframe'inde — media query'ler
viewport ölçer, sabit boyutlu bir div onları hiç tetiklemez.</p>
<div class="tabs">
  <button onclick="show('home',this)">Ana ekran (eski işaretleme)</button>
  <button class="on" onclick="show('work',this)">Çalışma</button>
</div>
<div id="verdict" style="margin:0 0 18px;padding:11px 14px;border-radius:9px;
     background:#1a2126;color:#93a3ab;font-size:12.5px">ölçülüyor…</div>
<div class="grid" id="grid"></div>
<div class="warn">Betikler çıkarıldı — bu sayfa yalnızca yerleşimi test eder, davranışı değil.</div>
<script>
  var SIZES = __SIZES__;
  function show(view, btn) {
    document.querySelectorAll(".tabs button").forEach(function (b) { b.classList.remove("on"); });
    if (btn) btn.classList.add("on");
    var g = document.getElementById("grid");
    g.innerHTML = "";
    SIZES.forEach(function (s) {
      var f = document.createElement("figure");
      f.innerHTML = '<figcaption>' + s[2] + '<span>' + s[0] + ' × ' + s[1] + '</span></figcaption>' +
        '<iframe src="panel-' + view + '.html" width="' + s[0] + '" height="' + s[1] + '" title="' + s[0] + 'x' + s[1] + '"></iframe>';
      g.appendChild(f);
    });
  }
  show("work", null);
  document.querySelectorAll(".tabs button")[1].classList.add("on");

  /* Measuring is not the same as looking.
     The first version of this page reported widths and heights and called the
     layout fine, while a Play button with an inherited `flex: 1` was sitting
     on top of Transcribe. Numbers were right, the layout was broken. So ask
     the question that actually matters: does anything overlap anything else,
     and does anything escape its container? */
  function overlaps(a, b) {
    return !(a.right <= b.left + 1 || a.left >= b.right - 1 ||
             a.bottom <= b.top + 1 || a.top >= b.bottom - 1);
  }
  function audit() {
    var problems = [], checked = 0;
    document.querySelectorAll("iframe").forEach(function (f) {
      var d = f.contentDocument;
      if (!d || !d.body) return;
      var tag = f.width + "×" + f.height;

      // Siblings that share a row must never sit on top of each other.
      [".controls", ".actions-bar", ".seg-header", ".home-list", ".controls-row"].forEach(function (sel) {
        d.querySelectorAll(sel).forEach(function (box) {
          var kids = [].filter.call(box.children, function (c) {
            var r = c.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          });
          for (var i = 0; i < kids.length; i++) {
            checked++;
            var ri = kids[i].getBoundingClientRect();
            var rb = box.getBoundingClientRect();
            if (ri.right > rb.right + 2 || ri.left < rb.left - 2) {
              problems.push(tag + " · " + sel + " > " + (kids[i].className || kids[i].tagName) + " kabından taşıyor");
            }
            for (var j = i + 1; j < kids.length; j++) {
              if (overlaps(ri, kids[j].getBoundingClientRect())) {
                problems.push(tag + " · " + sel + " içinde çakışma: " +
                  (kids[i].className || kids[i].tagName) + " ↔ " + (kids[j].className || kids[j].tagName));
              }
            }
          }
        });
      });

      if (d.documentElement.scrollWidth > f.width + 1) problems.push(tag + " · yatay taşma");
    });

    var v = document.getElementById("verdict");
    if (problems.length) {
      v.style.background = "#2c1918"; v.style.color = "#e08a83";
      v.innerHTML = "<b>" + problems.length + " sorun</b><br>" + problems.join("<br>");
      document.title = "PANEL-LAYOUT fail=" + problems.length;
    } else if (checked === 0) {
      // A pass that inspected nothing is the failure mode this audit exists to
      // stop. Say so instead of showing green.
      v.style.background = "#2a2114"; v.style.color = "#dfa955";
      v.textContent = "Hiçbir öğe kontrol edilmedi — seçiciler bu görünümle eşleşmiyor. Bu bir geçiş değil.";
      document.title = "PANEL-LAYOUT fail=1 (nothing checked)";
    } else {
      v.style.background = "#132720"; v.style.color = "#6cc296";
      v.textContent = "Çakışma ve taşma yok — " + checked + " öğe kontrol edildi.";
      document.title = "PANEL-LAYOUT fail=0";
    }
  }
  window.addEventListener("load", function () { setTimeout(audit, 700); });
  document.querySelectorAll(".tabs button").forEach(function (b) {
    b.addEventListener("click", function () { setTimeout(audit, 700); });
  });
</script></body></html>
"""


def main() -> None:
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(".")
    out.mkdir(parents=True, exist_ok=True)

    # The snapshots load css/… relative to themselves.
    for view in ("home", "work"):
        (out / f"panel-{view}.html").write_text(snapshot(view), encoding="utf-8")

    css_dir = out / "css"
    css_dir.mkdir(exist_ok=True)
    for f in (EXT / "css").glob("*.css"):
        (css_dir / f.name).write_text(f.read_text(encoding="utf-8"), encoding="utf-8")

    sizes_js = "[" + ",".join(f'[{w},{h},"{d}"]' for w, h, d in SIZES) + "]"
    (out / "panel-sizes.html").write_text(PAGE.replace("__SIZES__", sizes_js), encoding="utf-8")
    print(f"[panel-sizes] {out / 'panel-sizes.html'}  ({len(SIZES)} sizes × 2 views)")


if __name__ == "__main__":
    main()
