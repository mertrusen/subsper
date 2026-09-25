"use strict";
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const root = path.resolve(__dirname, "../..");
const read = p => fs.readFileSync(path.join(root, p), "utf8");
const pkg = JSON.parse(read("package.json"));
const lock = JSON.parse(read("package-lock.json"));
const ui = read("js/main.js");
const mirror = read("extension/js/main.js");
const manifest = read("extension/CSXS/manifest.xml");
assert.equal(pkg.version, lock.version);
assert.equal(pkg.version, lock.packages[""].version);
assert.ok(ui.includes(`const APP_VERSION = "${pkg.version}";`));
assert.equal(ui, mirror);
const cep = pkg.version.match(/^\d+\.\d+\.\d+/)[0];
assert.ok(manifest.includes(`ExtensionBundleVersion="${cep}"`));
assert.ok(manifest.includes(`<Extension Id="com.whisper.studio.panel" Version="${cep}"/>`));
if (process.env.GITHUB_REF_TYPE === "tag") {
    assert.equal(process.env.GITHUB_REF_NAME, `v${pkg.version}`, "release tag must match package version");
}
console.log(`Version consistency passed: ${pkg.version}`);
