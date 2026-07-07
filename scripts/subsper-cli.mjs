#!/usr/bin/env node
/* Subsper CLI — headless transcription to SRT. No UI, no Python.
 *
 *   node scripts/subsper-cli.mjs video.mp4 [more files…] [--model turbo] [--lang auto]
 *   npm run cli -- video.mp4 --model small --lang tr
 *
 * Uses the same bundled engine as the apps (bin/<plat>/, or the installed
 * Subsper desktop app's copy if this repo has no binaries).
 */
import { createRequire } from "module";
import path from "path";
import os from "os";
import fs from "fs";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const W = require(path.join(ROOT, "js", "whispercpp.js"));

const args = process.argv.slice(2);
const files = [];
let model = "turbo", lang = "auto", wantHelp = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--model") model = args[++i];
  else if (args[i] === "--lang") lang = args[++i];
  else if (args[i] === "--help" || args[i] === "-h") wantHelp = true;
  else files.push(args[i]);
}
if (wantHelp || !files.length) {
  console.log("Usage: subsper-cli <media files…> [--model turbo|large|medium|small|base|tiny] [--lang auto|tr|en|…]");
  process.exit(wantHelp ? 0 : 1);
}

const p2 = n => String(n).padStart(2, "0");
const p3 = n => String(n).padStart(3, "0");
const fmt = s => `${p2(Math.floor(s / 3600))}:${p2(Math.floor(s % 3600 / 60))}:${p2(Math.floor(s % 60))},${p3(Math.round(s % 1 * 1000))}`;

const bar = f => process.stdout.write(`\r  ${Math.round(f * 100)}%   `);

(async () => {
  if (!W.modelExists(model)) {
    console.log(`Downloading ${model} model (one-time)…`);
    await W.ensureModel(model, f => bar(f));
    console.log("\n  model ready");
  }
  let ok = 0, fail = 0;
  for (const input of files) {
    const abs = path.resolve(input);
    if (!fs.existsSync(abs)) { console.error(`✗ not found: ${input}`); fail++; continue; }
    const out = abs.replace(/\.[^.]+$/, "") + ".srt";
    console.log(`\n▸ ${path.basename(abs)}`);
    try {
      const wav = path.join(os.tmpdir(), `subsper_cli_${Date.now()}.wav`);
      await W.toWav16k(ROOT, abs, wav, {});
      const r = await W.transcribeWav({
        appDir: ROOT, wavPath: wav, modelKey: model, language: lang,
        onLog: s => { const m = /progress\s*=\s*(\d+)\s*%/i.exec(s); if (m) bar(+m[1] / 100); },
      });
      try { fs.unlinkSync(wav); } catch {}
      const srt = r.segments.map((s, i) =>
        `${i + 1}\n${fmt(s.start)} --> ${fmt(s.end)}\n${s.text.trim()}\n`).join("\n");
      fs.writeFileSync(out, srt, "utf8");
      console.log(`\r✓ ${r.segments.length} segment(s) [${r.language}] → ${out}`);
      ok++;
    } catch (e) {
      console.error(`\r✗ ${input}: ${e.message}`);
      fail++;
    }
  }
  console.log(`\nDone — ${ok} ok, ${fail} failed`);
  process.exit(fail && !ok ? 1 : 0);
})();
