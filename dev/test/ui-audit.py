#!/usr/bin/env python3
"""Audit the panel's UI wiring.

Finds the failures that are invisible until a user hits them:

  · a data-i18n key with no entry in a locale table → the raw key, or English,
    shows up in a Turkish UI
  · an onclick naming a function that does not exist → a dead button
  · a tool card whose `view` selector matches nothing → an empty page
  · duplicate element ids → getElementById silently returns the wrong one
  · an element that nothing can reach

Nothing here needs a browser; it reads the shipped files.

    dev/test/ui-audit.py [--json]
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EXT = ROOT / "extension"
HTML = (EXT / "index.html").read_text(encoding="utf-8")
JS = {p.name: p.read_text(encoding="utf-8")
      for p in (EXT / "js").glob("*.js")}
ALL_JS = "\n".join(JS.values())
# desktop-app.js only exists on the desktop side but defines handlers the
# shared index.html refers to.
DESKTOP_JS = (ROOT / "js" / "desktop-app.js").read_text(encoding="utf-8")

findings: list[dict] = []


def add(sev: str, kind: str, detail: str) -> None:
    findings.append({"severity": sev, "kind": kind, "detail": detail})


# ── locale tables ─────────────────────────────────────────────────────────
def locale_tables() -> dict[str, set[str]]:
    """Pull the per-language key sets out of main.js's I18N object.

    Brace-counting is the obvious approach and the wrong one: the tables are
    full of strings containing braces, and one unbalanced `}` inside a
    translated sentence cuts the table short — which showed up as ninety-odd
    keys "missing" from BOTH languages at exactly the same point. The locale
    tables are siblings at a fixed indentation, so slice from one header to the
    next instead.
    """
    src = JS["main.js"]
    heads = [(m.group(1), m.start(), m.end())
             for m in re.finditer(r"^  (\w{2}):\s*\{", src, re.M)]
    tables: dict[str, set[str]] = {}
    for n, (lang, _start, body_start) in enumerate(heads):
        body_end = heads[n + 1][1] if n + 1 < len(heads) else len(src)
        body = src[body_start:body_end]
        # Several keys share a line here ("a: 1, b: 2, c: 3,"), so anchoring
        # to the start of a line finds only the first of each group.
        tables[lang] = set(re.findall(r"(?:^\s{4}|,\s+)(\w+)\s*:", body, re.M))
    return tables


TABLES = locale_tables()
SHIPPED = ["en", "tr"]          # the two we claim to support


def audit_i18n() -> None:
    used: dict[str, set[str]] = {}
    for attr in ("data-i18n", "data-i18n-tip", "data-i18n-ph"):
        used[attr] = set(re.findall(rf'{attr}="([^"]+)"', HTML))
    # keys the JS asks for directly
    js_keys = set(re.findall(r'\bt\("([a-z_0-9]+)"\)', ALL_JS))

    every = set().union(*used.values()) | js_keys
    for lang in SHIPPED:
        table = TABLES.get(lang, set())
        missing = sorted(k for k in every if k not in table)
        if missing:
            add("high" if lang == "tr" else "medium", "i18n-missing",
                f"{lang}: {len(missing)} key(s) with no translation — "
                f"{', '.join(missing[:12])}{'…' if len(missing) > 12 else ''}")

    # Which languages can a user actually pick?
    sel = re.search(r'id="set-uilang".*?</select>', HTML, re.S)
    offered = set(re.findall(r'value="(\w+)"', sel.group(0))) if sel else set()

    en = TABLES.get("en", set())
    dead, partial = [], []
    for lang, keys in sorted(TABLES.items()):
        if lang in SHIPPED or not keys:
            continue
        coverage = len(keys & en) / max(1, len(en))
        (partial if lang in offered else dead).append((lang, coverage, len(keys)))

    for lang, cov, n in partial:
        if cov < 0.9:
            add("high", "locale-partial",
                f"'{lang}' is selectable but only {cov:.0%} translated ({n}/{len(en)}) — "
                f"a user who picks it gets a half-English screen")
    if dead:
        total = sum(n for _, _, n in dead)
        add("medium", "locale-unreachable",
            f"{len(dead)} locale table(s) nobody can select ({', '.join(l for l, _, _ in dead)}) — "
            f"~{total} entries of dead weight in main.js, each at "
            f"{dead[0][1]:.0%} coverage. Either offer them or delete them.")


# ── handlers ──────────────────────────────────────────────────────────────
def defined_functions() -> set[str]:
    names = set()
    for src in (ALL_JS, DESKTOP_JS):
        names |= set(re.findall(r"^(?:async\s+)?function\s+(\w+)", src, re.M))
        names |= set(re.findall(r"^\s*(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?(?:function|\()", src, re.M))
        names |= set(re.findall(r"window\.(\w+)\s*=", src))
        names |= set(re.findall(r"^\s*function\s+(\w+)", src, re.M))
    return names


def audit_handlers() -> None:
    defined = defined_functions()
    builtins = {"event", "this", "window", "document", "console"}
    calls = re.findall(r'on(?:click|change|input|dblclick)="([^"]+)"', HTML)
    keywords = {"if", "else", "return", "typeof", "new", "function", "var",
                "let", "const", "true", "false", "null", "undefined"}
    missing: set[str] = set()
    for expr in calls:
        # Only the callee at the head of each statement. Matching every
        # `name(` in the expression also catches method calls (`x.focus()`)
        # and `if (…)`, which produced a page of false alarms.
        for stmt in re.split(r"[;&|]{1,2}", expr):
            m = re.match(r"\s*(\w+)\s*\(", stmt)
            if not m:
                continue
            fn = m.group(1)
            if fn not in defined and fn not in builtins and fn not in keywords:
                missing.add(fn)
    if missing:
        add("high", "dead-handler",
            f"inline handler(s) calling undefined function(s): {', '.join(sorted(missing))}")


# ── ids ───────────────────────────────────────────────────────────────────
def audit_ids() -> None:
    ids = re.findall(r'\sid="([^"]+)"', HTML)
    dupes = sorted({i for i in ids if ids.count(i) > 1})
    if dupes:
        add("high", "duplicate-id",
            f"getElementById returns only the first of these: {', '.join(dupes)}")

    # ids the JS reaches for that the HTML never defines (and nothing injects)
    referenced = set(re.findall(r'\$\("([a-z0-9-]+)"\)', ALL_JS)) \
               | set(re.findall(r'getElementById\("([a-z0-9-]+)"\)', ALL_JS))
    injected = set(re.findall(r'id="([a-z0-9-]+)"', ALL_JS)) \
             | set(re.findall(r'\.id\s*=\s*"([a-z0-9-]+)"', ALL_JS)) \
             | set(re.findall(r'id="([a-z0-9-]+)"', DESKTOP_JS))
    ghosts = sorted(referenced - set(ids) - injected)
    if ghosts:
        add("low", "ghost-id",
            f"{len(ghosts)} id(s) looked up but never created — each is a silent no-op: "
            f"{', '.join(ghosts[:15])}{'…' if len(ghosts) > 15 else ''}")


# ── tool cards ────────────────────────────────────────────────────────────
def audit_tools() -> None:
    ui = JS["ui-v2.js"]
    block = ui[ui.index("const TOOLS = {"):]
    block = block[:block.index("\n    const GROUPS")]
    tools = re.findall(r'^\s{8}(\w+):\s*\{(.*?)(?=\n\s{8}\w+:\s*\{|\Z)', block, re.S | re.M)

    html_ids = set(re.findall(r'\sid="([^"]+)"', HTML))
    js_ids = set(re.findall(r'id="([a-z0-9-]+)"', ALL_JS)) \
           | set(re.findall(r'\.id\s*=\s*"([a-z0-9-]+)"', ALL_JS)) \
           | set(re.findall(r'id="([a-z0-9-]+)"', DESKTOP_JS)) \
           | set(re.findall(r'\.id\s*=\s*"([a-z0-9-]+)"', DESKTOP_JS))
    onclicks = set(re.findall(r"onclick\^='(\w+)", block))

    for name, body in tools:
        m = re.search(r'view:\s*(?:DESK\s*\?\s*)?"([^"]+)"', body)
        if not m:
            continue
        sel = m.group(1)
        if sel.startswith("#"):
            target = sel[1:]
            if target not in html_ids and target not in js_ids:
                add("high", "dead-card",
                    f"tool '{name}' opens a page whose content selector '{sel}' "
                    f"matches nothing — the page renders empty")
        elif sel.startswith("button[onclick"):
            fn = re.search(r"onclick\^='(\w+)", sel)
            if fn and fn.group(1) not in defined_functions():
                add("high", "dead-card",
                    f"tool '{name}' targets onclick='{fn.group(1)}' which is not defined anywhere")

    prem_only = [n for n, b in tools if re.search(r"\bpp:\s*true", b)]
    add("info", "platform-split",
        f"{len(prem_only)} of {len(tools)} tools are Premiere-only "
        f"({', '.join(prem_only)}) — shown disabled on the desktop with a reason, not hidden")

    # Every tool has to land in a group, or renderHome drops it silently.
    ungrouped = [n for n, b in tools if not re.search(r'\bgroup:\s*"', b)]
    if ungrouped:
        add("high", "ungrouped-tool",
            f"tool(s) with no `group` never render on the home screen: {', '.join(ungrouped)}")

    badges = [n for n, b in tools if re.search(r'\bbadge:\s*"', b)]
    if badges:
        add("medium", "badge-returned",
            f"'new'/'beta' badges are back on: {', '.join(badges)} — "
            "they were removed because 11 of 19 carried one, which made them meaningless")


# ── placeholders that never fill ──────────────────────────────────────────
def audit_placeholders() -> None:
    for m in re.finditer(r'<div id="(export-grp-[a-z]+)"></div>', HTML):
        gid = m.group(1)
        filled_ext = f'"{gid}"' in ALL_JS
        filled_desk = f'"{gid}"' in DESKTOP_JS
        if not filled_ext and not filled_desk:
            add("medium", "empty-slot",
                f"'{gid}' is an empty container nothing ever fills")
        elif not filled_ext and filled_desk:
            add("info", "desktop-only-slot",
                f"'{gid}' is only populated by desktop-app.js — in the Premiere panel it stays empty")


def main() -> None:
    audit_i18n()
    audit_handlers()
    audit_ids()
    audit_tools()
    audit_placeholders()

    if "--json" in sys.argv:
        print(json.dumps(findings, indent=2, ensure_ascii=False))
        return

    order = {"high": 0, "medium": 1, "low": 2, "info": 3}
    findings.sort(key=lambda f: order.get(f["severity"], 9))
    icons = {"high": "!!", "medium": " !", "low": " ·", "info": " i"}
    print(f"UI audit — {len(findings)} finding(s)\n")
    for f in findings:
        print(f"{icons.get(f['severity'], '  ')} [{f['kind']}] {f['detail']}\n")
    hi = sum(1 for f in findings if f["severity"] == "high")
    print(f"{hi} high-severity")
    sys.exit(0)


if __name__ == "__main__":
    main()
