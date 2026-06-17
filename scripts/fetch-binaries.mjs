#!/usr/bin/env node
/* fetch-binaries.mjs — prepare the bundled native engine for THIS platform.
 *
 * Produces  bin/<plat>/whisper-cli[.exe]  and  bin/<plat>/ffmpeg[.exe].
 * Run once per OS (locally or in CI) before electron-builder packages the app.
 *
 *   plat ∈ { win-x64, darwin-arm64, darwin-x64, linux-x64 }
 *
 * - whisper-cli: built from source (statically linked → portable, no Homebrew /
 *   no shared ggml dylibs). macOS embeds the Metal shader library.
 * - ffmpeg: taken from the `ffmpeg-static` npm package (static, per-platform).
 *
 * Requires: git + cmake + a C/C++ toolchain (preinstalled on GitHub runners;
 * locally: `brew install cmake` on macOS, Visual Studio Build Tools on Windows).
 */
import { execSync } from "node:child_process";
import fs   from "node:fs";
import path from "node:path";
import os   from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const isWin = process.platform === "win32";
const EXE   = isWin ? ".exe" : "";

const PLAT =
  isWin                       ? "win-x64" :
  process.platform === "darwin" ? (process.env.FORCE_MAC_X64 ? "darwin-x64" : (process.arch === "arm64" ? "darwin-arm64" : "darwin-x64")) :
  "linux-x64";

const OUT = path.join(ROOT, "bin", PLAT);
fs.mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log("[fetch-binaries]", ...a);
const run = (cmd, opts = {}) => execSync(cmd, { stdio: "inherit", ...opts });

// ── 1) whisper.cpp (built from source → portable) ──────────────────────────
function buildWhisper() {
  const dst = path.join(OUT, "whisper-cli" + EXE);
  if (fs.existsSync(dst) && !process.env.FORCE) { log("whisper-cli exists, skip"); return; }

  const work = path.join(os.tmpdir(), "subsper-whispercpp");
  if (!fs.existsSync(path.join(work, "CMakeLists.txt"))) {
    fs.rmSync(work, { recursive: true, force: true });
    log("cloning whisper.cpp…");
    run(`git clone --depth 1 https://github.com/ggml-org/whisper.cpp "${work}"`);
  }

  let flags = "-DBUILD_SHARED_LIBS=OFF -DCMAKE_BUILD_TYPE=Release -DWHISPER_BUILD_EXAMPLES=ON";
  if (process.platform === "darwin") {
    flags += " -DGGML_METAL_EMBED_LIBRARY=ON";
    if (process.env.FORCE_MAC_X64) flags += " -DCMAKE_OSX_ARCHITECTURES=x86_64";
  } else if (isWin) {
    // Static CRT so the .exe doesn't need vcruntime DLLs on the user's PC.
    flags += " -DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded -DCMAKE_POLICY_DEFAULT_CMP0091=NEW";
  }

  log("configuring…");
  run(`cmake -B build ${flags}`, { cwd: work });
  log("building whisper-cli…");
  run(`cmake --build build --config Release -j --target whisper-cli`, { cwd: work });

  const cands = [
    path.join(work, "build", "bin", "whisper-cli" + EXE),
    path.join(work, "build", "bin", "Release", "whisper-cli" + EXE),
    path.join(work, "build", "Release", "whisper-cli" + EXE),
  ];
  const built = cands.find(p => fs.existsSync(p));
  if (!built) throw new Error("whisper-cli not found after build. Looked in:\n" + cands.join("\n"));
  fs.copyFileSync(built, dst);
  if (!isWin) fs.chmodSync(dst, 0o755);
  log("whisper-cli →", dst);
}

// ── 2) ffmpeg (static, from ffmpeg-static npm) ──────────────────────────────
async function copyFfmpeg() {
  const dst = path.join(OUT, "ffmpeg" + EXE);
  const mod = await import("ffmpeg-static");
  const src = mod.default || mod;
  if (!src || !fs.existsSync(src)) throw new Error("ffmpeg-static binary not found: " + src);
  fs.copyFileSync(src, dst);
  if (!isWin) fs.chmodSync(dst, 0o755);
  log("ffmpeg →", dst);
}

(async () => {
  log("platform:", PLAT, "| out:", OUT);
  buildWhisper();
  await copyFfmpeg();
  log("done ✓  bundled:", fs.readdirSync(OUT).join(", "));
})().catch(e => { console.error("[fetch-binaries] FAILED:", e.message); process.exit(1); });
