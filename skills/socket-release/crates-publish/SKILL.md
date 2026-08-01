---
name: crates-publish
description: Operate the socket-release crates.io flow — the cargo staged model
  (dry-run default), trusted publishing via OIDC under the cargo-publish
  environment, index-propagation waits, and yank-as-rollback. Use when
  publishing a Rust crate in a repo carrying scripts/socket-release/.
---

# crates.io publish (staged model)

crates.io publishes are PERMANENT (yank-only, no unpublish), so the kit's
cargo flow is dry-run by default everywhere and the real publish runs only
under the `cargo-publish` GitHub environment through crates.io Trusted
Publishing (OIDC — no long-lived token anywhere).

## Bootstrap

The same bootstrap stands up the `cargo-publish` environment
(branch-restricted) and installs `cargo-publish.yml`:

```
node scripts/socket-release/bootstrap.mts github-env staged-config --apply
```

crates.io's trusted-publisher config (crate ↔ repo ↔ workflow ↔
environment) is set on crates.io's settings page by the crate owner — a
human step; render it as a gate with the crate's settings URL, do not
improvise a browser drive.

## Release cycle

1. Bump: `Cargo.toml` version + CHANGELOG, commit
   `chore: bump version to <version>`, push.
2. Dry-run locally:

   ```
   node scripts/socket-release/cargo-publish.mts --staged --dry-run
   ```

3. Publish from CI: the operator dispatches the `cargo publish` workflow
   from the Actions UI with `publish: true` (`gh workflow run` is
   guard-blocked for agents — the human clicks). The workflow runs
   `--direct` under the `cargo-publish` environment with the OIDC-minted
   token; a dry-run dispatch runs `--staged --dry-run` ungated.
4. Index propagation: the publish is not "done" until the version appears
   in the crates.io index — the engine's registry gate polls
   `https://index.crates.io/<path>` and the tag/release cut waits for it
   (ORDER RULE: the GitHub release follows index resolvability, never
   precedes it). Do not retry a publish that is merely propagating.
5. The tag + immutable release cut follows automatically; a gap heals with
   `node scripts/socket-release/github-release.mts --tag vX.Y.Z --release`.

## Local emergencies

`node scripts/socket-release/cargo-publish.mts --direct` publishes from the
operator's machine with their own `cargo login` token — 2FA/auth is theirs
to provide (gate, never scripted). `--approve` promotes a staged cargo
entry where the staged lane is available; `--package <name>` disambiguates
a workspace (multi-crate ordering is deferred — the tool refuses ambiguity
rather than guessing).

## Rollback = yank

```
cargo yank --version X.Y.Z            # from the crate root, operator auth
cargo yank --version X.Y.Z --undo
```

Yank never deletes bytes — existing lockfiles keep resolving; new
resolutions skip the version. Ship the fixed version immediately after, and
deprecate nothing (crates.io has no deprecate).
