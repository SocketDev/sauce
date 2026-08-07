---
name: github-release
description: Cut, verify, and reconcile immutable GitHub releases with the
  socket-release kit - the registry-resolvability ORDER RULE, the
  three-step draft-upload-undraft cut, checksums.txt production, and tag-gap
  healing. Use when tagging a release, healing a missing tag/release, or
  when the github-release workflow gate refuses a tag.
---

# GitHub release (immutable, registry-gated)

ORDER RULE (non-negotiable): the immutable GitHub release is the FINAL
marker of a release. It can only follow a version that already resolves on
its registry - never precede one. `requireRegistryLive` enforces this in
every path; the `github-release.yml` workflow's `gate` job refuses a pushed
tag whose version is not live (`registry-liveness-gate.mjs`, zero-dep, runs
before any install).

## Normal path (automatic)

The npm/cargo promote tail cuts the tag + release itself: after
`node scripts/socket-release/npm-publish.mts --approve` promotes and the
version resolves live, the engine tags `v<version>`, pushes the tag, and
cuts the release. Nothing to run by hand when that succeeds.

## Cutting a release with assets

`github-release.mts --release` performs the fleet-canonical three-step immutable
cut - `gh release create --draft --verify-tag` → upload assets → `gh release
edit --draft=false` — and writes a `checksums.txt` manifest (sha1 + sha256 +
sha512) alongside the tarball, so the GitHub-release digest stays directly
comparable to the npm published shasum:

```
node scripts/socket-release/github-release.mts --tag vX.Y.Z --release
```

Never hand-run `gh release create` without `--draft`: the release goes
immutable the instant it publishes, so assets and checksums must be attached
while drafted.

## Healing a release gap

A RELEASE GAP is a version public on its registry with the `v<version>` tag
or GitHub release missing. Re-running `--approve` does NOT heal it (the
approve leg drops already-published versions before the tag step). The
healer is:

```
node scripts/socket-release/github-release.mts --tag vX.Y.Z             # dry-run: confirms liveness
node scripts/socket-release/github-release.mts --tag vX.Y.Z --release   # cuts tag + release
```

It refuses (exit 1) when the version is not live - an unreachable registry
is never read as unpublished. From CI, the operator dispatches the
`github release` workflow with `tag` + `release: true` from the Actions UI
(`gh workflow run` is guard-blocked for agents - the human clicks; there is
no agent lane for the dispatch itself).

## Verifying

- The tag exists on origin: `git ls-remote --tags origin refs/tags/vX.Y.Z`
- The release exists and is not a draft:
  `gh release view vX.Y.Z --json isDraft,assets`
- `checksums.txt` is attached when any binary assets are (the brew channel
  hard-requires it).
