# npm-lib example

A minimal scoped npm library the release kit stands up on the `npm` +
`github-release` channels. `socket-release.json` is the config the installer
would seed (restricted access - private-repo default); `expected-install.json`
pins the exact file set the installer copies for these channels, and the
integration suite re-derives it on every run so the mapping cannot drift.

Try it against a scratch copy:

```
cp -R release-kit/examples/npm-lib /tmp/npm-lib
node release-kit/install.mts --target /tmp/npm-lib --channels npm,github-release --apply
node release-kit/install.mts --target /tmp/npm-lib --channels npm,github-release --verify
```
