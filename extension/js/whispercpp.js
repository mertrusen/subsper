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

// ── Debug logging ───────────────────────────────────────────────────────────
// Every step is logged with a timestamp; kept in a ring buffer, optionally
// mirrored to a sink (UI) and a file. recentLog() is appended to error messages
// so we can see EXACTLY where/why something failed instead of guessing.
let _logSink = null, _logFile = null;
const _logBuf = [];
function setLogger(opts) {
    opts = opts || {};
    _logSink = opts.sink || null;
    _logFile = opts.file || null;
    if (_logFile) { try { fs.mkdirSync(path.dirname(_logFile), { recursive: true }); } catch (e) {} }
}
let _logQueue = [];
let _flushTimer = null;
function _flushLog() {
    if (!_logFile || !_logQueue.length) return;
    const batch = _logQueue.join('');
    _logQueue = [];
    try { fs.appendFile(_logFile, batch, () => {}); } catch (e) {}
}
function dbg(msg) {
    const line = new Date().toISOString().slice(11, 23) + "  " + msg;
    _logBuf.push(line);
    if (_logBuf.length > 800) _logBuf.shift();
    if (_logSink) { try { _logSink(line); } catch (e) {} }
    if (_logFile) {
        _logQueue.push(line + "\n");
        if (!_flushTimer) _flushTimer = setTimeout(() => { _flushTimer = null; _flushLog(); }, 200);
    }
}
function flushLog() { _flushLog(); }
function recentLog(n) { return _logBuf.slice(-(n || 25)).join("\n"); }
function logPath() { return _logFile; }

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

// Where the installed Subsper DESKTOP app keeps its bundled engine — so the
// Premiere extension reuses it (installing the desktop makes the extension work).
// Harmless on the desktop itself (its own bundled binary is found first).
function _desktopAppBins(name) {
    const exe = exeName(name);
    const rel = path.join("bin", platKey(), exe);
    if (process.platform === "darwin") {
        return [
            path.join("/Applications/Subsper.app/Contents/Resources", rel),
            path.join(os.homedir(), "Applications/Subsper.app/Contents/Resources", rel),
        ];
    }
    if (process.platform === "win32") {
        const la = process.env.LOCALAPPDATA || "";
        const pf = process.env.PROGRAMFILES || "C:\\Program Files";
        return [
            path.join(la, "Programs", "Subsper", "resources", rel),
            path.join(pf, "Subsper", "resources", rel),
        ];
    }
    return [];
}

/* Find a binary: bundled under <appDir>/bin/<plat>/, else the installed Subsper
 * desktop app's bundled copy, else a system copy, else rely on PATH. */
function resolveBin(appDir, name, systemCandidates) {
    const bundled = path.join(appDir, "bin", platKey(), exeName(name));
    if (safeExists(bundled)) return bundled;
    for (const c of _desktopAppBins(name)) {
        if (safeExists(c)) return c;
    }
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
const GGML_MIN_SIZES = {
    turbo:      1500000000,
    "large-v3": 3000000000,
    large:      3000000000,
    medium:     1400000000,
    small:      450000000,
    base:       130000000,
    tiny:       70000000,
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

function verifyModel(filepath, modelKey) {
    if (!safeExists(filepath)) return "File does not exist";
    const stat = fs.statSync(filepath);
    const minSize = GGML_MIN_SIZES[modelKey] || 50000000;
    if (stat.size < minSize) return `File too small (${(stat.size/1048576|0)} MB, expected at least ${(minSize/1048576|0)} MB) — download may be incomplete`;
    // Check GGML magic bytes
    try {
        const fd = fs.openSync(filepath, 'r');
        const buf = Buffer.alloc(4);
        fs.readSync(fd, buf, 0, 4, 0);
        fs.closeSync(fd);
        const magic = buf.toString('ascii');
        // GGML format magic values: 'GGML', 'GGMF', 'GGJT', 'GGUF' and ggml binary magic 0x67676d6c
        if (!/^(GGML|GGMF|GGJT|GGUF|ggml)/.test(magic) && buf.readUInt32LE(0) !== 0x67676d6c && buf.readUInt32LE(0) !== 0x46554747) {
            return "Invalid model file format (corrupt download?)";
        }
    } catch (e) { return "Could not verify model: " + e.message; }
    return null; // valid
}

function cleanupStaleDownloads() {
    const dir = modelsDir();
    if (!safeExists(dir)) return;
    try {
        const files = fs.readdirSync(dir);
        for (const f of files) {
            if (f.endsWith('.part')) {
                const fp = path.join(dir, f);
                try {
                    const stat = fs.statSync(fp);
                    // Delete .part files older than 1 hour (stale downloads)
                    if (Date.now() - stat.mtimeMs > 3600000) {
                        dbg('cleanup: removing stale ' + f);
                        fs.unlinkSync(fp);
                    }
                } catch (e) {}
            }
        }
    } catch (e) {}
}

const RETRIABLE = /ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|socket hang up|timed out|network|EPIPE|ECONNREFUSED|aborted/i;

/* Download the GGML model for `modelKey` if missing. Resumable + auto-retry, so
 * a dropped connection on a big (1.6 GB) model continues instead of restarting.
 * onProgress(fraction, bytes, total[, phase]). */
function ensureModel(modelKey, onProgress) {
    const dest = modelPath(modelKey);
    if (safeExists(dest)) return Promise.resolve(dest);
    const file = GGML_FILES[modelKey] || GGML_FILES.turbo;
    const url  = HF_BASE + file;
    const dir = path.dirname(dest);
    try {
        if (!fs.existsSync(dir)) {
            try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {
                try { fs.mkdirSync(path.dirname(dir)); } catch(e2){}
                try { fs.mkdirSync(dir); } catch(e3){}
            }
        }
    } catch (e) {}
    const tmp = dest + ".part";
    const MAX = 8;

    dbg("ensureModel: " + modelKey + " → " + file + " (" + url + ")");
    dbg("  dest=" + dest);
    return new Promise((resolve, reject) => {
        let attempt = 0;
        const tryOnce = () => {
            attempt++;
            const have = safeExists(tmp) ? (fs.statSync(tmp).size || 0) : 0;
            dbg("download attempt " + attempt + "/" + MAX + (have ? " (resume from " + (have / 1048576 | 0) + " MB)" : ""));
            _downloadResume(url, tmp, onProgress)
                .then(() => {
                    const sz = safeExists(tmp) ? fs.statSync(tmp).size : 0;
                    dbg("download complete: " + (sz / 1048576 | 0) + " MB; verifying…");
                    const verr = verifyModel(tmp, modelKey);
                    if (verr) {
                        dbg("model verification FAILED: " + verr);
                        try { fs.unlinkSync(tmp); } catch (e) {}
                        reject(new Error("Model verification failed: " + verr));
                        return;
                    }
                    dbg("model verified OK; renaming → model");
                    try { fs.renameSync(tmp, dest); } catch (e) { dbg("rename ERROR: " + e.message); }
                    resolve(dest);
                })
                .catch(err => {
                    const msg = (err && err.message) || String(err);
                    dbg("download attempt " + attempt + " FAILED: " + msg);
                    if (attempt < MAX && RETRIABLE.test(msg)) {
                        if (onProgress) onProgress(0, 0, 0, "reconnecting " + attempt);
                        setTimeout(tryOnce, 1500 * attempt);   // backoff; keeps the .part to resume
                    } else {
                        try { fs.unlinkSync(tmp); } catch (e) {}
                        reject(new Error("Model download failed after " + attempt + " attempt(s): " + msg));
                    }
                });
        };
        tryOnce();
    });
}

/* Resumable HTTPS download (handles HuggingFace→CDN redirects + Range resume). */
function _downloadResume(url, dest, onProgress) {
    return new Promise((resolve, reject) => {
        const startByte = safeExists(dest) ? (fs.statSync(dest).size || 0) : 0;

        const doReq = (u, redirects) => {
            if (redirects > 8) return reject(new Error("Too many redirects"));
            const headers = { "User-Agent": "Subsper/1.0", "Accept-Encoding": "identity" };
            if (startByte > 0) headers["Range"] = "bytes=" + startByte + "-";
            const host = (() => { try { return new URL(u).host; } catch (e) { return "?"; } })();
            dbg("GET " + host + (startByte ? " (Range from " + (startByte / 1048576 | 0) + " MB)" : ""));

            const req = https.get(u, { headers }, res => {
                const code = res.statusCode;
                dbg("  ← HTTP " + code + (res.headers.location ? " → " + (() => { try { return new URL(res.headers.location, u).host; } catch (e) { return res.headers.location; } })() : ""));
                if (code >= 300 && code < 400 && res.headers.location) {
                    res.resume();
                    const next = res.headers.location.startsWith("http")
                        ? res.headers.location
                        : new URL(res.headers.location, u).toString();
                    return doReq(next, redirects + 1);
                }
                if (code === 416) { res.resume(); return resolve(dest); }   // already complete
                if (code !== 200 && code !== 206) { res.resume(); return reject(new Error("HTTP " + code + " from " + host)); }

                const resuming = code === 206;                  // server honored Range
                const out = fs.createWriteStream(dest, { flags: resuming ? "a" : "w" });
                let got = resuming ? startByte : 0;
                const remaining = parseInt(res.headers["content-length"] || "0", 10);
                const total = resuming ? startByte + remaining : remaining;
                dbg("  streaming " + (total / 1048576 | 0) + " MB from " + host + (resuming ? " (resumed)" : ""));
                let settled = false;
                const fail = (e) => {
                    if (settled) return; settled = true;
                    dbg("  STREAM ERROR @ " + (got / 1048576 | 0) + "/" + (total / 1048576 | 0) + " MB: " + (e.code || "") + " " + e.message);
                    try { out.destroy(); } catch (x) {} reject(e);
                };
                res.on("data", c => { got += c.length; if (onProgress && total) onProgress(got / total, got, total); });
                res.on("error", fail);
                res.on("aborted", () => fail(new Error("response aborted (ECONNRESET)")));
                out.on("error", fail);
                out.on("finish", () => { if (settled) return; settled = true; out.close(() => resolve(dest)); });
                res.pipe(out);
            });
            req.on("error", e => { dbg("  REQUEST ERROR: " + (e.code || "") + " " + e.message); reject(e); });
            req.setTimeout(60000, () => { dbg("  TIMEOUT (no data 60s)"); req.destroy(new Error("Download timed out")); });
        };
        doReq(url, 0);
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
function toWav16k(appDir, inputPath, outWav, spawnOpts, signal, onProgress) {
    return new Promise((resolve, reject) => {
        const args = ["-y", "-i", inputPath, "-ar", "16000", "-ac", "1",
                      "-c:a", "pcm_s16le", "-vn", outWav];
        const ff = cp.spawn(ffmpegBin(appDir), args, spawnOpts || {});
        if (signal) {
            if (signal.aborted) { ff.kill(); return reject(new Error("Cancelled")); }
            signal.addEventListener('abort', () => { ff.kill(); }, { once: true });
        }
        let err = "", totalSec = 0;
        ff.stderr.on("data", d => {
            const s = d.toString(); err += s;
            if (onProgress) {
                if (!totalSec) { const md = /Duration:\s*(\d+):(\d+):(\d+)/.exec(s); if (md) totalSec = (+md[1])*3600 + (+md[2])*60 + (+md[3]); }
                const mt = /time=(\d+):(\d+):(\d+)/.exec(s);
                if (mt && totalSec) onProgress(Math.min(1, ((+mt[1])*3600 + (+mt[2])*60 + (+mt[3])) / totalSec));
            }
        });
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
    dbg("extractClipsToWav: " + clips.length + " clip(s) via ffmpeg " + ffmpegBin(appDir));
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
            "-t", String(opts.threads || Math.max(2, os.cpus().length)),
            "-pp",          // print progress to stderr
        ];
        // --dtw (aligned word timestamps) roughly DOUBLES transcription time.
        // The full JSON already carries heuristic token offsets, which is what
        // karaoke/word-SRT/beep actually consume — so DTW is opt-in now.
        if (opts.dtw) { args.push("--dtw", dtwPreset(opts.modelKey || "turbo")); }
        const lang = opts.language && opts.language !== "auto" ? opts.language : null;
        if (lang) { args.push("--language", lang); }
        else      { args.push("--language", "auto"); }

        // Context words / initial prompt (proper nouns, brand names) — improves
        // accuracy on hard terms. Was silently ignored before (setting had no effect).
        const prompt = (opts.initialPrompt || "").replace(/\s+/g, " ").trim();
        if (prompt) { args.push("--prompt", prompt.slice(0, 900)); }

        let bin = whisperBin(appDir);
        let gpuBin = null;
        if (process.platform === "win32" && !opts.forceCpu) {
            const gb = resolveBin(appDir, "whisper-cli-gpu", []);
            if (gb !== "whisper-cli-gpu.exe" && safeExists(gb)) {
                try {
                    const paths = [
                        path.join(process.env.WINDIR || "C:\\Windows", "System32", "vulkan-1.dll"),
                        path.join(process.env.WINDIR || "C:\\Windows", "SysWOW64", "vulkan-1.dll")
                    ];
                    if (paths.some(p => fs.existsSync(p))) gpuBin = gb;
                } catch(e) {}
            }
        }
        
        let currentBin = gpuBin || bin;
        dbg("whisper-cli target: " + currentBin + (gpuBin ? " (GPU)" : " (CPU)"));
        dbg("  model=" + mdl + " | wav=" + wav + " | lang=" + (lang || "auto"));
        if (!safeExists(bin)) return reject(new Error("Engine binary not found: " + bin));
        if (!safeExists(wav)) return reject(new Error("Audio file missing: " + wav));
        
        const launch = (exePath, isFallback) => {
            if (isFallback) dbg("FALLBACK: Retrying with CPU binary: " + exePath);
            const wc = cp.spawn(exePath, args, opts.spawnOpts || {});
            let errOut = "";
            
            if (opts.signal) {
                if (opts.signal.aborted) { wc.kill(); return reject(new Error("Transcription cancelled")); }
                opts.signal.addEventListener('abort', () => { dbg("abort signal received, killing whisper-cli"); wc.kill(); }, { once: true });
            }
            
            let sawOutput = false;
            const relay = (d) => {
                const s = d.toString();
                if (!sawOutput) { sawOutput = true; if (opts.onLog) opts.onLog("__ENGINE_STARTED__"); }
                if (opts.onLog) opts.onLog(s);
            };
            wc.stdout.on("data", relay);
            wc.stderr.on("data", d => { errOut += d; relay(d); });
            
            wc.on("close", code => {
                const outJson = outBase + ".json";
                if (code !== 0 && exePath === gpuBin && !isFallback && !safeExists(outJson)) {
                    dbg("GPU binary failed with code " + code + ". Falling back to CPU.");
                    launch(bin, true);
                    return;
                }
                dbg("whisper-cli exit " + code + (safeExists(outJson) ? " (json produced)" : " (no json)"));
                if (code !== 0 && !safeExists(outJson)) {
                    return reject(new Error("whisper.cpp failed (exit " + code + "): " + errOut.slice(-500)));
                }
                try {
                    const json = JSON.parse(fs.readFileSync(outJson, "utf8"));
                    const parsed = parseWhisperJson(json);
                    parsed.engine = "whisper.cpp";
                    dbg("parsed " + parsed.segments.length + " segment(s), lang=" + parsed.language);
                    try { fs.unlinkSync(outJson); } catch (e) {}
                    resolve(parsed);
                } catch (e) {
                    reject(new Error("Could not parse whisper.cpp output: " + e.message));
                }
            });
            wc.on("error", e => {
                if (exePath === gpuBin && !isFallback) {
                    dbg("GPU binary spawn failed: " + e.message + ". Falling back to CPU.");
                    launch(bin, true);
                    return;
                }
                dbg("whisper-cli spawn ERROR: " + e.message);
                reject(new Error("whisper.cpp could not run: " + e.message));
            });
        };
        
        launch(currentBin, false);
    });
}

// ── Python-free audio tools (bundled ffmpeg) ────────────────────────────────
// detect silences · enhance (denoise+normalize) · cut/keep ranges. These replace
// the Python scripts so the zero-setup engine covers Silence + Audio tabs too.

function _runFfmpeg(appDir, args, spawnOpts, onErrTail) {
    return new Promise((resolve, reject) => {
        const ff = cp.spawn(ffmpegBin(appDir), args, spawnOpts || {});
        let err = "";
        ff.stderr.on("data", d => { err += d.toString(); if (err.length > 200000) err = err.slice(-100000); });
        ff.on("error", e => reject(new Error("ffmpeg could not run: " + e.message)));
        ff.on("close", code => {
            if (onErrTail) onErrTail(err);
            code === 0 ? resolve(err) : reject(new Error("ffmpeg failed (" + code + "): " + err.slice(-400)));
        });
    });
}

/* Detect silent gaps with ffmpeg's silencedetect filter (no Python).
 * → Promise<[{start,end,dur}]> in seconds. */
async function detectSilence(appDir, inputPath, thresholdDb, minDur, spawnOpts) {
    const db  = parseFloat(thresholdDb); const d = Math.max(0.05, parseFloat(minDur) || 0.6);
    const thr = isNaN(db) ? -30 : db;
    const args = ["-hide_banner", "-i", normalizePath(inputPath),
                  "-af", "silencedetect=noise=" + thr + "dB:d=" + d, "-f", "null", "-"];
    dbg("detectSilence: thr=" + thr + "dB minDur=" + d + " on " + inputPath);
    const err = await _runFfmpeg(appDir, args, spawnOpts);
    const ranges = [];
    let curStart = null;
    const lines = err.split(/\r?\n/);
    for (const ln of lines) {
        let m = ln.match(/silence_start:\s*(-?[\d.]+)/);
        if (m) { curStart = parseFloat(m[1]); continue; }
        m = ln.match(/silence_end:\s*(-?[\d.]+)/);
        if (m && curStart != null) {
            const end = parseFloat(m[1]);
            if (end > curStart) ranges.push({ start: Math.max(0, curStart), end, dur: end - curStart });
            curStart = null;
        }
    }
    dbg("detectSilence: " + ranges.length + " gap(s)");
    return ranges;
}

/* Enhance audio: high-pass + FFT denoise (optional) and EBU R128 loudness
 * normalize to −16 LUFS (optional). Writes a 16-bit WAV. */
async function enhanceMedia(appDir, inputPath, outPath, denoise, normalize, spawnOpts) {
    const chain = [];
    if (denoise) {
        // Gentle, voice-preserving cleanup for phone-mic material (was too
        // aggressive — afftdn=nf=-25 choked the voice). Light rumble cut,
        // MODERATE FFT denoise (nr=12 dB), a touch of de-ess, then compand to
        // tame room/echo peaks without gating the speech.
        chain.push("highpass=f=90");
        chain.push("afftdn=nr=12:nf=-30:tn=1");
        chain.push("deesser=i=0.4");
        chain.push("compand=attacks=0.02:decays=0.2:points=-80/-80|-45/-30|-27/-18|0/-6:soft-knee=6");
    }
    if (normalize) { chain.push("loudnorm=I=-16:TP=-1.5:LRA=11"); }
    if (!chain.length) chain.push("anull");
    const args = ["-y", "-i", normalizePath(inputPath), "-af", chain.join(","),
                  "-c:a", "pcm_s16le", "-ar", "48000", "-vn", outPath];
    dbg("enhanceMedia: denoise=" + !!denoise + " normalize=" + !!normalize);
    await _runFfmpeg(appDir, args, spawnOpts);
    return outPath;
}

/* Cut a media file to only the KEEP ranges (complement of silences), trimming +
 * concatenating with ffmpeg. keep = [[startSec,endSec], …]. opts.video=false for
 * audio-only inputs. Re-encodes. */
async function cutMedia(appDir, inputPath, outPath, keep, opts) {
    opts = opts || {};
    const hasVideo = opts.video !== false;
    if (!keep || !keep.length) throw new Error("No ranges to keep.");
    const parts = [], ins = [];
    keep.forEach((r, i) => {
        const a = r[0], b = r[1];
        if (hasVideo) {
            parts.push("[0:v]trim=start=" + a + ":end=" + b + ",setpts=PTS-STARTPTS[v" + i + "]");
            parts.push("[0:a]atrim=start=" + a + ":end=" + b + ",asetpts=PTS-STARTPTS[a" + i + "]");
            ins.push("[v" + i + "][a" + i + "]");
        } else {
            parts.push("[0:a]atrim=start=" + a + ":end=" + b + ",asetpts=PTS-STARTPTS[a" + i + "]");
            ins.push("[a" + i + "]");
        }
    });
    const n = keep.length;
    const concat = hasVideo
        ? ins.join("") + "concat=n=" + n + ":v=1:a=1[outv][outa]"
        : ins.join("") + "concat=n=" + n + ":v=0:a=1[outa]";
    const args = ["-y", "-i", normalizePath(inputPath), "-filter_complex", parts.join(";") + ";" + concat];
    if (hasVideo) args.push("-map", "[outv]");
    args.push("-map", "[outa]", outPath);
    dbg("cutMedia: " + n + " keep-range(s), video=" + hasVideo);
    await _runFfmpeg(appDir, args, opts.spawnOpts || {});
    return outPath;
}

/* Beep/mute profanity: mutes the original audio during `ranges` and overlays a
 * 1 kHz beep there. ranges=[{start,end}] seconds. opts.video=false for audio
 * files, opts.mode="mute" skips the beep tone. Video stream is stream-copied. */
async function beepRanges(appDir, inputPath, outPath, ranges, opts) {
    opts = opts || {};
    if (!ranges || !ranges.length) throw new Error("No ranges to beep.");
    const expr = ranges.map(r => `between(t,${r.start.toFixed(3)},${r.end.toFixed(3)})`).join("+");
    const dur = Math.max.apply(null, ranges.map(r => r.end)) + 1;
    const duck = Math.max(0, Math.min(1, opts.duck || 0));   // original level under the beep
    const filters = [
        `[0:a]volume='if(${expr},${duck.toFixed(2)},1)':eval=frame[main]`,
    ];
    let amixIn = "[main]";
    if (opts.mode !== "mute") {
        filters.push(`sine=f=1000:d=${dur.toFixed(2)}[bp0]`);
        filters.push(`[bp0]volume='if(${expr},0.30,0)':eval=frame[bp]`);
        amixIn = "[main][bp]";
        filters.push(`${amixIn}amix=inputs=2:duration=first:normalize=0[outa]`);
    } else {
        filters.push(`[main]anull[outa]`);
    }
    const args = ["-y", "-i", normalizePath(inputPath), "-filter_complex", filters.join(";"),
                  "-map", "[outa]"];
    if (opts.video !== false) args.push("-map", "0:v?", "-c:v", "copy");
    args.push(outPath);
    dbg("beepRanges: " + ranges.length + " range(s), mode=" + (opts.mode || "beep"));
    await _runFfmpeg(appDir, args, opts.spawnOpts || {});
    return outPath;
}

/* Overlay-only beep track: a WAV that is SILENT everywhere except a 1 kHz tone
 * during `ranges` — meant to be laid on its own track above the original audio
 * (Premiere). ranges=[{start,end}] in timeline seconds. */
async function beepTrackWav(appDir, ranges, outWav, opts) {
    opts = opts || {};
    if (!ranges || !ranges.length) throw new Error("No ranges to beep.");
    const expr = ranges.map(r => `between(t,${r.start.toFixed(3)},${r.end.toFixed(3)})`).join("+");
    const dur = Math.max.apply(null, ranges.map(r => r.end)) + 0.5;
    const args = ["-y", "-f", "lavfi", "-i", `sine=f=1000:d=${dur.toFixed(2)}`,
                  "-af", `volume='if(${expr},0.85,0)':eval=frame`,
                  "-ar", "48000", "-c:a", "pcm_s16le", outWav];
    dbg("beepTrackWav: " + ranges.length + " range(s), dur=" + dur.toFixed(1) + "s");
    await _runFfmpeg(appDir, args, opts.spawnOpts || {});
    return outWav;
}

module.exports = {
    platKey, whisperBin, ffmpegBin, resolveBin,
    modelsDir, modelPath, modelExists, ensureModel, GGML_FILES,
    parseWhisperJson, toWav16k, transcribeWav, dtwPreset,
    normalizePath, extractClipsToWav,
    detectSilence, enhanceMedia, cutMedia, beepRanges, beepTrackWav,
    setLogger, recentLog, logPath, dbg,
    flushLog, cleanupStaleDownloads, verifyModel,
};
