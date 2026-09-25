"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const sandbox = {
    settings: { uiLang: "tr" },
    document: { getElementById: () => null, createElement: () => ({ textContent: "" }), head: { appendChild() {} } },
};
sandbox.window = sandbox;
vm.runInNewContext(fs.readFileSync("extension/js/caption-exclusions.js", "utf8"), sandbox);
const subtract = sandbox.__subtractCaptionZones;
const cues = [
    { text: "ilk", seqStart: 0, seqEnd: 4 },
    { text: "ikinci", seqStart: 4, seqEnd: 8 },
];
const plain = x => JSON.parse(JSON.stringify(x));
assert.deepEqual(plain(subtract(cues, [{ start: 2, end: 6 }])), [
    { text: "ilk", seqStart: 0, seqEnd: 2 },
    { text: "ikinci", seqStart: 6, seqEnd: 8 },
]);
assert.deepEqual(plain(subtract(cues, [{ start: 1, end: 2 }, { start: 2, end: 3 }])), [
    { text: "ilk", seqStart: 0, seqEnd: 1 },
    { text: "ilk", seqStart: 3, seqEnd: 4 },
    { text: "ikinci", seqStart: 4, seqEnd: 8 },
]);
assert.deepEqual(plain(subtract(cues, [])), cues);
assert.deepEqual(plain(subtract(cues, [{ start: 0, end: 8 }])), []);
assert.equal(cues[0].seqEnd, 4, "preview never mutates source captions");
const tick = s => ({ ticks: String(s * 254016000000) });
const host = { app: { project: { path: "/tmp/edit.prproj", activeSequence: {
    sequenceID: "seq-1", name: "Sequence 01", videoTracks: { numTracks: 2,
        0: { name: "Footage", clips: { numItems: 1, 0: { name: "video", start: tick(0), end: tick(8) } } },
        1: { name: "No captions", clips: { numItems: 1, 0: { name: "transition", start: tick(2), end: tick(3) } } },
    } }, } } };
vm.runInNewContext(fs.readFileSync("extension/jsx/host.jsx", "utf8"), host);
const scanned = JSON.parse(host.wsListCaptionExclusionClips());
assert.equal(scanned.sequence, "seq-1");
assert.equal(scanned.project, "/tmp/edit.prproj");
assert.deepEqual(plain(scanned.tracks[1].clips), [{ name: "transition", start: 2, end: 3 }]);
sandbox.loadHostJSX = async () => {};
sandbox.evalScript = async () => scanned;
sandbox.showToast = () => {};
let saved = JSON.stringify({ track: 1, clips: ["1:2.000:3.000"] });
sandbox.localStorage = { getItem: () => saved };
(async () => {
    const prepared = await sandbox.preparePremiereCaptionSegments(cues);
    assert.deepEqual(plain(prepared), [
        { text: "ilk", seqStart: 0, seqEnd: 2 },
        { text: "ilk", seqStart: 3, seqEnd: 4 },
        { text: "ikinci", seqStart: 4, seqEnd: 8 },
    ]);
    saved = JSON.stringify({ track: 1, clips: ["1:5.000:6.000"] });
    assert.equal(await sandbox.preparePremiereCaptionSegments(cues), null, "stale timeline selection blocks send");
    console.log("Caption exclusion tests passed");
})().catch(e => { console.error(e); process.exitCode = 1; });
