"use strict";

// A continuous music bed must not hide a speech gap on the selected source.
const assert = require("node:assert/strict");
const cp = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const W = require("../../js/whispercpp.js");

const root = path.resolve(__dirname, "../..");
const ffmpeg = W.ffmpegBin(root);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "subsper-silence-source-"));

async function run() {
    const voice = path.join(temp, "voice.wav");
    const music = path.join(temp, "music.wav");
    const isolated = path.join(temp, "isolated.wav");
    const mixed = path.join(temp, "mixed.wav");
    cp.execFileSync(ffmpeg, ["-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=1",
        "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono:d=1",
        "-filter_complex", "[0:a][1:a][0:a]concat=n=3:v=0:a=1[out]",
        "-map", "[out]", voice], { stdio: "ignore" });
    cp.execFileSync(ffmpeg, ["-y", "-f", "lavfi", "-i", "sine=frequency=880:duration=3",
        music], { stdio: "ignore" });
    const voiceClip = { path: voice, srcStart: 0, timelineStart: 0, duration: 3 };
    const musicClip = { path: music, srcStart: 0, timelineStart: 0, duration: 3 };
    await W.extractClipsToWav(root, { clips: [voiceClip], duration: 3 }, isolated);
    await W.extractClipsToWav(root, { clips: [voiceClip, musicClip], duration: 3 }, mixed);
    const speechGaps = await W.detectSilence(root, isolated, -30, 0.5);
    const mixedGaps = await W.detectSilence(root, mixed, -30, 0.5);
    assert.ok(speechGaps.some(r => r.start >= 0.9 && r.end <= 2.1 && r.dur >= 0.9),
        "the selected voice source exposes its pause");
    assert.equal(mixedGaps.length, 0, "a music bed masks that pause when tracks are mixed");
    console.log("selected speech source finds a gap hidden by mixed music");
}

run().catch(e => { console.error(e); process.exitCode = 1; })
    .finally(() => fs.rmSync(temp, { recursive: true, force: true }));
