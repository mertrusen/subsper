"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const cp = require("node:child_process");
const W = require("../../js/whispercpp.js");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "subsper-ffmpeg-resolution-"));
const originalPath = process.env.PATH;
try {
    const broken = path.join(root, "app", "bin", W.platKey(), process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
    const fallback = path.join(root, "path", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
    fs.mkdirSync(path.dirname(broken), { recursive: true });
    fs.mkdirSync(path.dirname(fallback), { recursive: true });
    if (process.platform === "win32") {
        // The production Windows path is covered by its release build; this
        // fixture uses POSIX shell executables to simulate a dyld failure.
        console.log("ffmpeg resolution fixture skipped on Windows");
    } else {
        fs.writeFileSync(broken, "#!/bin/sh\necho 'Library not loaded: /missing/libfontconfig.dylib' >&2\nexit 127\n", { mode: 0o755 });
        fs.writeFileSync(fallback, "#!/bin/sh\necho 'ffmpeg version fixture'\n", { mode: 0o755 });
        process.env.PATH = path.dirname(fallback);
        assert.equal(W.ffmpegAvailable(path.join(root, "app")), true);
        const selected = W.ffmpegBin(path.join(root, "app"));
        assert.notEqual(selected, broken, "an existing but broken bundle must be skipped");
        assert.match(cp.execFileSync(selected, ["-version"], { encoding: "utf8" }), /ffmpeg version/);
        assert.match(W.recentLog(), /ffmpeg unavailable/);
        console.log("ffmpeg resolution fallback passed");
    }
} finally {
    process.env.PATH = originalPath;
    fs.rmSync(root, { recursive: true, force: true });
}
