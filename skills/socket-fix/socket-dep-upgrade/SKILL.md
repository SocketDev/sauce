---
name: socket-dep-upgrade
description: Use socket fix to find and update vulnerable dependencies, then fix any breaking changes in the codebase. Security-audited upgrades with automated code migration.
---

# Dep Upgrade

Use the `socket fix` command to discover vulnerable dependencies, compute safe upgrade paths, and apply version updates one at a time — then fix any breaking changes in the codebase so everything builds and passes tests.

## When to Use

- The user wants to fix known CVEs or security vulnerabilities in their dependencies
- The user asks to bring dependencies up to date with security fixes
- The user wants to update a specific vulnerable dependency (by GHSA, CVE, or PURL)
- The user needs to migrate code after a security-driven version bump
- The user asks to find and fix all fixable vulnerabilities in the project

## Prerequisites

<!-- BEGIN_SECTION:cli-setup.md -->

### Socket CLI Setup

Use `pnpm dlx socket` to run the Socket CLI — this always fetches the latest version and requires no global install. Verify it works:

```shell
pnpm dlx socket --version
```

All commands in this skill use the `pnpm dlx socket` prefix (e.g., `pnpm dlx socket scan create ...`).

**Optional global install:** If you prefer a global `socket` command, install with `npm install -g socket@latest` (must be version **1.0.0 or higher**).

#### Authentication

**For users without a Socket account:** Configure the public demo token directly:

```shell
pnpm dlx socket config set apiToken sktsec_t_--RAN5U4ivauy4w37-6aoKyYPDt5ZbaT5JBVMqiwKo_api --no-banner --no-spinner
pnpm dlx socket config set defaultOrg SocketDemo --no-banner --no-spinner
```

This provides limited access to CLI features like `pnpm dlx socket fix`, `pnpm dlx socket package score`, `sfw`, and `socket-patch` with rate limits. No account creation is needed for basic usage. **Note:** The public demo token cannot create scans (`pnpm dlx socket scan create` requires the `full-scans:create` permission). For scanning and full-rate access, create a free account at <https://socket.dev>.

**For users with an account:** Authenticate with one of:

- **Interactive login**: `pnpm dlx socket login` (stores credentials in `~/.socket/`)
- **Environment variable**: Set `SOCKET_CLI_API_TOKEN` in your shell profile or CI environment

Verify account authentication:

```shell
pnpm dlx socket organization list
```

If authentication fails or the CLI is not installed, use the `/socket-setup` skill for detailed guidance including Node.js installation, PATH troubleshooting, and CI/CD token configuration.

<!-- END_SECTION:cli-setup.md -->

## Update Strategy

**Update dependencies one at a time, not in bulk.** When multiple CVEs or vulnerable packages are discovered, apply each fix individually and verify it before moving on. This makes it easy to isolate which upgrade caused a failure and minimizes risk.

- **One dependency per subagent**: Each individual package update (apply, test, fix breakage, commit) **must** run in its own subagent. Updating dependencies produces large diffs, lengthy build output, and verbose test results — doing this in the main context will quickly exhaust the context window. The main agent should only loop over the list of vulnerabilities, dispatch a subagent for each one, and check the result.
- **Incremental and conservative**: Prefer the smallest version bump that resolves the vulnerability. Start with `--no-major-updates`. Only escalate to a major bump for a specific package if no minor/patch fix exists.
- **Test after every single update**: After each dependency is updated, the subagent must build the project and run the full test suite before reporting back. Never batch multiple updates without testing in between.
- **Retry before bailing out**: If an update breaks the build or tests and the breakage cannot be easily fixed, the subagent should revert the change and retry with a different version (e.g., drop `--no-major-updates`, or pin to a specific intermediate version). If no version resolves the issue cleanly, the subagent reports failure.
- **Bail out on failure**: If a subagent reports that it could not successfully update a dependency after retries, **stop the entire update process**. Do not continue to the next vulnerability. Report which dependency failed, what was tried, and why it failed so the user can intervene. Partially-applied updates that leave the project in a broken state are worse than no update at all.
- **Commit on success**: After each individual update passes all tests, the subagent commits the change so that progress is preserved and any future failure can be cleanly reverted without losing prior work.

## Update Workflow

### 1. Discover Vulnerable Dependencies

Use `socket fix` to identify dependencies with known vulnerabilities and compute upgrade paths.

**Fix all discoverable vulnerabilities (recommended starting point):**

```shell
socket fix --all --no-apply-fixes --json
```

This performs a dry run: it uploads project manifests to the Socket API, discovers all fixable GHSAs via Coana analysis, computes upgrade paths, and reports what would change — without modifying any files.

**Target specific vulnerabilities by ID:**

```shell
socket fix --id GHSA-xxxx-xxxx-xxxx --no-apply-fixes --json
socket fix --id CVE-2024-12345 --no-apply-fixes --json
socket fix --id pkg:npm/lodash@4.17.20 --no-apply-fixes --json
```

CVE IDs and PURLs are automatically converted to GHSA IDs.

Review the dry-run output to understand which packages will be upgraded and to what versions.

### 2. Apply Fixes One at a Time

Once you understand what will change from the dry run, apply upgrades **one vulnerability at a time**. The main agent loops over the vulnerability list and dispatches a subagent for each one. This is critical — each update produces large diffs, build logs, and test output that would rapidly exhaust the main context window.

**For each vulnerability from the dry-run output, the main agent spawns a subagent that:**

1. Applies the single targeted fix:

   ```shell
   socket fix --id GHSA-xxxx-xxxx-xxxx --no-major-updates
   ```

2. Builds the project and runs the full test suite
3. If tests pass, commits the change and reports success back to the main agent
4. If tests fail:
   - Attempts to fix breaking changes in code
   - If the breakage is not easily fixable, reverts the update and retries with an alternative version (e.g., drop `--no-major-updates`, or pin to a specific intermediate version with `--range-style pin`)
   - If no version resolves the issue cleanly, reverts all changes and reports failure back to the main agent

**When a subagent reports failure, the main agent must stop.** Do not continue to the next vulnerability. Report the failure to the user with details on what was tried and why it failed.

**Do NOT use `socket fix --all` to apply everything at once.** Always target individual vulnerabilities so each change can be independently verified.

**Useful flags:**

| Flag                          | Purpose                                                                     |
| ----------------------------- | --------------------------------------------------------------------------- |
| `--no-major-updates`          | Skip fixes that require major version bumps (safer, fewer breaking changes) |
| `--range-style pin`           | Pin to exact versions instead of preserving range style                     |
| `--minimum-release-age 2d`    | Only suggest versions published at least 2 days ago                         |
| `--output-file fixes.json`    | Save computed upgrades to a JSON file for inspection                        |
| `--ecosystems npm,pypi`       | Limit to specific ecosystems                                                |
| `--include "packages/*"`      | Only fix matching workspaces                                                |
| `--exclude "packages/legacy"` | Skip matching workspaces                                                    |

After `socket fix` completes, review the changes it made to manifest and lock files (e.g. `package.json`, `package-lock.json`, `requirements.txt`, `go.mod`).

### 3. Identify Breaking Changes (runs inside each subagent)

After each subagent applies a fix, it determines what may have broken. **These steps happen inside the subagent, not in the main agent** — the main agent only dispatches and collects results.

1. **Check what changed**: Review the diff of manifest/lock files to see which packages were upgraded and by how many major/minor/patch versions
2. **For major version bumps**: Look up the CHANGELOG or migration guide for each upgraded package
3. **For minor/patch bumps**: These are usually backwards-compatible, but still check release notes for deprecation warnings
4. **Identify affected code**: Search the codebase for imports and usage of each upgraded package

### 4. Fix Breaking Changes (runs inside each subagent)

The subagent addresses any breaking changes introduced by the upgrade:

- **Renamed or removed APIs**: Search for usage of deprecated or removed functions, classes, or methods and update them
- **Changed imports**: Update import paths if the package restructured its module exports
- **Configuration changes**: Adjust configuration objects, option names, or default values
- **Type changes**: Update TypeScript type annotations or interfaces if type definitions changed
- **New peer dependencies**: Install any newly required peer dependencies
- **Behavioral changes**: Adjust code that relies on changed default behaviors or return values

### 5. Verify

Iterate until everything passes:

1. **Build the project** to check for compile/type errors
2. **Run the full test suite** and fix any failing tests
3. **Run the `/socket-scan` skill** to confirm no new vulnerabilities were introduced by the upgrades
4. **Re-run `socket fix --all --no-apply-fixes --json`** to verify no fixable vulnerabilities remain

If tests fail after fixing, investigate each failure:

- Determine whether the failure is caused by a breaking API change or a pre-existing issue
- Apply targeted code fixes, re-run tests, and repeat until green

## Example

Fixing all vulnerabilities in a Node.js project (success case):

1. Dry run to discover issues: `socket fix --all --no-apply-fixes --json`
2. Review output — 3 GHSAs found affecting `lodash`, `express`, and `semver`
3. **Subagent 1 — lodash**: `socket fix --id GHSA-aaaa-aaaa-aaaa --no-major-updates` → minor bump applied → tests pass → commit → reports success
4. **Subagent 2 — semver**: `socket fix --id GHSA-bbbb-bbbb-bbbb --no-major-updates` → patch applied → tests pass → commit → reports success
5. **Subagent 3 — express**: `socket fix --id GHSA-cccc-cccc-cccc --no-major-updates` → no fix available without major bump
   - Retry: `socket fix --id GHSA-cccc-cccc-cccc` (allow major bump)
   - Major bump applied → 2 test failures in route tests
   - Fix route handler code to match new Express API
   - Tests pass → commit → reports success
6. All subagents succeeded → run `/socket-scan` skill → no new vulnerabilities

Failure case — main agent stops on first failure:

1. Dry run: 3 GHSAs found affecting `lodash`, `ws`, and `semver`
2. **Subagent 1 — lodash**: patch applied → tests pass → commit → reports success
3. **Subagent 2 — ws**: tried `--no-major-updates` (no fix), tried major bump (tests fail, code migration too complex), reverted → reports failure
4. **Main agent stops.** Reports to user: "ws (GHSA-yyyy-yyyy-yyyy) could not be updated. Tried minor/patch (no fix available) and major bump v7→v8 (broke WebSocket handshake tests, migration not straightforward). lodash was successfully updated. semver was not attempted."

## Fallback: Agents Without Subagent Support

Some agents (Codex, Gemini CLI) do not support spawning subagents. In this case, use a sequential workflow within the main context:

1. Run `socket fix --all --no-apply-fixes --json` to discover all vulnerabilities
2. For each vulnerability, **one at a time**:
   a. Apply the fix: `socket fix --id GHSA-xxxx --no-major-updates`
   b. Build and test the project
   c. If tests pass, commit the change
   d. If tests fail, attempt to fix breaking changes, then retest. If unfixable, revert and stop.
3. After all fixes, run `socket fix --all --no-apply-fixes --json` to verify no vulnerabilities remain

To manage context window limits without subagents:

- Redirect build and test output to files (e.g., `npm test > test-output.txt 2>&1`) and only read them if failures occur
- Process one vulnerability at a time and commit between each to keep diffs small
- If the context window is getting full, stop and report progress so far

## Error Handling

- **`socket fix` returns no results**: The project may have no fixable vulnerabilities, or the Socket API may not cover the project's ecosystems. Check that manifest and lock files exist in the repository.
- **`socket fix --id` fails with "GHSA not found"**: The advisory ID may be incorrect or not yet indexed. Try searching by CVE ID or PURL instead.
- **`socket fix` modifies files but tests fail**: The subagent (or main agent in fallback mode) should revert the changes with `git checkout -- .` and try an alternative version. Never leave the project in a broken state.
- **Authentication required**: Run `socket login` or set `SOCKET_CLI_API_TOKEN`. For users without an account, use the `/socket-setup` skill to configure the public demo token (limited rate).
- **Network errors during fix**: `socket fix` contacts the Socket API to compute upgrade paths. Check network connectivity and try again.

## How This Differs from `/socket-dep-patch`

|                          | `/socket-dep-upgrade` (this skill)       | `/socket-dep-patch`                                    |
| ------------------------ | ---------------------------------------- | ------------------------------------------------------ |
| **Primary tool**         | `socket fix`                             | `socket-patch apply`                                   |
| **What it does**         | Upgrades dependency versions to fix CVEs | Applies binary-level patches without changing versions |
| **Version changes?**     | Yes                                      | No                                                     |
| **Code changes needed?** | Possibly (API migration for major bumps) | No                                                     |

Use `/socket-dep-upgrade` when you want full version upgrades. Use `/socket-dep-patch` when you need fixes without version churn.

## Tips

- Start with `--no-apply-fixes --json` to preview changes before modifying files
- Use `--no-major-updates` first for each fix, then escalate to major bumps only if needed
- **Always apply fixes one vulnerability at a time** — never batch updates without testing between them
- **Run each update pass as a subagent** — this is mandatory to prevent context window exhaustion from build output, diffs, and test results
- **If an update breaks tests**, the subagent should try alternative versions (revert, try a different minor/patch, try with/without `--no-major-updates`) before reporting failure
- **Stop on failure** — if any single update cannot be completed, halt the entire process and report to the user rather than continuing with a broken state
- Commit after each successful update so progress is saved and failures can be cleanly reverted
- Use `--minimum-release-age 2d` to avoid upgrading to freshly-published versions
- Combine with the `/socket-inspect` skill to compare security profiles before and after upgrades
- After all fixes are applied, run the `/socket-scan` skill to verify no new risks were introduced
- For monorepos, use `--include` and `--exclude` to target specific workspaces
