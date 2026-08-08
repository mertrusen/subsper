# Code signing — what you have to buy and set

Until these secrets exist, every customer meets a scary dialog before they ever
see the product:

| Platform | What an unsigned build looks like to a buyer |
|---|---|
| macOS | *"Subsper is damaged and can't be opened. You should move it to the Trash."* — Gatekeeper's wording for un-notarized apps. Reads exactly like a virus warning. |
| Windows | SmartScreen: *"Windows protected your PC — unknown publisher"*, with **Run anyway** hidden behind *More info*. |
| Premiere `.zxp` | ZXP installers warn about an unverified publisher. Self-signed is acceptable for sideloading, but only if it is **timestamped** — `scripts/build-zxp.sh` now refuses to produce an untimestamped signature. |

CI builds unsigned when the secrets are absent, so forks and dry runs still
work. A **tagged release fails** rather than publishing something unsigned.

---

## macOS — Apple Developer ID

**Cost:** Apple Developer Program, 99 USD/year.

1. Enrol at <https://developer.apple.com/programs/>.
2. In the developer portal create a **Developer ID Application** certificate.
3. Export it from Keychain Access as `.p12` with a password.
4. Base64-encode it:

```bash
base64 -i DeveloperID.p12 | pbcopy
```

5. Create an app-specific password at <https://appleid.apple.com> →
   Sign-In and Security → App-Specific Passwords. This is **not** your Apple ID
   password.

Repository secrets:

| Secret | Value |
|---|---|
| `MAC_CSC_LINK` | the base64 blob from step 4 |
| `MAC_CSC_KEY_PASSWORD` | the `.p12` password |
| `APPLE_ID` | your Apple ID e-mail |
| `APPLE_APP_SPECIFIC_PASSWORD` | the app-specific password |
| `APPLE_TEAM_ID` | 10-character team ID, from the portal's Membership page |

The macOS job then runs `npm run dist:mac:signed`, which notarizes, and asserts
the result with `spctl --assess` before publishing.

---

## Windows — code signing certificate

**Cost:** roughly 200–600 USD/year depending on issuer and type.

Two routes, and the difference matters for CI:

**OV certificate.** Cheapest. Since June 2023 issuers must deliver these on a
hardware token or via a cloud HSM, so a plain `.p12` you can hand to CI is no
longer generally available. SmartScreen reputation still has to be earned over
time and downloads.

**Azure Trusted Signing.** ~10 USD/month, CI-native, no hardware token, and it
inherits Microsoft's reputation immediately. For a small publisher this is
usually the right answer. It needs `azure-code-signing` configuration in
electron-builder rather than `CSC_LINK`.

If you do end up with a `.p12`:

```bash
base64 -i codesign.p12 | pbcopy
```

| Secret | Value |
|---|---|
| `WIN_CSC_LINK` | base64 of the `.p12` |
| `WIN_CSC_KEY_PASSWORD` | its password |

---

## The Premiere extension `.zxp`

Self-signed, generated once by `scripts/build-zxp.sh` and cached in
`.zxp-tools/`. Two things are now enforced:

- **`-validityDays 3650`.** ZXPSignCmd's default validity is short, and an
  expired certificate makes the `.zxp` stop installing for *everyone* who
  downloads it afterwards.
- **Timestamping is mandatory.** The script tries DigiCert, then Sectigo, then
  Apple, and fails if all three are unreachable. It previously fell back to an
  untimestamped signature without saying so, which produced releases that
  looked fine and silently carried an expiry date.

`ALLOW_UNTIMESTAMPED=1` exists for local experiments. Never use it for a build
you hand to anyone.

Selling through Adobe Exchange instead would give a properly trusted signature
and one-click install, at the cost of Adobe's review process and revenue share.

---

## Checklist before the first paid release

- [ ] `MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD` set
- [ ] `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` set
- [ ] Windows signing chosen (Azure Trusted Signing or OV) and configured
- [ ] A tag build completes with the `spctl --assess` step green
- [ ] The `.dmg` opens on a Mac that has never seen the app, with no warning
- [ ] The `.exe` runs on a clean Windows VM without a SmartScreen block
