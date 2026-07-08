/* electron-builder afterPack hook — ad-hoc codesign the mac app.
 *
 * With identity:null electron-builder ships a completely UNSIGNED app; recent
 * macOS Gatekeeper flags that as "damaged, move to Trash" instead of the old
 * "unidentified developer" prompt. An ad-hoc signature (codesign -s -) restores
 * a valid signature structure, so users get the normal right-click→Open /
 * xattr flow instead of the scary damaged error. No Apple account needed.
 */
const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;
  const appName = context.packager.appInfo.productFilename + ".app";
  const appPath = path.join(context.appOutDir, appName);
  if (!fs.existsSync(appPath)) { console.warn("afterPack: app not found:", appPath); return; }
  console.log("  • ad-hoc codesign:", appPath);
  // --deep is deprecated but fine for ad-hoc: signs all nested binaries
  // (whisper-cli, ffmpeg in Resources/bin) in one pass.
  execSync(`codesign --force --deep --sign - "${appPath}"`, { stdio: "inherit" });
  execSync(`codesign --verify --deep --strict "${appPath}"`, { stdio: "inherit" });
  console.log("  • ad-hoc signature verified");
};
