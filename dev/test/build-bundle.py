#!/usr/bin/env python3
"""Build a single self-contained test bundle out of the real source files.

Why not just `require()` main.js? Because main.js is a browser script: it
touches the DOM and CSInterface at load time, so importing it wholesale needs a
full fake environment and breaks whenever the UI changes. And why not slice by
line number? Because every edit shifts the lines and the tests silently start
testing the wrong code.

So: pull out named top-level declarations by NAME. This codebase consistently
writes top-level functions starting at column 0 and closes them with a `}` at
column 0, which makes the extraction exact and stable across edits.

Usage:  build-bundle.py <out.js>
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "extension" / "js" / "main.js"
CASES = Path(__file__).resolve().parent / "cases"
FRAMEWORK = Path(__file__).resolve().parent / "framework.js"
STUBS = Path(__file__).resolve().parent / "stubs.js"

# Everything the test cases touch. Missing a name fails loudly below rather
# than silently testing a stub.
WANTED = [
    # shared helpers
    "escRe", "WORD_CHARS", "wordRe", "upperIn", "matchCase", "stemAlt",
    "tidyText", "capFirst", "parseDictRules", "wrapText",
    "p2", "p3", "formatTime",
    # transcript clean-up
    "BUILTIN_FILLERS", "BUILTIN_PROFANITY",
    "getFillerList", "applyDictionary", "removeFillers", "censorProfanity",
    "applyPunctuationFilter",
    # offline proofreader
    "PROOF_TYPOS_TR", "PROOF_TYPOS_EN",
    "proofLang", "proofPunct", "proofCaps", "applyProofread",
    # segment splitting
    "splitPoint", "cutSegment", "splitSegmentHalf", "splitAtWord",
    # auto-format
    "applySmartSplit", "splitSegment", "splitByWords", "splitByText",
    # settings profiles + bilingual export
    "PROFILE_KEYS", "listProfiles", "writeProfiles",
    "saveProfile", "loadProfile", "deleteProfile",
    "parseNumberedAi", "buildBilingualSRT",
]


def match_delimiter(src: str, open_at: int) -> int:
    """Index just past the delimiter that closes the one at `open_at`.

    A plain "find the next `}` in column 0" heuristic silently over-reads
    one-line functions such as `function escRe(s) { … }`, swallowing whatever
    is declared after them — which shows up much later as a confusing
    "cannot declare X twice". So actually balance the delimiters, skipping
    string, comment and REGEX bodies.

    Regex literals matter more than they look. parseNumberedAi contains

        .replace(/(\*\*|__|\*|_|`)/g, "")

    — a backtick inside a regex. Read naively that opens a template literal,
    and the scanner then swallows half the file looking for its partner. So we
    have to know when a `/` starts a regex rather than a division, which is
    the usual "you cannot lex JavaScript without parsing it" problem. The
    standard heuristic works here: after a value (identifier, number, `)`,
    `]`) a slash is division; after an operator or a statement boundary it
    opens a regex.
    """
    pairs = {"{": "}", "[": "]"}
    close = pairs[src[open_at]]
    depth = 0
    i = open_at
    n = len(src)
    prev = ""          # last significant character seen
    while i < n:
        c = src[i]
        if c in "\"'`":
            quote, i = c, i + 1
            while i < n:
                if src[i] == "\\":
                    i += 2
                    continue
                if src[i] == quote:
                    break
                i += 1
            prev = quote
        elif c == "/" and i + 1 < n and src[i + 1] == "/":
            i = src.find("\n", i)
            if i == -1:
                return n
            continue
        elif c == "/" and i + 1 < n and src[i + 1] == "*":
            end = src.find("*/", i)
            if end == -1:
                return n
            i = end + 2
            continue
        elif c == "/" and prev not in ")]}" and not (prev.isalnum() or prev in "_$"):
            # A regex literal. Skip it whole, including any quote or backtick
            # inside, and mind that `[/]` is legal within a character class.
            i += 1
            in_class = False
            while i < n:
                ch = src[i]
                if ch == "\\":
                    i += 2
                    continue
                if ch == "[":
                    in_class = True
                elif ch == "]":
                    in_class = False
                elif ch == "/" and not in_class:
                    break
                elif ch == "\n":
                    break          # not a regex after all; bail rather than run away
                i += 1
            prev = "/"
        elif c == src[open_at]:
            depth += 1
            prev = c
        elif c == close:
            depth -= 1
            if depth == 0:
                return i + 1
            prev = c
        elif not c.isspace():
            prev = c
        i += 1
    raise SystemExit(f"unbalanced '{src[open_at]}' starting at offset {open_at}")


def _assert_no_overread(chunk: str, name: str) -> None:
    """Catch a runaway scan at the source rather than as a mystery later.

    Nested functions in this codebase are always indented, so a second
    column-0 `function`/`const` inside one extracted chunk means the scanner
    ran past the end of what it was asked for.
    """
    strays = re.findall(r"^(?:function|const|let)\s+(\w+)", chunk[1:], re.M)
    if strays:
        raise SystemExit(
            f"extractor over-read while slicing {name!r}: it swallowed "
            f"{', '.join(strays[:4])}{'…' if len(strays) > 4 else ''}. "
            "Some construct in that function confuses match_delimiter.")


def extract(src: str, name: str) -> str:
    """Slice one top-level `function NAME(…){…}` or `const|let|var NAME = …;`."""
    fn = re.search(rf"^(?:async\s+)?function\s+{re.escape(name)}\s*\(", src, re.M)
    if fn:
        brace = src.index("{", src.index(")", fn.end() - 1))
        chunk = src[fn.start():match_delimiter(src, brace)]
        _assert_no_overread(chunk, name)
        return chunk

    cn = re.search(rf"^(?:const|let|var)\s+{re.escape(name)}\s*=\s*", src, re.M)
    if cn:
        rest = src[cn.end()]
        if rest in "{[":
            chunk = src[cn.start():match_delimiter(src, cn.end())] + ";"
            _assert_no_overread(chunk, name)
            return chunk
        # Scalar or arrow function: runs to the end of its statement.
        # NOT `index(";\n")` — a trailing comment puts text between the
        # semicolon and the newline (`let x = null;   // { a, b }`), so that
        # search skips to some later statement and swallows everything in
        # between, unbalanced braces and all. Match the semicolon that ends
        # the line, comment or no comment.
        m = re.compile(r";(?=[ \t]*(?://[^\n]*)?\r?\n)").search(src, cn.end())
        if not m:
            raise SystemExit(f"could not find the end of declaration {name!r}")
        chunk = src[cn.start():m.end()]
        _assert_no_overread(chunk, name)
        return chunk

    raise SystemExit(f"symbol not found in main.js: {name}  (renamed? then update WANTED)")


def main() -> None:
    out_path = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("_bundle.js")
    src = SRC.read_text(encoding="utf-8")

    parts = [
        "// GENERATED by dev/test/build-bundle.py — do not edit, do not commit.\n",
        # Everything lives inside an IIFE. Besides keeping the global scope
        # clean, this is what lets the bundle run under JavaScriptCore: JXA
        # predefines a non-configurable global `$` (the ObjC bridge), and the
        # app's own `$(id)` helper cannot be declared over it at global scope.
        "(function () {\n",
        '"use strict";\n',
        STUBS.read_text(encoding="utf-8"),
        FRAMEWORK.read_text(encoding="utf-8"),
        "\n// ─── real code, extracted from extension/js/main.js ───\n",
    ]
    for name in WANTED:
        parts.append(extract(src, name) + "\n")

    parts.append("\n// ─── test cases ───\n")
    case_files = sorted(CASES.glob("*.test.js"))
    if not case_files:
        raise SystemExit("no test cases found in dev/test/cases/")
    for f in case_files:
        parts.append(f"\n// ── {f.name} ──\n" + f.read_text(encoding="utf-8"))

    parts.append("\nreportAndExit();\n})();\n")
    out_path.write_text("".join(parts), encoding="utf-8")
    print(f"[bundle] {out_path}  ({len(WANTED)} symbols, {len(case_files)} case files)")


if __name__ == "__main__":
    main()
