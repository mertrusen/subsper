#!/usr/bin/env node
// Keep the desktop package, shared UI, and Premiere CEP manifest in sync.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const at = name => path.join(root, name);
const pkgPath = at("package.json");
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
const current = pkg.version;
const arg = process.argv[2];
const base = /^([0-9]+)\.([0-9]+)\.([0-9]+)(?:-[0-9A-Za-z.-]+)?$/.exec(current);
if (!arg || !base) {
    console.error("Usage: npm run version:set -- 1.5.0|patch|minor|major");
    process.exit(1);
}
const [major, minor, patch] = base.slice(1, 4).map(Number);
const version = arg === "patch" ? `${major}.${minor}.${patch + 1}`
    : arg === "minor" ? `${major}.${minor + 1}.0`
    : arg === "major" ? `${major + 1}.0.0` : arg.replace(/^v/, "");
const match = /^([0-9]+)\.([0-9]+)\.([0-9]+)(?:-[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*)?$/.exec(version);
if (!match) {
    console.error("Invalid semantic version:", arg);
    process.exit(1);
}
const cepVersion = match.slice(1, 4).join(".");
const lockPath = at("package-lock.json");
const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
let main = fs.readFileSync(at("js/main.js"), "utf8");
const manifestPath = at("extension/CSXS/manifest.xml");
let manifest = fs.readFileSync(manifestPath, "utf8");
if (!/^const APP_VERSION = "[^"]+";$/m.test(main) ||
    !/ExtensionBundleVersion="[^"]+"/.test(manifest) ||
    !/<Extension Id="com\.whisper\.studio\.panel" Version="[^"]+"\/>/.test(manifest)) {
    throw new Error("Version field missing; no files were changed");
}
pkg.version = version;
lock.version = version;
lock.packages[""].version = version;
main = main.replace(/^const APP_VERSION = "[^"]+";$/m, `const APP_VERSION = "${version}";`);
manifest = manifest.replace(/ExtensionBundleVersion="[^"]+"/, `ExtensionBundleVersion="${cepVersion}"`)
    .replace(/<Extension Id="com\.whisper\.studio\.panel" Version="[^"]+"\/>/,
        `<Extension Id="com.whisper.studio.panel" Version="${cepVersion}"/>`);
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + "\n");
fs.writeFileSync(at("js/main.js"), main);
fs.writeFileSync(manifestPath, manifest);
console.log(`${current} → ${version} (CEP ${cepVersion})`);
console.log("Run bash scripts/sync-to-extension.sh before installing or packaging.");
