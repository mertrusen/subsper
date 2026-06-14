/* desktop-shim.js — loaded BEFORE main.js.
   Provides the minimal CEP surface (CSInterface, SystemPath) that main.js expects
   so it can load unchanged inside Electron. The real desktop behaviour (file I/O,
   media playback, exports) is wired up in desktop-app.js AFTER main.js loads. */

window.IS_DESKTOP = true;

// Electron exposes Node's require on window when nodeIntegration is on.
const { ipcRenderer } = require("electron");

// App directory (where scripts/ lives). Resolved synchronously from the main process.
window.__APP_DIR__ = ipcRenderer.sendSync("get-app-dir");

// ── Fake SystemPath enum ───────────────────────────────────────────────────
window.SystemPath = { EXTENSION: "extension", USER_DATA: "userData" };

// ── Fake CSInterface ───────────────────────────────────────────────────────
// Only the members main.js touches are implemented. evalScript() is a no-op that
// returns "" — every real ExtendScript call is overridden in desktop-app.js.
window.CSInterface = function () {};
window.CSInterface.prototype.getSystemPath = function () { return window.__APP_DIR__; };
window.CSInterface.prototype.evalScript = function (script, cb) {
    if (typeof cb === "function") cb("");
};
window.CSInterface.prototype.addEventListener = function () {};
window.CSInterface.prototype.removeEventListener = function () {};
window.CSInterface.prototype.requestOpenExtension = function () {};
