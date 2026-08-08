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
 * - ffmpeg: LGPL only. Built from source on macOS/Linux, BtbN's LGPL build on
 *   Windows, and verified either way — see prepareFfmpeg() and
 *   THIRD-PARTY-NOTICES.md for why this is not negotiable.
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
const skipWinGpu = isWin && process.env.SKIP_WHISPER_GPU === "1";

const PLAT =
  isWin                       ? "win-x64" :
  process.platform === "darwin" ? (process.env.FORCE_MAC_X64 ? "darwin-x64" : (process.arch === "arm64" ? "darwin-arm64" : "darwin-x64")) :
  "linux-x64";

const OUT = path.join(ROOT, "bin", PLAT);
fs.mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log("[fetch-binaries]", ...a);
const run = (cmd, opts = {}) => execSync(cmd, { stdio: "inherit", ...opts });

// ── 1) whisper.cpp (built from source → portable) ──────────────────────────
function buildWhisper(vulkan = false) {
  const exeName = vulkan ? "whisper-cli-gpu" + EXE : "whisper-cli" + EXE;
  const dst = path.join(OUT, exeName);
  if (fs.existsSync(dst) && !process.env.FORCE) { log(exeName + " exists, skip"); return; }

  const work = path.join(os.tmpdir(), vulkan ? "subsper-whispercpp-vk" : "subsper-whispercpp");
  if (!fs.existsSync(path.join(work, "CMakeLists.txt"))) {
    fs.rmSync(work, { recursive: true, force: true });
    log("cloning whisper.cpp… (" + exeName + ")");
    run(`git clone --depth 1 https://github.com/ggml-org/whisper.cpp "${work}"`);
  }

  let flags = "-DBUILD_SHARED_LIBS=OFF -DCMAKE_BUILD_TYPE=Release -DWHISPER_BUILD_EXAMPLES=ON";
  if (process.platform === "darwin") {
    flags += " -DGGML_METAL_EMBED_LIBRARY=ON";
    if (process.env.FORCE_MAC_X64) flags += " -DCMAKE_OSX_ARCHITECTURES=x86_64 -DGGML_NATIVE=OFF";
  } else if (isWin) {
    // Static CRT so the .exe doesn't need vcruntime DLLs on the user's PC.
    flags += " -DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded -DCMAKE_POLICY_DEFAULT_CMP0091=NEW";
    // NATIVE=ON tunes for the GitHub runner CPU (AVX-512 etc.) — target the
    // portable AVX2 baseline so every user machine gets the same fast path.
    flags += " -DGGML_NATIVE=OFF -DGGML_AVX=ON -DGGML_AVX2=ON -DGGML_FMA=ON -DGGML_F16C=ON";
    if (vulkan) flags += " -DGGML_VULKAN=ON";
  }

  log("configuring " + exeName + "…");
  run(`cmake -B build ${flags}`, { cwd: work });
  log("building " + exeName + "…");
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
  log(exeName + " →", dst);
}

// ── 2) ffmpeg (LGPL — see THIRD-PARTY-NOTICES.md) ───────────────────────────
//
// This used to copy the binary out of the `ffmpeg-static` npm package. On macOS
// that is an evermeet.cx build configured with:
//     --enable-gpl --enable-version3 --enable-nonfree
// and a binary built with --enable-nonfree may not be redistributed AT ALL.
// Shipping it inside a paid product was a licensing breach.
//
// macOS/Linux: build plain LGPL ffmpeg from source.
// Windows:     BtbN publishes LGPL builds, which are redistributable as-is.
//              Cross-compiling on a Windows runner would need MSYS2 and buys
//              us nothing over a build whose licence is already what we want.
const BTBN_LGPL_WIN =
  "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-lgpl.zip";

/* Never ship an ffmpeg whose own banner says it is GPL or non-free. This gate
 * is the whole reason the build script exists — keep it on every path. */
function assertRedistributable(binPath) {
  const banner = execSync(`"${binPath}" -version`, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  for (const bad of ["--enable-gpl", "--enable-nonfree", "--enable-version3",
                     "--enable-libx264", "--enable-libx265"]) {
    if (banner.includes(bad)) {
      throw new Error(
        `REFUSING TO SHIP: ${path.basename(binPath)} reports ${bad}.\n` +
        `See THIRD-PARTY-NOTICES.md — the bundled ffmpeg must be plain LGPL.`);
    }
  }
  log("ffmpeg licence gate passed (no GPL/non-free components)");
}

async function prepareFfmpeg() {
  const dst = path.join(OUT, "ffmpeg" + EXE);

  if (fs.existsSync(dst) && !process.env.FORCE) {
    log("ffmpeg exists, verifying licence…");
    assertRedistributable(dst);
    return;
  }

  if (isWin) {
    const zip = path.join(os.tmpdir(), "ffmpeg-lgpl-win64.zip");
    const work = path.join(os.tmpdir(), "ffmpeg-lgpl-win64");
    log("downloading LGPL ffmpeg for Windows…");
    run(`curl -fL "${BTBN_LGPL_WIN}" -o "${zip}"`);
    fs.rmSync(work, { recursive: true, force: true });
    fs.mkdirSync(work, { recursive: true });
    run(`tar -xf "${zip}" -C "${work}"`);          // bsdtar ships with Windows 10+
    const found = [];
    (function walk(dir) {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.toLowerCase() === "ffmpeg.exe") found.push(p);
      }
    })(work);
    if (!found.length) throw new Error("ffmpeg.exe not found inside " + zip);
    fs.copyFileSync(found[0], dst);
  } else {
    log("building LGPL ffmpeg from source (this takes a few minutes)…");
    run(`bash "${path.join(ROOT, "scripts", "build-ffmpeg-lgpl.sh")}" subs`);
  }

  if (!fs.existsSync(dst)) throw new Error("ffmpeg was not produced at " + dst);
  if (!isWin) fs.chmodSync(dst, 0o755);
  assertRedistributable(dst);
  log("ffmpeg →", dst);
}

(async () => {
  log("platform:", PLAT, "| out:", OUT);
  if (isWin) {
    buildWhisper(false); // CPU
    if (skipWinGpu) log("SKIP_WHISPER_GPU=1, skipping whisper-cli-gpu build");
    else buildWhisper(true);  // GPU (Vulkan)
  } else {
    buildWhisper(false);
  }
  await prepareFfmpeg();
  log("done ✓  bundled:", fs.readdirSync(OUT).join(", "));
})().catch(e => { console.error("[fetch-binaries] FAILED:", e.message); process.exit(1); });
