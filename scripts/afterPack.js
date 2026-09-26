/* electron-builder afterPack hook — ad-hoc sign local unsigned Mac builds.
 * This does not replace Developer ID signing and notarization for distribution.
 */
const { execFileSync } = require("child_process");
const path = require("path");
const fs = require("fs");

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;
  // Let electron-builder apply the real Developer ID signature for signed builds.
  if (process.env.CSC_LINK) return;
  const appName = context.packager.appInfo.productFilename + ".app";
  const appPath = path.join(context.appOutDir, appName);
  if (!fs.existsSync(appPath)) { console.warn("afterPack: app not found:", appPath); return; }
  console.log("  • ad-hoc codesign:", appPath);
  // --deep is deprecated but fine for ad-hoc: signs all nested binaries
  // (whisper-cli, ffmpeg in Resources/bin) in one pass.
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", appPath], { stdio: "inherit" });
  execFileSync("codesign", ["--verify", "--deep", "--strict", appPath], { stdio: "inherit" });
  console.log("  • ad-hoc signature verified");
};
