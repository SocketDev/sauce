---
name: brew-tap
description: Operate the socket-release Homebrew tap flow — the binary-download
  formula model, tap repo layout, formula bumps tied to published releases,
  and sha256 verification against the release's own checksums.txt. Use when
  bumping a Homebrew formula or standing up a tap for a Socket CLI.
---

# Homebrew tap (binary-download formula)

Model: no bottles, no source build — the formula downloads the release's
prebuilt per-platform tarballs by EXACT
`releases/download/v<version>/<asset>` URL (never `latest`) and pins the
sha256 the release's own `checksums.txt` vouched for. brew-publish NEVER
hashes an asset itself; the manifest is the authority.

## Tap layout (one-time, manual)

The tap repo (`SocketDev/homebrew-socket`) carries an unsharded `Formula/`
dir plus a README documenting tap trust:

```
export HOMEBREW_REQUIRE_TAP_TRUST=1
brew trust SocketDev/socket
```

The exact layout is modeled by `release-kit/examples/brew-cli/tap-fixture/`
in sauce. Creating the tap repo is a human act (repo creation rights) —
note it plainly; there is no script.

## Bump cycle

Prerequisite: the release is CUT — tag on origin, release published (not
draft), all four platform assets uploaded, `checksums.txt` attached (the
gh-release flow produces all of this).

```
node scripts/socket-release/brew-publish.mts --tag vX.Y.Z            # dry-run plan
node scripts/socket-release/brew-publish.mts --tag vX.Y.Z --apply    # commit the bump
```

The tool refuses, in order, with exit 1 and zero writes: a tag not on
origin (it never creates tags), a draft/missing release, a missing
templated asset, a missing/incomplete `checksums.txt`. An identical formula
is a no-op ("already reads <version>", exit 0). `--apply` commits the
formula DIRECT to the tap default branch with a GitHub-signed API commit
(never a PR — the version-bump-PR shape is guard-blocked), then re-reads
the tap: the committed bytes must parse back to the desired formula, or it
exits 1 saved-state-unproven.

From CI, `brew-publish.yml` runs on `release: published` (or manual
dispatch with `tag` + `publish: true`) and mints a per-run App token via
the `./.github/actions/socket-release-app-token` composite from the
org-wide App credentials — org secrets are enterprise-wide; never treat
them as missing setup or a human task.

## sha256 verification

The formula's four sha256s come from `checksums.txt` — verify the chain,
never re-hash locally as authority:

```
gh release download vX.Y.Z --pattern checksums.txt --output -
```

Both grammars count: plain `<hex>  <name>` (shasum) and
`sha256: <hex>  <name>` (the kit release tail). A duplicate filename with
differing hex is a hard refusal. After a bump, spot-check one platform:
the `url` in `Formula/<name>.rb` must name the exact `v<version>` download
path and its `sha256` must equal the manifest line for that asset.

## Auth moments (gate, never improvise)

- Local `--apply` uses ambient `gh` auth: if `gh auth status` fails, the
  operator runs `gh auth login` (browser) — render the gate.
- Manual audits run on an operator Mac: `brew style` / `brew audit` against
  the tap (deferred from CI).
