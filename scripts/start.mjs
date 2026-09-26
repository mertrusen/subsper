#!/usr/bin/env node
// Local launcher. Never bypass a macOS security decision to run a dev binary.
import { createRequire } from "node:module";
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";

const require = createRequire(import.meta.url);
let executable;
try { executable = require("electron"); }
catch (e) {
  console.error("Electron is missing or incomplete. Reinstall dependencies from a trusted source.");
  process.exit(1);
}

if (process.platform === "darwin") {
  const bundle = path.resolve(executable, "../../../");
  const verify = spawnSync("codesign", ["--verify", "--deep", "--strict", bundle], { stdio: "ignore" });
  const assess = verify.status === 0
    ? spawnSync("spctl", ["--assess", "--type", "execute", bundle], { stdio: "ignore" })
    : null;
  if (verify.status !== 0 || !assess || assess.status !== 0) {
    console.error("macOS did not accept the Electron app. It will not be launched. Use a signed, notarized build for validation.");
    process.exit(1);
  }
}

const child = spawn(executable, [".", ...process.argv.slice(2)], { stdio: "inherit" });
child.on("error", e => { console.error(e.message); process.exitCode = 1; });
child.on("exit", (code, signal) => {
  process.exitCode = signal ? 1 : (code ?? 1);
});
