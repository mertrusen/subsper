# Subsper versioning

The repository uses one [semantic version](https://semver.org/) for Desktop and
the Premiere extension. `package.json` is the canonical value. Before shipping
or installing an update, run `npm run version:set -- patch`, `minor`, `major`, or
an explicit version such as `1.5.0`. Use patch for fixes, minor for compatible
features, and major for incompatible changes. A release tag must equal `v` plus
the exact package version.

The command updates `package.json`, `package-lock.json`, the UI version in
`js/main.js`, and both version fields in the Premiere CEP manifest. Then run
`bash scripts/sync-to-extension.sh`. On this Mac,
`bash scripts/install-cep-local.sh` installs the source into the local Premiere
CEP folder without deleting its engine binaries. Restart Premiere afterward.
The local install is not a GitHub release or a packaged `.zxp`.

`node dev/test/version-consistency.test.js` checks that the files agree; the
release workflow also rejects a tag whose name does not match the version.
