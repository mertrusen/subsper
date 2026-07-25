/* Fails if a competitor product name leaks into anything we ship.
   The names live here (a dev-only file that never ends up in a build) so the
   shipped tree stays clean even when someone greps it.
   Run: node dev/name-sweep.js */
"use strict";
const fs = require("fs");
const path = require("path");

// Matched on word boundaries so ordinary words ("description") don't trip it.
const NAMES = ["autocut", "firecut", "opus ?clip", "submagic", "descript", "veed", "kapwing"];
const RE = new RegExp("\\b(" + NAMES.join("|") + ")\\b", "i");
const ROOTS = ["js", "css", "scripts", "extension/js", "extension/jsx", "extension/css", "docs"];
const FILES = ["index.html", "extension/index.html", "README.md", "RELEASING.md",
               "ROADMAP.md", "DIFFERENCES.md", "package.json"];
const EXT_OK = /\.(js|jsx|css|html|md|json|py|sh|plist)$/i;

const repo = path.join(__dirname, "..");
const hits = [];

function scan(file) {
    let text;
    try { text = fs.readFileSync(file, "utf8"); } catch (e) { return; }
    text.split(/\n/).forEach((line, i) => {
        if (RE.test(line)) hits.push(`${path.relative(repo, file)}:${i + 1}: ${line.trim().slice(0, 100)}`);
    });
}
function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const e of entries) {
        if (e.name === "node_modules" || e.name === ".git" || e.name === "dist") continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (EXT_OK.test(e.name)) scan(full);
    }
}

ROOTS.forEach(r => walk(path.join(repo, r)));
FILES.forEach(f => scan(path.join(repo, f)));

if (hits.length) {
    console.error("Competitor names found in shipped files:\n" + hits.join("\n"));
    process.exit(1);
}
console.log("name sweep clean — " + NAMES.length + " names checked");
