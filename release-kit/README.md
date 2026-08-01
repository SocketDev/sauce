# socket-release-kit

A copy-in release kit for SocketDev repos: staged npm publishing with
trusted publishing (OIDC), crates.io trusted publishing, registry-gated
immutable GitHub releases, and Homebrew tap formula bumps — installed
byte-exact from `release-kit/payload/scripts/socket-release/` into a
consumer's `scripts/socket-release/`, verified by `kit-manifest.json`.

The primary users are an operator AND their AI: one entry-point command per
flow, idempotent, resumable, dry-run by default where destructive, `--json`
machine output, precise exit codes, every step independently re-runnable,
and every human moment rendered as a fleet human gate — never an improvised
prompt.

## Channels

| channel            | installs                                                                                              | workflow             |
| ------------------ | ----------------------------------------------------------------------------------------------------- | -------------------- |
| `npm`              | staged publish engine (`npm-publish.mts`, `publish-infra/npm/**`, web-auth router)                    | `npm-publish.yml`    |
| `crates`           | cargo staged engine (`cargo-publish.mts`, `publish-infra/cargo/**`)                                   | `cargo-publish.yml`  |
| `github-release`   | liveness-gated release cut (`create-release.mts`, `github-release.mts`, `registry-liveness-gate.mjs`) | `github-release.yml` |
| `brew`             | tap formula bump (`brew-publish.mts`, `publish-infra/brew/**`, app-token composite)                   | `brew-publish.yml`   |
| `common` (implied) | the bootstrap, shared libs, config templates                                                          | —                    |

## Install

```
node release-kit/install.mts --target <repo> --channels npm,github-release          # plan
node release-kit/install.mts --target <repo> --channels npm,github-release --apply  # copy
node release-kit/install.mts --target <repo> --channels npm,github-release --verify # byte-parity
```

Consumers pin three devDependencies (the payload imports plain specifiers):

```
pnpm add -D @socketsecurity/lib@6.5.2 @socketsecurity/sdk@4.1.3 playwright-core@1.61.1
```

Runtime floor for the kit CLIs: Node >= 22.18 (native `.mts`). Consumers
must exclude `scripts/socket-release/**` from their own formatters/linters —
the installer's `--verify` pins byte-parity with the payload, and a consumer
formatter that rewrites the copies breaks it permanently (R11: sauce's
formatter is the ONE formatter these bytes ever see; `kit-manifest.json`
pins the post-format bytes).

## Bootstrap

```
node scripts/socket-release/bootstrap.mts            # plan everything (dry-run default)
node scripts/socket-release/bootstrap.mts --apply    # stand it up
node scripts/socket-release/bootstrap.mts --status   # receipts table
```

Eight steps in canonical order — `staged-config` runs BEFORE
`trusted-publisher` (trust is configured only for a workflow that actually
exists), and the two publishing-access steps bracket the placeholder:

1. `preflight` — ten read-only checks (node floor, GitHub origin, gh auth,
   pnpm stage support, npm trust support, kit deps, registry reachability,
   access level).
2. `placeholder` — the ONE irreversible act: publish `<name>@0.0.0` to claim
   the name. Hard opt-in: `--apply` alone blocks on the reserve-name gate;
   only `--apply --reserve <exact-package-name>` publishes. Immediately
   after the publish creates the package, publishing access is ensured
   PERMISSIVE (direct + staged both enabled) so the one-time direct publish
   can land.
3. `npm-access-permissive` — idempotent report/repair of that permissive
   window. NEVER re-widens: once the name is live the step is already-done
   by definition.
4. `github-env` — deployment environments (one per channel), each restricted
   to exactly the default branch via custom branch policies. API before
   browser: `gh api` PUT/list-before-POST first; a 403 renders the
   github-environment gate (the browser path is gate TEXT only — no tool
   drives github.com).
5. `staged-config` — the channel workflows (byte-identical to the local
   templates), the four release scripts + `publishConfig.access` in
   package.json (surgical edit), and the gitignore block. File writes only;
   the operator commits.
6. `trusted-publisher` — `npm trust` through the PTY web-2FA router to the
   law: github · `npm-publish.yml` · environment `npm-publish` ·
   createPackage + createStagedPackage. Reads fail CLOSED: any error
   envelope is auth-death, never "(no config)".
7. `npm-access-staged-only` — TIGHTEN AFTER: with the placeholder live and
   trusted publishing standing, disable DIRECT publishing in the npm web UI
   (the sanctioned browser session drives the checkbox), leaving
   staged/trusted publishing only. A second bootstrap run cannot re-enable
   direct publishing: the permissive shape is planned only while the
   placeholder is pending, and this step's done-predicate is the staged-only
   read itself.
8. `verify` — read-only end-to-end proof of the terminal state: name live,
   trust conforming, environments restricted, workflows on origin,
   staged-config parity, and publishing access STAGED-ONLY (a package left
   permissive FAILS with the exact remediation command).

Exit codes: `0` passed/planned · `1` failed · `2` usage · `3` blocked on a
human gate · `4` precondition not done. The state file
(`.cache/socket-release/bootstrap-state.json`) is a reporting cache, never
authority — every step re-detects live state, and `--reset` loses only
history.

## First publish (npm), end to end

1. `node release-kit/install.mts --target <repo> --channels npm,github-release --apply`,
   add the three dev-dependency pins, commit.
2. `node scripts/socket-release/bootstrap.mts` — read the plan.
3. `node scripts/socket-release/bootstrap.mts --apply` — it stops at the
   reserve gate:

```
🖐  HUMAN GATE — reserve name [1/1]
  Need: @example/pkg is unclaimed on npm; reserving it publishes a real 0.0.0 placeholder (access restricted).
  Mind: publishing @example/pkg@0.0.0 is irreversible — the version is burned forever and unpublish closes after 72h — so no default run performs it; --reserve must name the exact package.
  A) You: run `node scripts/socket-release/bootstrap.mts placeholder --apply --reserve @example/pkg` yourself.
  B) Me: say "reserve the name" and I run `node scripts/socket-release/bootstrap.mts placeholder --apply --reserve @example/pkg` through its PTY — npm's web-2FA opens in your browser, I wait.
  Then: the bootstrap resumes at placeholder.
```

4. During the publish the PTY surfaces npm's web-2FA:

```
🖐  HUMAN GATE — web-auth approve [1/1]
  Need: the placeholder publish is waiting on npm's web-2FA approval in your browser.
  Mind: npm's web-2FA URLs are single-use and short-lived; the waiting command must stay alive through the approval — killing it voids the URL.
  A) You: open the APPROVE HERE url printed above in your browser and approve (expires in minutes) — tick the cooldown box so follow-up writes ride the same window.
  B) Me: nothing extra to run — the PTY already holds the flow; tell me when the browser approval is done and I keep waiting for the exit.
  Then: the publish completes and the bootstrap continues.
```

5. On a staging-enabled account the placeholder lands STAGED and the run
   blocks on the promote gate:

```
🖐  HUMAN GATE — placeholder promote [1/1]
  Need: @example/pkg@0.0.0 is staged (stage-0001) and waiting on promotion before the name resolves as live.
  Mind: staged entries are maintainer-visible only — an unauthenticated or wrong-account stage list reads as EMPTY, not as an error; the approve pipeline identity-checks first.
  A) You: run `node scripts/socket-release/npm-publish.mts --approve` — it promotes staged entry stage-0001 and prompts your 2FA.
  B) Me: say "promote the placeholder" and I run `node scripts/socket-release/npm-publish.mts --approve` through its PTY — the 2FA challenge opens in your browser, I wait.
  Then: the bootstrap resumes at placeholder.
```

6. Re-run `bootstrap.mts --apply` until `verify` reports stood-up. Commit
   the staged-config writes and push.
7. First REAL release: bump version + CHANGELOG, commit
   `chore: bump version to <version>` (load-bearing subject — reconcile
   greps it), push, dispatch `npm-publish` from the Actions UI
   (`publish: true`), then promote locally:
   `node scripts/socket-release/npm-publish.mts --approve`. The tag +
   immutable GitHub release follow automatically once the version is live
   (ORDER RULE: the release is the FINAL marker, never the first).

If npm auth ever dies mid-flow, the gate is always the same:

```
🖐  HUMAN GATE — npm auth [1/1]
  Need: the local npm token is missing or expired (`npm whoami` → 401).
  Mind: raw `npm login` dies without a TTY (legacy Username prompt EOFs) and bare `npm` fails in-repo (devEngines pins pnpm); the router carries both limitations so neither lane can hit them.
  A) You: run `cd <repo> && node scripts/socket-release/npm-web-auth.mts login` in your terminal — same flow, you drive.
  B) Me: say "log me in" and I run `cd <repo> && node scripts/socket-release/npm-web-auth.mts login` through its PTY — your browser opens for the OAuth + OTP, I wait.
  Then: the bootstrap resumes at the blocked step.
```

## First brew bump

Prerequisite (one-time, manual — deferral #6): the tap repo
`SocketDev/homebrew-socket` exists with an unsharded `Formula/` directory
and a README documenting `HOMEBREW_REQUIRE_TAP_TRUST=1` →
`brew trust SocketDev/socket`. The layout is modeled by
`examples/brew-cli/tap-fixture/`.

1. Cut the release first: registry publish → tag → GitHub release with
   assets + `checksums.txt` (cut releases with
   `scripts/socket-release/github-release.mts --tag vX.Y.Z --release`; the
   npm/cargo release tail writes sha1/sha256/sha512-base64 lines per asset).
   brew-publish refuses a
   missing tag, a draft release, a missing asset, and a missing
   checksums.txt — the four refusals are byte contracts.
2. `node scripts/socket-release/brew-publish.mts --tag vX.Y.Z` — dry-run
   plan (action, tap repo, path, version, four sha256s, the exact apply
   command).
3. `node scripts/socket-release/brew-publish.mts --tag vX.Y.Z --apply` —
   GitHub-signed API commit direct to the tap default branch (never a PR),
   then a re-read that must parse back to the desired formula. In CI the
   `brew-publish.yml` workflow runs the same command with a per-run App
   token minted by `./.github/actions/socket-release-app-token` from the
   org-wide App credentials (org secrets are enterprise-wide — never
   per-repo setup, never a human task).
4. Manual audit on an operator Mac (deferral #7): `brew style` /
   `brew audit` against the tap.

## Contract-drift posture (what detects an npm change)

Committed goldens pin PURE logic only; CI opens no network socket. Registry
or CLI wire drift is detected by, in order:

1. Every parser's mandatory unknown-shape-refuses arm: an unrecognized
   `npm trust list` shape, stage list, environments response, or
   publishing-access page classifies as a REFUSAL (`auth-died`, `unknown`,
   `garbled`) — never a default classification. Drift surfaces as a loud
   runtime refusal, never a wrong answer. Pinned by tests.
2. The bootstrap `verify` step is the designated LIVE contract test: it
   drives the real packument, real `npm trust list`, and real `gh api`
   through the REAL parsers. Run `bootstrap.mts verify` after any npm/pnpm
   CLI upgrade.
3. Fixture refresh: when a wire shape legitimately changes, update the
   synthetic fixtures under `test/repo/unit/release-kit/fixtures/` from the
   observed new shape and change the goldens in the SAME commit — each
   fixture carries a `_note`/header naming its authority and date.

Browser-page fixtures are synthetic, hand-authored from the documented wire
contract markers (`id="github-repoInfo"`, the `allowPublish` /
`allowStagePublish` and `allowDirectPublish` / `allowStagedPublish` checkbox
names, the escaped-JSON initial-data keys) — producing real captures needs a
signed-in session; refuse-don't-misclassify is the compensating control.

## Manual version bumps

CI auto-bump is deferred (#1). Bump by hand: edit `version`, update the
CHANGELOG, commit with the load-bearing subject
`chore: bump version to <version>` (reconcile.mts greps that exact shape),
push, then dispatch the publish workflow.

## Deferrals (explicit)

1. CI auto-bump (`--bump`/`--release-as`, bump/changelog/release-branch
   modules; `lib/release-anchor.mts` ships as a type shim only).
2. Pipeline receipts layer (`release-pipeline/**`, reconcile-gap healers) —
   resumability lives in the bootstrap.
3. Remote dispatch helpers — humans dispatch from the Actions UI
   (`gh workflow run` is guard-blocked for agents).
4. Multi-crate topological cargo ordering — single-crate only; ambiguity
   refusal retained.
5. npm trusted-publisher browser WRITE lane — dead (2026-07-31, 132/132);
   the read-side page modules ship, writes ride `npm trust` via the PTY
   router. The publishing-access toggles are the one sanctioned browser
   WRITE (owner directive), driven only through the sanctioned session.
6. Tap-repo scaffolder — creating `SocketDev/homebrew-socket` is a one-time
   manual act; the layout is documented + modeled by `examples/brew-cli`.
7. Tap-repo formula-audit CI — `brew style`/`brew audit` run manually per
   the first-brew procedure.
8. Windows PTY (no wrapping on win32 — inherited).
9. Kit self-distribution as a release tarball — consumers install from a
   sauce checkout.
10. `go` channel.
11. Operator fixture-capture script + scrubber + leak-hygiene test (needs a
    real signed-in session; synthetic fixtures instead).
12. Stub-bin PATH e2e harness — CLI boundary covered by spawn smokes +
    in-process integration with fully fake seams.
13. Coverage thresholds / mirror-name ratchets / actionlint in consumers —
    staged-config byte detection + verify cover template drift there;
    sauce's own fleet gates already run here.
14. Standalone runbook docs — folded into this README and the skills.

## Layout

```
release-kit/
├── README.md                 this file
├── gen-manifest.mts          (re)generate kit-manifest.json; --check
├── install.mts               the installer CLI
├── install/{manifest,plan,seams}.mts
├── examples/{npm-lib,rust-crate,brew-cli}/
└── payload/scripts/socket-release/   the copy-in engine (see kit-manifest.json)
```

Sauce-side gates: `scripts/repo/check/release-kit-is-coherent.mts`,
`release-kit-launches-are-sanctioned.mts`,
`release-kit-workflows-are-env-mapped.mts`,
`release-kit-types-resolve.mts` — auto-discovered by
`pnpm run check` (repo-owned checks run in the gate on every push). Tests
live under `test/repo/unit/release-kit/` and
`test/repo/integration/release-kit/`, all offline, importing straight from
the payload.

## Architecture — the npm thread, file by file

Every flow (npm, cargo, brew, github-release) runs the same shape:
`config → converge → stage → approve → mark → verify → heal`. **Knowing the
npm thread teaches the others** — the cargo tier mirrors it phase for phase,
and brew swaps the promotion phases for a `plan → apply` formula bump. Read
the npm release thread in this order (each line names the real payload file):

1. `templates/workflows/npm-publish.yml` — the CI invocation a consumer copies
   into `.github/workflows/`; dispatches the entry with `publish: true`.
2. `npm-publish.mts` — the flow entry (Layer 1): usage header, `OPTIONS`,
   unknown-flag rejection, mode dispatch (stage / approve / direct), and
   access + dist-tag resolution. It wires the tier below; it holds no
   registry logic of its own.
3. `_shared/cli-flags.mts` — the usage gate: any flag the entry did not
   declare exits 2 before a single registry read.
4. `publish-infra/npm/backfill.mts` — the pure gap-fill gate, consulted only
   under `--backfill`: which already-cut versions still need a tag/release.
5. `publish-infra/npm/staged.mts` — stage orchestration (`runStaged` /
   `runDirect` / `verifyStagedEntry`), which drives in turn
   `pack-preflight.mts` (hollow-tarball gate) → `pack-manifest.mts` +
   `_shared/{lifecycle-scripts,pack-files}.mts` (the pure pack surface) →
   `publish-infra/shared.mts` (the process seam: spawn / PTY / git / JSON) →
   `publish-infra/npm/registry.mts` (the registry read) →
   `lib/verify-release-hashes.mts` (byte-verify of the staged entry).
6. `publish-infra/npm/approve.mts` — promote orchestration (`runApprove`),
   which drives `login.mts` / `auth-identity.mts` (auth seams: logged-out vs
   wrong-user repair) → `shared.mts` (the stage-list wire parse, the kit's
   most safety-critical parser) → `scan.mts` / `threat-scan.mts` (Socket
   full-scan gate and local threat scan) → `lib/verify-release-hashes.mts`
   (the three-way hash gate before promote).
7. `publish-infra/release.mts` — the release tail: `releaseBehindLiveGate`
   (registry-live gate) → `ensureTagAndRelease` + `extractChangelogSection`,
   driving `lib/github-git-refs.mts` (the gh seam).
8. `publish-infra/reconcile.mts` — post-publish git alignment (fetch the
   published version, find its base sha, rebase/sync onto it).
9. Failure tail — the healer: `_shared/release-gap-recovery.mts` →
   `registry-liveness-gate.mjs` (the CI gate job, npm- AND crates-aware) →
   `github-release.mts` (cuts the immutable release once the registry is live).

The layers the thread crosses:

| Layer           | Home                                                                          | Holds                                                                                                                                   |
| --------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 0 kit tooling   | `release-kit/{install,gen-manifest}.mts`, `install/{manifest,plan,seams}.mts` | installer + manifest generator + pure copy planner behind `InstallSeams` (not shipped)                                                  |
| 1 flow entries  | payload root                                                                  | one CLI per flow; grandfathered residents `npm-web-auth.mts`, `registry-liveness-gate.mjs`(+`.d.mts`), `paths.mts`, `kit-manifest.json` |
| 2 orchestration | `bootstrap/`, `publish-infra/<flow>/`                                         | read → classify → plan → apply per step/phase                                                                                           |
| 3 pure logic    | `plan / parse / render / state / config / gates`                              | no `node:{fs,child_process,net,http}`                                                                                                   |
| 4 effect seams  | `seams.mts`, `shared.mts`, registry / browser / git / gh                      | injectable effects                                                                                                                      |
| 5 shared homes  | `_shared/` · `lib/` · `constants/` · `util/`                                  | fleet-mirrored · kit-local cross-flow · import-free data · frozen target tables                                                         |
| 6 templates     | `templates/`                                                                  | adoption docs (comments allowed)                                                                                                        |
| 7 tests         | `test/repo/**` (never in the payload)                                         | mirror the payload path                                                                                                                 |

The distinction between `_shared/` and `lib/` is provenance, not taste:
`_shared/` holds ONLY files whose relative path also exists under the fleet's
`scripts/fleet/_shared/` (fleet-mirrored); `lib/` holds kit-local cross-flow
logic. This is the fleet's own taxonomy — it is documented, never merged.

Known divergence pending removal: `create-release.mts` +
`lib/release-checksums/` is a dead second github-release entry (superseded by
`github-release.mts`); it is grandfathered in the root-entry allowlist below
until it is deleted fleet-side.

## The naming law

New payload files MUST conform. Rules 1 and 6 are enforced mechanically by
`scripts/repo/check/release-kit-is-coherent.mts` (which also pins manifest
freshness, the pure/effects import split, and the no-tests-in-payload rule);
the remainder is review law. A rename that touches a file whose relative path
exists under `scripts/fleet/` is done **fleet-first or not at all**.

1. **Entries.** The payload root holds exactly one CLI per flow, named
   `<flow>-<act>.mts`, act ∈ {`publish`, `release`}: `npm-publish`,
   `cargo-publish`, `brew-publish`, `github-release`. An entry contains only
   its usage header, `OPTIONS`, unknown-flag rejection (exit 2), mode
   dispatch, and the `isMainModule` guard. The only other permitted root
   residents are `bootstrap.mts` (the one-time bootstrap CLI) and the
   grandfathered `npm-web-auth.mts`, `registry-liveness-gate.mjs`(+`.d.mts`),
   `paths.mts`, `kit-manifest.json` (and, until deleted, `create-release.mts`).
   **Nothing else may be added at root.** _(machine-enforced)_
2. **Tiers.** A flow's implementation lives in `publish-infra/<flow>/` using
   phase names from the closed set `{registry, staged, approve, placeholder,
trusted-publisher}`; flow-specific nouns (brew `formula`/`tap`) appear in
   the layout table. A phase-named file contains only that phase.
3. **Pure vs effect.** PURE ⇔ imports no `node:{fs,child_process,net,http}`.
   Pure modules take the nouns `plan / parse / render / state / config /
gates`. Every injectable effect module is `seams.mts` exporting
   `<Area>Seams` + `resolve<Area>Seams`; browser lanes are the triple
   `<subject>-{plan,parse,page}` sharing `browser-session.mts`.
4. **Gate vocabulary.** A refusal point is a _gate_ — the only sanctioned
   word. `check` is reserved for CI checks; `law` may name a data constant
   (`trustedPublisherLaw`) but never a module; `preflight` is reserved to the
   bootstrap step id and `pack-preflight.mts`.
5. **Two-phase verbs.** Artifact-promotion flows speak `stage → approve`
   (npm, cargo — crates.io has no dist-tags and no unpublish, so its promote
   is a permanent one-way approve). Idempotent-convergence flows speak
   `plan → apply` (bootstrap, install, and brew — a formula bump tied to an
   already-published release). Never mix the two within a flow; `--dry-run`
   stays a flag name only.
6. **Suffixes.** `.mts` always; `.mjs` only when the script must run on system
   Node before any install (workflow gate jobs, composite-action scripts), and
   any `.mjs` imported from TypeScript carries a `.d.mts` sidecar.
   _(machine-enforced)_
7. **Shared homes (closed list).** `_shared/` = fleet-mirrored (same relative
   path under `scripts/fleet/_shared/`); `lib/` = kit-local cross-flow;
   `constants/` = import-free data; `util/` is frozen (no new files).
8. **Tests mirror paths.** `test/repo/unit/release-kit/<payload-relative-path>.test.mts`
   (consumers: `tests/socket-release/<payload-relative-path>.test.mts`).
   Cross-module scenario tests are `<flow>.flow.test.mts`. A new payload
   module lands with its mirror test in the same commit.
9. **Parity.** Every file in an adopted channel is byte-identical with the
   payload — `install.mts --verify` is the oracle.
10. **Renames.** Any payload rename regenerates `kit-manifest.json`, updates
    `channelsForPath` when an exact filename is pinned, and updates the
    coherence check + `shipped-surfaces.mts` + the `skills/socket-release/*`
    docs in the same commit.
