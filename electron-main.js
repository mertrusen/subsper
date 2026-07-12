/* electron-main.js — Whisper Studio Desktop main process.
   Works on Windows and macOS. Creates the window and serves native file dialogs. */

const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const path = require("path");

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 460,
    height: 880,
    minWidth: 380,
    minHeight: 600,
    backgroundColor: "#0e1014",
    title: "Subsper",
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,   // local desktop tool — renderer needs Node + spawn
      spellcheck: false,
    },
  });

  win.loadFile(path.join(__dirname, "index.html"));

  // Content Security Policy — prevents XSS by blocking external scripts
  win.webContents.session.webRequest.onHeadersReceived((details, cb) => {
    cb({ responseHeaders: {
      ...details.responseHeaders,
      "Content-Security-Policy": ["default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: file:; media-src 'self' file: blob:; connect-src 'self' https: http://localhost:* http://127.0.0.1:*"]
    }});
  });
  win.setMenuBarVisibility(false);
  // win.webContents.openDevTools();
}

// App directory (where scripts/ lives) — requested synchronously by the shim.
// In a packaged build the Python scripts live in resources/scripts (extraResources),
// because spawn() can't execute files from inside the asar archive.
ipcMain.on("get-app-dir", (e) => {
  e.returnValue = app.isPackaged ? process.resourcesPath : __dirname;
});

// Open a media file
ipcMain.handle("dialog:openMedia", async () => {
  const res = await dialog.showOpenDialog(win, {
    title: "Open video or audio",
    properties: ["openFile"],
    filters: [
      { name: "Media", extensions: ["mp4","mov","m4v","mkv","webm","avi","wmv","mp3","wav","m4a","aac","flac","ogg"] },
      { name: "All files", extensions: ["*"] },
    ],
  });
  if (res.canceled || !res.filePaths.length) return { filePath: null };
  return { filePath: res.filePaths[0] };
});

// Open MULTIPLE media files (batch transcribe)
ipcMain.handle("dialog:openMediaMulti", async () => {
  const res = await dialog.showOpenDialog(win, {
    title: "Pick files to batch-transcribe",
    properties: ["openFile", "multiSelections"],
    filters: [
      { name: "Media", extensions: ["mp4","mov","m4v","mkv","webm","avi","wmv","mp3","wav","m4a","aac","flac","ogg"] },
      { name: "All files", extensions: ["*"] },
    ],
  });
  if (res.canceled || !res.filePaths.length) return { filePaths: [] };
  return { filePaths: res.filePaths };
});

// Open a Subsper project file
ipcMain.handle("dialog:openProject", async () => {
  const res = await dialog.showOpenDialog(win, {
    title: "Open Subsper project",
    properties: ["openFile"],
    filters: [{ name: "Subsper project", extensions: ["subsper", "json"] }],
  });
  if (res.canceled || !res.filePaths.length) return { filePath: null };
  return { filePath: res.filePaths[0] };
});

// Pick a font file to add to the user font library
ipcMain.handle("dialog:openFont", async () => {
  const res = await dialog.showOpenDialog(win, {
    title: "Add font",
    properties: ["openFile"],
    filters: [{ name: "Fonts", extensions: ["ttf", "otf"] }],
  });
  if (res.canceled || !res.filePaths.length) return { filePath: null };
  return { filePath: res.filePaths[0] };
});

// Save a file (subtitles / enhanced audio / trimmed media)
ipcMain.handle("dialog:saveFile", async (_e, opts) => {
  opts = opts || {};
  const res = await dialog.showSaveDialog(win, {
    title: "Save",
    defaultPath: opts.defaultName || "output",
    filters: opts.ext
      ? [{ name: opts.ext.toUpperCase(), extensions: [opts.ext] }, { name: "All files", extensions: ["*"] }]
      : [{ name: "All files", extensions: ["*"] }],
  });
  if (res.canceled || !res.filePath) return { filePath: null };
  return { filePath: res.filePath };
});

// Reveal a file in Finder/Explorer
ipcMain.handle("shell:showItem", (_e, p) => { try { shell.showItemInFolder(p); } catch (e) { console.error("showItem error:", e); } return true; });

app.whenReady().then(() => {
  createWindow();
  // Auto-update: Windows NSIS works unsigned. macOS needs a code-signed app —
  // we still ATTEMPT it (works the day the app gets signed, harmless before:
  // electron-updater just errors "code signature" and the in-app banner covers it).
  if (app.isPackaged) {
    try {
      const { autoUpdater } = require("electron-updater");
      autoUpdater.autoDownload = true;
      autoUpdater.on("error", (e) => console.warn("autoUpdater:", e && e.message));
      autoUpdater.checkForUpdatesAndNotify().catch(() => {});
    } catch (e) { console.warn("electron-updater unavailable:", e.message); }
  }
});

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
