# Releasing Subsper

## macOS — signing & notarization (required before selling)

macOS 26 (Tahoe) blocks ad-hoc-signed binaries. Without a Developer ID the
installer shows **"Malware Blocked"** and the bundled engine is SIGKILLed the
moment it spawns, so every Mac buyer would hit a dead end. The build config is
already notarization-ready; only the credentials are missing.

1. Apple Developer Program membership ($99/yr) → create a **Developer ID
   Application** certificate and install it in the login keychain.
2. Create an app-specific password at appleid.apple.com (Sign-In & Security →
   App-Specific Passwords).
3. Export the credentials, then build:

```bash
export APPLE_ID="you@example.com"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export APPLE_TEAM_ID="XXXXXXXXXX"
npm run dist:mac:signed
```

`dist:mac:signed` signs the app **and** the bundled `whisper-cli`/`ffmpeg`
(listed under `build.mac.binaries`), applies `build/entitlements.mac.plist`
(JIT + library-validation off, needed because Subsper spawns its own engine),
enables the hardened runtime and submits the DMG for notarization.

Verify before shipping:

```bash
spctl -a -vv "dist/mac-arm64/Subsper.app"
```

`accepted` + `source=Notarized Developer ID` means buyers get no warning.
`npm run dist:mac` stays unsigned — dev builds only, never ship it.

## Windows

`npm run dist:win` is unsigned. Buyers see SmartScreen until an EV or OV
code-signing certificate is wired in (`CSC_LINK` + `CSC_KEY_PASSWORD`).

## Premiere extension

The extension has no bundled engine: it reuses the installed desktop app's
binaries (`/Applications/Subsper.app/Contents/Resources/bin/...`). If the
desktop app is not installed it falls back to Homebrew's `whisper-cli`, which
is ad-hoc signed and therefore blocked — one more reason the signed desktop
build has to ship first.

## Local development on macOS

`~/Documents` is iCloud-synced here, and iCloud strips `.app` bundle internals,
which breaks `node_modules/electron`. Use `npm run dev:mac` (`dev/run.sh`) — it
stages a working Electron outside iCloud and launches the repo with it.

## Checklist

- [ ] `APP_VERSION` in `js/main.js` matches `package.json` version
- [ ] `node dev/v2-harness.js` all green
- [ ] `npm run prep` re-run so the engine is current
- [ ] no competitor product names anywhere in shipped code, strings or docs
      (`node dev/name-sweep.js`)
- [ ] mac build notarized (`spctl` accepted), Windows build signed
- [ ] tag + push → CI publishes the release
