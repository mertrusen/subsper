/* whispercpp.js — Subsper bundled transcription engine (whisper.cpp)
 *
 * Pure Node (child_process/fs/path only) so it runs identically inside the
 * Premiere CEP panel, the Electron desktop app, AND from a plain `node` CLI
 * for testing. No CSInterface / DOM / browser globals here.
 *
 * This is the "zero-setup" engine: a bundled native whisper.cpp binary +
 * bundled ffmpeg + an on-demand GGML model download. No Python required.
 */
"use strict";

const cp   = require("child_process");
const fs   = require("fs");
const path = require("path");
const os   = require("os");
const https = require("https");

// ── Platform / binary resolution ──────────────────────────────────────────
function platKey() {
    const p = process.platform, a = process.arch;
    if (p === "win32")  return "win-x64";
    if (p === "darwin") return a === "arm64" ? "darwin-arm64" : "darwin-x64";
    return "linux-x64";
}

function exeName(base) {
    return process.platform === "win32" ? base + ".exe" : base;
}

/* Find a bundled binary under <appDir>/bin/<plat>/<name>, else fall back to a
 * system copy (known absolute paths, then bare name for PATH resolution). */
function resolveBin(appDir, name, systemCandidates) {
    const bundled = path.join(appDir, "bin", platKey(), exeName(name));
    if (safeExists(bundled)) return bundled;
    for (const c of (systemCandidates || [])) {
        if (safeExists(c)) return c;
    }
    return exeName(name); // last resort: rely on PATH
}

function whisperBin(appDir) {
    return resolveBin(appDir, "whisper-cli", [
        "/opt/homebrew/bin/whisper-cli",
        "/usr/local/bin/whisper-cli",
    ]);
}

function ffmpegBin(appDir) {
    return resolveBin(appDir, "ffmpeg", [
        "/opt/homebrew/bin/ffmpeg",
        "/usr/local/bin/ffmpeg",
        "/usr/bin/ffmpeg",
    ]);
}

function safeExists(p) { try { return fs.existsSync(p); } catch (e) { return false; } }

// ── Models ─────────────────────────────────────────────────────────────────
// GGML model files live in a per-user cache so they survive app updates and are
// downloaded once. Maps our UI model keys → whisper.cpp ggml file names.
const GGML_FILES = {
    turbo:      "ggml-large-v3-turbo.bin",
    "large-v3": "ggml-large-v3.bin",
    large:      "ggml-large-v3.bin",
    medium:     "ggml-medium.bin",
    small:      "ggml-small.bin",
    base:       "ggml-base.bin",
    tiny:       "ggml-tiny.bin",
};
const HF_BASE = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/";

function modelsDir() {
    let base;
    if (process.platform === "win32") {
        base = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
    } else if (process.platform === "darwin") {
        base = path.join(os.homedir(), "Library", "Application Support");
    } else {
        base = process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
    }
    return path.join(base, "Subsper", "models");
}

function modelPath(modelKey) {
    const file = GGML_FILES[modelKey] || GGML_FILES.turbo;
    return path.join(modelsDir(), file);
}

function modelExists(modelKey) { return safeExists(modelPath(modelKey)); }

/* Download the GGML model for `modelKey` if missing. onProgress(fraction,bytes,total). */
function ensureModel(modelKey, onProgress) {
    return new Promise((resolve, reject) => {
        const dest = modelPath(modelKey);
        if (safeExists(dest)) return resolve(dest);
        const file = GGML_FILES[modelKey] || GGML_FILES.turbo;
        const url  = HF_BASE + file;
        try { fs.mkdirSync(path.dirname(dest), { recursive: true }); } catch (e) {}
        const tmp = dest + ".part";
        _download(url, tmp, onProgress)
            .then(() => { fs.renameSync(tmp, dest); resolve(dest); })
            .catch(err => { try { fs.unlinkSync(tmp); } catch (e) {} reject(err); });
    });
}

function _download(url, dest, onProgress, redirects) {
    redirects = redirects || 0;
    return new Promise((resolve, reject) => {
        if (redirects > 6) return reject(new Error("Too many redirects"));
        const out = fs.createWriteStream(dest);
        const req = https.get(url, { headers: { "User-Agent": "Subsper" } }, res => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                out.close(); try { fs.unlinkSync(dest); } catch (e) {}
                const next = res.headers.location.startsWith("http")
                    ? res.headers.location
                    : new URL(res.headers.location, url).toString();
                return resolve(_download(next, dest, onProgress, redirects + 1));
            }
            if (res.statusCode !== 200) {
                out.close(); return reject(new Error("Model download failed: HTTP " + res.statusCode));
            }
            const total = parseInt(res.headers["content-length"] || "0", 10);
            let got = 0;
            res.on("data", chunk => {
                got += chunk.length;
                if (onProgress && total) onProgress(got / total, got, total);
            });
            res.pipe(out);
            out.on("finish", () => out.close(resolve));
        });
        req.on("error", err => { try { fs.unlinkSync(dest); } catch (e) {} reject(err); });
    });
}

// ── JSON parsing (whisper.cpp -ojf → our segment format) ────────────────────
const SPECIAL_RE = /^\s*(\[_|<\|)/; // [_BEG_], [_TT_..], <|...|> control tokens

function _isSpecial(tok) {
    const t = (tok && tok.text) || "";
    return SPECIAL_RE.test(t) || t === "";
}

/* Merge whisper.cpp tokens into words. Tokens are sub-word pieces; a token that
 * begins with a space starts a new word. Returns [{word,start,end}] (seconds). */
function _wordsFromTokens(tokens) {
    const words = [];
    let cur = null;
    for (const tk of tokens || []) {
        if (_isSpecial(tk)) continue;
        const raw = tk.text || "";
        const from = (tk.offsets && tk.offsets.from != null) ? tk.offsets.from / 1000 : null;
        const to   = (tk.offsets && tk.offsets.to   != null) ? tk.offsets.to   / 1000 : null;
        const startsWord = /^\s/.test(raw) || cur === null;
        if (startsWord) {
            if (cur && cur.word.trim()) words.push(_finishWord(cur));
            cur = { word: raw, start: from, end: to };
        } else {
            cur.word += raw;
            if (to != null) cur.end = to;
        }
    }
    if (cur && cur.word.trim()) words.push(_finishWord(cur));
    return words;
}
function _finishWord(w) {
    return { word: w.word.trim(), start: w.start, end: w.end };
}

/* Parse a whisper.cpp full JSON (-ojf) object → { segments, text, language }.
 * Each segment: { start, end, text, words:[{word,start,end}] } in SECONDS. */
function parseWhisperJson(json) {
    const language = (json.result && json.result.language) || (json.params && json.params.language) || "";
    const segs = [];
    let fullText = "";
    for (const t of (json.transcription || [])) {
        const start = (t.offsets && t.offsets.from != null) ? t.offsets.from / 1000 : 0;
        const end   = (t.offsets && t.offsets.to   != null) ? t.offsets.to   / 1000 : 0;
        const text  = (t.text || "").trim();
        if (!text) continue;
        const words = _wordsFromTokens(t.tokens);
        segs.push({ start, end, text, words });
        fullText += (fullText ? " " : "") + text;
    }
    return { segments: segs, text: fullText, language };
}

// ── DTW alignment preset (improves word timing where supported) ─────────────
function dtwPreset(modelKey) {
    switch (modelKey) {
        case "turbo": case "large": case "large-v3": return "large.v3";
        case "medium": return "medium";
        case "small":  return "small";
        case "base":   return "base";
        case "tiny":   return "tiny";
        default:       return "large.v3";
    }
}

// ── ffmpeg: any media → 16 kHz mono PCM WAV (what whisper.cpp wants) ─────────
function toWav16k(appDir, inputPath, outWav, spawnOpts) {
    return new Promise((resolve, reject) => {
        const args = ["-y", "-i", inputPath, "-ar", "16000", "-ac", "1",
                      "-c:a", "pcm_s16le", "-vn", outWav];
        const ff = cp.spawn(ffmpegBin(appDir), args, spawnOpts || {});
        let err = "";
        ff.stderr.on("data", d => { err += d.toString(); });
        ff.on("error", e => reject(new Error("ffmpeg could not run: " + e.message)));
        ff.on("close", code => code === 0
            ? resolve(outWav)
            : reject(new Error("ffmpeg failed (" + code + "): " + err.slice(-400))));
    });
}

// ── Timeline clip extraction (Premiere) → one 16 kHz mono WAV ───────────────
// Node port of extract_audio.py so the extension needs no Python/ffmpeg install.
function normalizePath(p) {
    if (!p) return p;
    if (p.indexOf("file:///") === 0)      p = p.slice(7);
    else if (p.indexOf("file://") === 0)  p = p.slice(6);
    else if (p.indexOf("file:/") === 0)   p = p.slice(5);
    try { p = decodeURIComponent(p); } catch (e) {}
    return p;
}

function _ffSingleClip(appDir, clip, outWav, spawnOpts) {
    return new Promise((resolve, reject) => {
        const srcStart = Math.max(0, parseFloat(clip.srcStart) || 0);
        const duration = parseFloat(clip.duration) || 0;
        if (duration < 0.01) return reject(new Error("Clip duration too small (check the clip)."));
        const args = ["-y", "-ss", String(srcStart), "-i", normalizePath(clip.path),
                      "-t", String(duration), "-vn", "-ar", "16000", "-ac", "1",
                      "-acodec", "pcm_s16le", outWav];
        const ff = cp.spawn(ffmpegBin(appDir), args, spawnOpts || {});
        let err = ""; ff.stderr.on("data", d => { err += d.toString(); });
        ff.on("error", e => reject(new Error("ffmpeg could not run: " + e.message)));
        ff.on("close", c => c === 0 ? resolve(outWav)
            : reject(new Error("ffmpeg failed: " + err.slice(-300))));
    });
}

function _ffMixClips(appDir, parts, outWav, totalDur, spawnOpts) {
    // parts: [{wav, offset}]  → adelay each by its timeline offset, then amix
    return new Promise((resolve, reject) => {
        const inputs = [], filters = [];
        parts.forEach((p, i) => {
            inputs.push("-i", p.wav);
            const d = Math.max(0, Math.round(p.offset * 1000));
            filters.push(`[${i}]adelay=${d}|${d}[d${i}]`);
        });
        const map = parts.map((_, i) => `[d${i}]`).join("");
        const flt = filters.join(";") + `;${map}amix=inputs=${parts.length}:duration=longest:normalize=0[out]`;
        const args = ["-y", ...inputs, "-filter_complex", flt, "-map", "[out]",
                      "-t", String(totalDur), "-ar", "16000", "-ac", "1", outWav];
        const ff = cp.spawn(ffmpegBin(appDir), args, spawnOpts || {});
        let err = ""; ff.stderr.on("data", d => { err += d.toString(); });
        ff.on("error", e => reject(new Error("ffmpeg could not run: " + e.message)));
        ff.on("close", c => c === 0 ? resolve(outWav)
            : reject(new Error("Audio mix failed: " + err.slice(-300))));
    });
}

/* clipsData: { clips:[{path,srcStart,duration,timelineStart}], duration }
 * → writes a single 16 kHz mono WAV to outWav. */
async function extractClipsToWav(appDir, clipsData, outWav, spawnOpts) {
    const clips = (clipsData.clips || []).map(c => ({ ...c, path: normalizePath(c.path) }));
    if (!clips.length) throw new Error("No clips to extract.");
    const missing = clips.find(c => !safeExists(c.path));
    if (missing) throw new Error("Source media file not found on disk:\n" + missing.path +
                                 "\nRe-link the offline clip in Premiere and try again.");
    if (clips.length === 1) return _ffSingleClip(appDir, clips[0], outWav, spawnOpts);

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "subsper_ext_"));
    try {
        const parts = [];
        for (let i = 0; i < clips.length; i++) {
            const seg = path.join(tmpDir, "seg_" + i + ".wav");
            try { await _ffSingleClip(appDir, clips[i], seg, spawnOpts);
                  parts.push({ wav: seg, offset: parseFloat(clips[i].timelineStart) || 0 }); }
            catch (e) { /* skip a bad clip, keep going */ }
        }
        if (!parts.length) throw new Error("All audio extractions failed.");
        if (parts.length === 1) { fs.copyFileSync(parts[0].wav, outWav); return outWav; }
        return await _ffMixClips(appDir, parts, outWav, parseFloat(clipsData.duration) || 0, spawnOpts);
    } finally {
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
    }
}

// ── Transcribe a 16 kHz WAV with the bundled whisper.cpp ─────────────────────
/* opts: { appDir, wavPath, modelKey, language, threads, onLog }
 * → Promise<{ segments, text, language, engine }> */
function transcribeWav(opts) {
    return new Promise((resolve, reject) => {
        const appDir   = opts.appDir;
        const wav      = opts.wavPath;
        const mdl      = modelPath(opts.modelKey || "turbo");
        const outBase  = path.join(os.tmpdir(), "subsper_cpp_" + Date.now());
        if (!safeExists(mdl)) return reject(new Error("Model not found: " + mdl));

        const args = [
            "-m", mdl,
            "-f", wav,
            "-ojf", "-of", outBase,
            "--dtw", dtwPreset(opts.modelKey || "turbo"),
            "-t", String(opts.threads || Math.max(2, Math.min(8, os.cpus().length))),
            "-pp",          // print progress to stderr
        ];
        const lang = opts.language && opts.language !== "auto" ? opts.language : null;
        if (lang) { args.push("--language", lang); }
        else      { args.push("--language", "auto"); }

        const wc = cp.spawn(whisperBin(appDir), args, opts.spawnOpts || {});
        let err = "";
        wc.stdout.on("data", d => { if (opts.onLog) opts.onLog(d.toString()); });
        wc.stderr.on("data", d => {
            const s = d.toString(); err += s;
            if (opts.onLog) opts.onLog(s);
        });
        wc.on("error", e => reject(new Error("whisper.cpp could not run: " + e.message)));
        wc.on("close", code => {
            const outJson = outBase + ".json";
            if (code !== 0 && !safeExists(outJson)) {
                return reject(new Error("whisper.cpp failed (" + code + "): " + err.slice(-500)));
            }
            try {
                const json = JSON.parse(fs.readFileSync(outJson, "utf8"));
                const parsed = parseWhisperJson(json);
                parsed.engine = "whisper.cpp";
                try { fs.unlinkSync(outJson); } catch (e) {}
                resolve(parsed);
            } catch (e) {
                reject(new Error("Could not parse whisper.cpp output: " + e.message));
            }
        });
    });
}

module.exports = {
    platKey, whisperBin, ffmpegBin, resolveBin,
    modelsDir, modelPath, modelExists, ensureModel, GGML_FILES,
    parseWhisperJson, toWav16k, transcribeWav, dtwPreset,
    normalizePath, extractClipsToWav,
};
