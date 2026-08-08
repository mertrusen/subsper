#!/usr/bin/env python3
"""Which settings actually do something?

A setting can fail in three quiet ways, and none of them show up as an error:

  · **dead**      persisted and editable, but nothing ever reads it — the user
                  changes it, nothing happens, and they lose trust in the panel
  · **unreachable** read by the code but with no control anywhere, so the
                  default is the only value it will ever have
  · **orphan control** a control that writes a key nothing reads

Reading is counted generously — `settings.x`, `opt.x`, destructuring, and
bracket access all count — so a key reported dead is very likely dead.

    dev/test/settings-audit.py [--json]
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EXT = ROOT / "extension"

HTML = (EXT / "index.html").read_text(encoding="utf-8")
SOURCES = {p.name: p.read_text(encoding="utf-8") for p in (EXT / "js").glob("*.js")}
SOURCES["desktop-app.js"] = (ROOT / "js" / "desktop-app.js").read_text(encoding="utf-8")
SOURCES["host.jsx"] = (EXT / "jsx" / "host.jsx").read_text(encoding="utf-8")
ALL = "\n".join(SOURCES.values())

MAIN = SOURCES["main.js"]

# onSettingChange('key', …) — accepts either quote style.
PAT_SETTING_CHANGE = re.compile(r"onSettingChange\(\s*['\"](\w+)['\"]")


def defaults() -> dict[str, str]:
    block = MAIN[MAIN.index("const DEFAULT_SETTINGS = {"):]
    block = block[:block.index("\n};")]
    out = {}
    for m in re.finditer(r"^\s{4}(\w+):\s*([^,\n]+)", block, re.M):
        out[m.group(1)] = m.group(2).strip().rstrip(",")
    return out


DEFAULTS = defaults()


def controls() -> dict[str, list[str]]:
    """Map each settings key to the control ids that edit it.

    Controls are wired three ways in this codebase: an `id="set-foo"` element
    read by initSettingsUI, an inline `onchange` that assigns the key, and
    controls injected from JavaScript. Catch all three.
    """
    found: dict[str, list[str]] = {k: [] for k in DEFAULTS}

    # 1) `set("set-cpl", settings.maxCharsPerLine)` and friends in the init code
    for m in re.finditer(r'"(set-[a-z0-9-]+)"\s*,\s*settings\.(\w+)', ALL):
        cid, key = m.group(1), m.group(2)
        if key in found and cid not in found[key]:
            found[key].append(cid)
    # 2) `chk("set-x", settings.y)` / `set(...)` reversed argument order
    for m in re.finditer(r'settings\.(\w+)\s*=\s*[^;\n]*?getElementById\("([a-z0-9-]+)"\)', ALL):
        key, cid = m.group(1), m.group(2)
        if key in found and cid not in found[key]:
            found[key].append(cid)
    # 3) inline handlers that assign directly
    for m in re.finditer(r'on(?:change|input|click)="[^"]*settings\.(\w+)\s*=', HTML):
        key = m.group(1)
        if key in found:
            found[key].append("(inline)")
    # 4) onSettingChange("key", value) — the main wiring mechanism in this
    #    codebase, and the one an earlier version of this script missed
    #    entirely, which made two thirds of its findings false alarms.
    #    Walk back from the call to the nearest enclosing element id.
    for m in re.finditer(PAT_SETTING_CHANGE, HTML):
        key = m.group(1)
        if key not in found:
            continue
        before = HTML[max(0, m.start() - 1200):m.start()]
        ids = re.findall(r'id="([a-z0-9-]+)"', before)
        cid = ids[-1] if ids else "(inline)"
        if cid not in found[key]:
            found[key].append(cid)
    for m in re.finditer(PAT_SETTING_CHANGE, ALL):
        key = m.group(1)
        if key in found and not found[key]:
            found[key].append("(js)")
    # 5) setter helpers
    for m in re.finditer(r'(?:setSetting|saveSetting|updateSetting)\(\s*"(\w+)"', ALL):
        key = m.group(1)
        if key in found:
            found[key].append("(setter)")
    # 6) JS-injected controls that bind by id then assign
    for m in re.finditer(r'\$id\("([a-z0-9-]+)"\)[^;]{0,200}?settings\.(\w+)\s*=', ALL, re.S):
        cid, key = m.group(1), m.group(2)
        if key in found and cid not in found[key]:
            found[key].append(cid)
    # 7) Written from JavaScript rather than an inline handler — the style
    #    gallery chips do `settings.stylePreset = key` inside an onclick, and
    #    onKaraokeColor() writes karaokeHi. Reachable by the user, just not
    #    traceable to a `set-*` id.
    for m in re.finditer(r"settings\.(\w+)\s*=(?!=)", ALL):
        key = m.group(1)
        if key in found and not found[key]:
            found[key].append("(js handler)")
    return found


CONTROLS = controls()


def read_sites(key: str) -> int:
    """Count places that READ the key, excluding assignments and the default."""
    n = 0
    # settings.key / opt.key / o.key / s.key — any property read of that name
    for m in re.finditer(rf"(?<![\w.])(\w+)\.{re.escape(key)}\b", ALL):
        start = m.end()
        tail = ALL[start:start + 3]
        if re.match(r"\s*=(?!=)", tail):      # assignment, not a read
            continue
        if m.group(1) in ("DEFAULT_SETTINGS",):
            continue
        n += 1
    # destructuring: const { key } = settings
    n += len(re.findall(rf"\{{[^}}]*\b{re.escape(key)}\b[^}}]*\}}\s*=\s*settings", ALL))
    # bracket access
    n += len(re.findall(rf'settings\[\s*"{re.escape(key)}"\s*\]', ALL))
    return n


def main() -> None:
    rows = []
    for key, default in DEFAULTS.items():
        ctrls = CONTROLS.get(key, [])
        reads = read_sites(key)
        # A key defined in DEFAULT_SETTINGS and mentioned nowhere else is dead.
        if reads == 0:
            status = "DEAD"
        elif not ctrls:
            status = "NO CONTROL"
        else:
            status = "ok"
        rows.append({"key": key, "default": default, "controls": ctrls,
                     "reads": reads, "status": status})

    if "--json" in sys.argv:
        print(json.dumps(rows, indent=2, ensure_ascii=False))
        return

    order = {"DEAD": 0, "NO CONTROL": 1, "ok": 2}
    rows.sort(key=lambda r: (order[r["status"]], r["key"]))

    dead = [r for r in rows if r["status"] == "DEAD"]
    noctl = [r for r in rows if r["status"] == "NO CONTROL"]
    ok = [r for r in rows if r["status"] == "ok"]

    print(f"{len(DEFAULTS)} settings · {len(ok)} wired · "
          f"{len(noctl)} with no control · {len(dead)} dead\n")

    if dead:
        print("DEAD — persisted and editable, but nothing reads them:")
        for r in dead:
            print(f"  {r['key']:22} default {r['default']:<18} controls: {', '.join(r['controls']) or '—'}")
        print()
    if noctl:
        print("NO CONTROL — the code reads them, but nothing in the UI can change them:")
        for r in noctl:
            print(f"  {r['key']:22} default {r['default']:<18} {r['reads']} read site(s)")
        print()
    print("WIRED:")
    for r in ok:
        print(f"  {r['key']:22} {', '.join(r['controls'])}")

    # Controls in the HTML that never reach a settings key.
    html_controls = set(re.findall(r'id="(set-[a-z0-9-]+)"', HTML))
    used = {c for r in rows for c in r["controls"]}
    orphans = sorted(html_controls - used)
    if orphans:
        print(f"\nORPHAN CONTROLS — in the HTML, not traceable to a settings key "
              f"(may be wired indirectly, check by hand):")
        for c in orphans:
            print(f"  {c}")


if __name__ == "__main__":
    main()
