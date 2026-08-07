---
name: npm-publish
description:
  Operate the socket-release npm flow end to end - bootstrap a package
  (name reservation, permissive-then-staged-only publishing access, trusted
  publishing), dispatch a staged publish, promote with --approve,
  backfill an old version, and roll back with deprecate. Use when
  publishing an npm package in a repo carrying scripts/socket-release/.
---

# npm publish (staged)

The kit's npm model: CI STAGES the publish through trusted publishing
(OIDC, environment `npm-publish`); a human PROMOTES it locally after
byte-verification. Direct publishing is disabled after bootstrap - staged
is the only path. Dry-run is every command's default.

## One-time bootstrap

```
node scripts/socket-release/bootstrap.mts            # plan
node scripts/socket-release/bootstrap.mts --apply    # stand up, stops at gates
node scripts/socket-release/bootstrap.mts --status   # receipts
```

Steps run in canonical order: preflight → placeholder →
npm-access-permissive → github-env → staged-config → trusted-publisher →
npm-access-staged-only → verify. Two of them are npm publishing-access
steps: PERMISSIVE first (direct + staged enabled, only while the 0.0.0
placeholder is pending, so the one-time direct publish can land), then
STAGED-ONLY (direct publishing unchecked in the npm web UI once trusted
publishing stands). A re-run never re-widens; `verify` FAILS a package left
permissive and names the fix
(`node scripts/socket-release/bootstrap.mts npm-access-staged-only --apply`).

STOP AND GATE, never improvise, at these moments:

- **reserve name** - publishing `<name>@0.0.0` is irreversible; only
  `node scripts/socket-release/bootstrap.mts placeholder --apply --reserve <name>`
  performs it: the bootstrap renders the gate.
- **npm web-2FA** - the PTY prints `APPROVE HERE (expires in minutes): <url>`;
  the operator approves in their browser, the command keeps waiting.
- **placeholder promote** - a staged 0.0.0 needs
  `node scripts/socket-release/npm-publish.mts --approve` plus the
  operator's 2FA.
- **npm auth dead** - `node scripts/socket-release/npm-web-auth.mts login`
  (both lanes run the same router command).

## Release cycle

1. Bump: edit `version` + CHANGELOG, commit
   `chore: bump version to <version>` (load-bearing subject), push.
2. Stage from CI: the operator dispatches the `npm publish` workflow from
   the Actions UI with `publish: true` (dry-run is the dispatch default;
   `gh workflow run` is guard-blocked for agents - the human clicks).
3. Soak: staged entries are maintainer-visible only. Inspect with
   `pnpm stage list --json` - an unauthenticated or wrong-account list
   reads as EMPTY, not as an error, so identity-check first
   (`node scripts/socket-release/npm-web-auth.mts login`).
4. Promote: `node scripts/socket-release/npm-publish.mts --approve` - it
   byte-verifies the staged tarball, promotes through the operator's 2FA,
   then cuts the git tag + immutable GitHub release once the version
   resolves live (ORDER RULE - registry first, release marker last).
5. Verify: the version resolves on the registry and the release exists; a
   missing tag/release heals with
   `node scripts/socket-release/github-release.mts --tag v<version> --release`.

## Backfill

An already-tagged version that never published: a backfill never moves the
`latest` pointer, so it always needs an explicit non-`latest` dist-tag.
Dispatch the workflow with `backfill-version: X.Y.Z` + `checkout-ref: vX.Y.Z`
\+ `dist-tag: backfill` (any non-`latest` tag), or locally

```
node scripts/socket-release/npm-publish.mts --staged --backfill X.Y.Z --checkout-ref vX.Y.Z --tag backfill --dry-run
```

Drop `--dry-run` only after the plan reads clean; promotion is the same
`--approve` path.

## Rollback

npm publishes are permanent (unpublish closes at 72h and burns nothing
back). Roll back by deprecating the bad version and shipping a fixed one:

```
npm deprecate <name>@<bad-version> "broken — use <fixed-version>"
```

Deprecation needs the operator's npm auth (2FA) - gate, do not improvise.
A never-promoted staged entry needs no rollback: reject it with
`node scripts/socket-release/npm-web-auth.mts stage reject <stage-id>` and
re-stage.
