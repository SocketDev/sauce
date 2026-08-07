---
name: socket-fix
description:
  Fix dependency security issues - either scan and fix everything (requires
  /socket-scan), or target a single named package. Orchestrates /socket-dep-cleanup,
  /socket-dep-replace, /socket-dep-patch, and /socket-dep-upgrade as subskills.
---

# Fix

Fix dependency security issues in your project. This skill operates in two modes:

- **Fix All** - scan the entire project and systematically resolve all findings
- **Fix Package** - target a single named package and resolve its issues

This skill is an **orchestrator**. It delegates concrete actions to the subskills: `/socket-dep-cleanup`, `/socket-dep-replace`, `/socket-dep-patch`, and `/socket-dep-upgrade`.

## When to Use

- The user wants to fix all dependency security issues in their project (Fix All mode)
- The user wants to fix a specific vulnerable, unused, or flagged package (Fix Package mode)
- The user wants a one-shot "fix everything" for their dependencies
- The user wants to clean up, patch, and upgrade in a single coordinated pass
- The user asks for a safe or conservative dependency repair
- The user wants to progressively increase aggressiveness (start safe, escalate if needed)
- The user names a specific package, GHSA, CVE, or PURL they want fixed

## Mode Detection

Determine which mode to use from the user's prompt:

- **Fix All** - "fix everything", "fix all dependencies", "fix my project", "scan and fix", or no specific package named
- **Fix Package** - "fix lodash", "fix express@4.17.1", "fix GHSA-xxxx-xxxx-xxxx", or any prompt that names a specific package, PURL, GHSA, or CVE

If ambiguous, ask: **"Do you want to fix all dependencies or a specific package?"**

---

## Fix All Mode

Scan the project with `/socket-scan`, then systematically resolve findings using subskills. Choose from three aggressiveness levels to control how far the repair goes.

## Prerequisites

**`/socket-scan` must be working.** Fix All mode requires a full scan to know what to fix.

<!-- BEGIN_SECTION:cli-setup.md -->

### Socket CLI Setup

Use `pnpm dlx socket` to run the Socket CLI - this always fetches the latest version and requires no global install. Verify it works:

```shell
pnpm dlx socket --version
```

All commands in this skill use the `pnpm dlx socket` prefix (e.g., `pnpm dlx socket scan create ...`).

<details><summary>Authentication: demo token or account login, plus the optional global install</summary>

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

</details>
<!-- END_SECTION:cli-setup.md -->

**Do not proceed with Fix All mode until scanning works.** If the user cannot or will not set up Socket, offer Fix Package mode instead (which has lower requirements per subskill).

## Step 1: Run Initial Scan

Run `/socket-scan` to get a full picture of the project's dependency health. Use `--tmp` for a temporary read-only scan - the default, which does not persist to the dashboard:

```shell
pnpm dlx socket scan create . --tmp --json
```

Parse the scan results to build a prioritized list of issues:

1. **Malware** - packages flagged as malware (highest priority)
2. **Critical/high CVEs** - known vulnerabilities with available fixes
3. **Medium/low CVEs** - lower-severity vulnerabilities
4. **Low Socket scores** - packages with quality, maintenance, or supply-chain concerns
5. **Unused dependencies** - packages with no detected usage in the codebase

Report the scan summary to the user:

```text
Scan Results:
  Total packages: 150
  Critical: 2, High: 5, Medium: 12, Low: 25
  Malware: 0
  Low-score packages: 3
```

## Step 2: Detect Environment

Before any repair work, identify the project's ecosystem and dependency landscape.

1. **Detect ecosystems** - check for manifest and lock files (`package.json`, `requirements.txt`, `go.mod`, `Cargo.toml`, etc.) to determine which package managers are in use
2. **Parse dependencies** - read manifest files to build a list of all direct dependencies (production and dev)
3. **Detect CI** - check for CI/CD configuration (`.github/workflows/`, `.gitlab-ci.yml`, `bitbucket-pipelines.yml`, etc.) to understand the project's build and test infrastructure
4. **Ensure dependencies are installed** - check for the presence of the dependency directory (`node_modules/`, `vendor/`, etc.). If dependencies are not installed, run the project's install command using the detected package manager (e.g. `npm install`, `pnpm install`, `bun install`). This is required for both patching and accurate unused dependency detection.

Report a brief summary:

```text
Environment detected:
  Ecosystem: npm (package-lock.json)
  Dependencies: 42 production, 18 dev
  CI: GitHub Actions (Node 18/20 matrix)
  Build command: npm run build
  Test command: npm test
  Dependencies installed: yes (node_modules/ present)
```

## Step 3: Select Aggressiveness Level

Ask the user which level they want, or auto-detect from their prompt:

| Level | Name             | What It Does                                                                                         |
| ----- | ---------------- | ---------------------------------------------------------------------------------------------------- |
| 1     | **Conservative** | Only non-breaking changes: remove trivially unused deps + apply binary patches                       |
| 2     | **Cautious**     | Everything in Level 1, plus propose ONE risky change for user approval                               |
| 3     | **Full**         | Safe upgrades, aggressive cleanup, patching, and risky major upgrades - skip and continue on failure |

If the user says "fix everything", "full repair", or "aggressive" → Level 3.
If the user says "safe", "conservative", or "don't break anything" → Level 1.
If the user says "careful", "cautious", or "one step at a time" → Level 2.
If unclear, default to Level 1 and offer to escalate.

---

## Level 1 - Conservative

Only non-breaking changes. Nothing here should break the build.

### Phase 1a: Remove Trivially Unused Dependencies

For each dependency in the project:

1. Search the entire codebase for usages (imports, requires, config refs, scripts, type packages, indirect usage)
2. Collect packages where no usage is found
3. **Exclude ambiguous cases** from automatic removal:
   - `@types/*` packages (may support type-checking for indirect usage)
   - Peer dependencies required by other installed packages
   - CLI tools referenced in `package.json` scripts
   - Build plugins (webpack, babel, eslint, jest, etc.)
   - Packages with ambiguous import names (PyPI packages where import name differs from package name)
4. For each clearly unused package, execute the `/socket-dep-cleanup` skill workflow
5. **Commit after each removal** so progress is preserved

### Phase 1b: Apply Binary Patches

Execute the `/socket-dep-patch` workflow:

1. Ensure dependencies are installed (should have been verified in Step 2)
2. Run `pnpm dlx @socketsecurity/socket-patch scan` to discover available patches
3. Apply all patches with `pnpm dlx @socketsecurity/socket-patch apply`
4. Build and test to verify nothing broke
5. Commit the patch manifest (`.socket/manifest.json`)

---

## Level 2 - Cautious

Run the full Level 1 workflow first, then propose one risky change.

### Phase 2a: Run Full Level 1

Execute Phase 1a (unused dep removal) and Phase 1b (binary patches) as described above.

### Phase 2b: Identify ONE Highest-Value Risky Change

After Level 1 completes, use the scan results from Step 1 to identify the single highest-value change that carries some risk. Prioritize in this order:

1. **Critical/high CVE upgrade** - a dependency with a known critical or high severity vulnerability that requires a version bump
2. **Replacement of a flagged dependency** - a dependency with a low Socket score or known maintenance issues that should be swapped for a better alternative (use `/socket-dep-replace`)
3. **Ambiguous unused dependency** - a package that is _probably_ unused but was excluded from Phase 1a due to ambiguity (e.g., a `@types/*` package whose base package is not used, or a build plugin that may no longer be needed)
4. **Safe minor version bump** - a dependency with a minor/patch update available that fixes a medium-severity issue

Present the proposed change to the user with full context:

```text
Proposed risky change (Level 2):

  Package: lodash (4.17.20 → 4.17.21)
  Reason: Fixes GHSA-xxxx-xxxx-xxxx (high severity prototype pollution)
  Risk: Minor version bump — low risk of breaking changes
  Affected files: src/utils/helper.ts, src/api/handler.ts (2 import locations)

  Approve this change? [yes/no]
```

### Phase 2c: Execute If Approved

- If the user approves, execute via `/socket-dep-upgrade` (for version bumps) or `/socket-dep-cleanup` (for removals)
- Build and test after applying
- **Revert on failure** - if the change breaks the build or tests, revert immediately and report what happened
- If the user declines, skip and report Level 2 complete

---

## Level 3 - Full

Aggressive repair. Apply everything possible, skip and continue on individual failures.

### Phase 3a: Safe Upgrades

1. Use scan results and `pnpm dlx socket fix --all --no-apply-fixes --json` to discover all fixable vulnerabilities
2. Filter to **minor and patch bumps only** (`--no-major-updates`)
3. For each vulnerability, dispatch `/socket-dep-upgrade` to apply the fix
4. **Skip and continue on failure** - if a single upgrade fails after retries, log the failure and move on to the next one. This diverges from `/socket-dep-upgrade`'s default "bail on failure" behavior - intentional for Level 3's aggressive posture
5. Commit after each successful upgrade

### Phase 3b: Aggressive Cleanup

1. Re-scan all dependencies for usage - the dependency list may have changed after Phase 3a upgrades
2. Run `/socket-dep-cleanup` for **both** clearly unused AND ambiguous packages
3. After each removal, build and test
4. **Revert removals that break the build** - if removing a package causes failures, re-add it and mark it as "still needed"
5. Commit after each successful removal

### Phase 3b2: Replace Flagged Dependencies

1. Review scan results for dependencies with low Socket scores, unmaintained status, or known supply-chain risks
2. For each flagged dependency, run `/socket-dep-replace` to find and execute a replacement
3. **Skip and continue on failure** - if a replacement cannot be completed (no suitable alternative, migration too complex, tests fail), log it and move on
4. Commit after each successful replacement

### Phase 3c: Patch Everything Remaining

1. Run `pnpm dlx @socketsecurity/socket-patch scan` to discover patches for remaining dependencies
2. Run `pnpm dlx @socketsecurity/socket-patch apply` to apply all discovered patches
3. Build and test
4. Commit patch manifest

### Phase 3d: Risky Major Upgrades

1. Re-run `pnpm dlx socket fix --all --no-apply-fixes --json` to find remaining vulnerabilities
2. Attempt **major version bumps** via `/socket-dep-upgrade` with code migration
3. **Skip and continue on failure** - if a major upgrade cannot be completed (migration too complex, tests fail), log it and move on
4. Commit after each successful upgrade

---

## Step 4: Post-Repair Scan

After all phases complete (regardless of level):

1. Run `/socket-scan` again to get a fresh security scan
2. Compare findings against the initial scan from Step 1
3. Report a summary:

```text
Repair Complete (Level 2 — Cautious)

  Removed: 3 unused dependencies (is-odd, left-pad, unused-util)
  Patched: 5 packages via socket-patch
  Upgraded: 1 package (lodash 4.17.20 → 4.17.21)
  Skipped: 0 failures

  Security delta:
    Before: 4 critical, 8 high, 12 medium
    After:  1 critical, 3 high, 10 medium

  Remaining issues:
    - express@4.17.1: GHSA-yyyy-yyyy-yyyy (critical) — requires major bump to v5, not attempted at Level 2
```

---

## Fix Package Mode

Target a single named package and resolve its issues. Does not require a full scan - just operates on the specified package.

## Step 1: Identify the Target

The user may specify a package by:

- **Package name** - `lodash`, `express`
- **Name + version** - `lodash@4.17.20`
- **PURL** - `pkg:npm/lodash@4.17.20`
- **Advisory ID** - `GHSA-xxxx-xxxx-xxxx`, `CVE-2024-12345`

If the user provides an advisory ID, resolve it to the affected package(s) using `pnpm dlx socket fix --id <ID> --no-apply-fixes --json`.

## Step 2: Diagnose

Investigate what's wrong with the target package:

<details><summary>The four diagnosis checks and the findings-report shape</summary>

1. **Check if it's installed** - verify the package is in the manifest/lock file
2. **Check for vulnerabilities** - run `pnpm dlx socket fix --id pkg:<ecosystem>/<name>@<version> --no-apply-fixes --json` (requires Socket account) or check if the user provided a specific advisory
3. **Check for usage** - search the codebase for imports and references (useful to know if cleanup is an option)
4. **Check for patches** - run `pnpm dlx @socketsecurity/socket-patch scan` and check if patches are available for this package

Report findings:

```text
Package: lodash@4.17.20

  Vulnerabilities:
    - GHSA-xxxx-xxxx-xxxx (high) — prototype pollution, fixed in 4.17.21

  Usage: 6 imports across 3 files
    - src/utils/helper.ts (merge, cloneDeep)
    - src/api/handler.ts (get, set)
    - src/components/Table.tsx (sortBy, groupBy)

  Socket patches available: yes (1 patch)

  Possible actions:
    1. Patch — apply binary patch without version change (/socket-dep-patch)
    2. Upgrade — bump to 4.17.21 to fix the CVE (/socket-dep-upgrade)
    3. Replace — swap for an alternative package (/socket-dep-replace)
    4. Remove — remove if unused (/socket-dep-cleanup)
```

</details>

## Step 3: Recommend and Execute

Based on the diagnosis, recommend the best action. If multiple actions apply, prioritize in this order:

1. **Upgrade** - if a version bump fixes the issue and is available, prefer this (most complete fix)
2. **Patch** - if a binary patch is available and the user wants to avoid version changes
3. **Replace** - if the package is unmaintained, has a low Socket score, or the user specifically wants an alternative
4. **Remove** - if the package is unused

Present the recommendation and ask for approval. Then delegate to the appropriate subskill:

- Vulnerability fix → `/socket-dep-upgrade`
- Binary patch → `/socket-dep-patch`
- Swap for alternative → `/socket-dep-replace`
- Remove unused → `/socket-dep-cleanup`

If the user has a preference ("just patch it", "upgrade it", "replace it with dayjs"), skip the recommendation and go directly to the requested subskill.

## Step 4: Verify

After the subskill completes:

1. Build and test the project
2. Confirm the issue is resolved
3. Report the result

---

## Error Handling

- **`/socket-scan` not working (Fix All mode)**: Do not proceed with Fix All. Offer to run `/socket-setup` first, or suggest Fix Package mode as an alternative.
- **Socket CLI not installed**: Run `/socket-setup` to install and authenticate. For users without an account, `/socket-setup` will configure the public demo token, which provides limited access to CLI features like `pnpm dlx socket fix` and `pnpm dlx socket package score` (but not `pnpm dlx socket scan create`).
- **Rate limits hit**: The public token has rate limits. If the user hits them, suggest creating a free account at <https://socket.dev> to remove limits.
- **No dependencies found**: The project may not have manifest files in the expected locations. Check for monorepo structures or non-standard layouts.
- **Build/test command unknown**: Ask the user for the correct build and test commands before starting repair.
- **All upgrades fail in Level 3**: If every upgrade attempt fails, report what was tried and suggest the user investigate manually. The cleanup and patch phases may still have succeeded.
- **Network errors**: `socket fix` and `socket-patch` require network access. Check connectivity and retry once before skipping.

## Tips

- Start with Level 1 if you're unsure - it's designed to be completely safe
- Level 2 is ideal for regular maintenance: safe changes plus one carefully reviewed improvement
- Level 3 is best for major cleanup efforts where you're prepared to review and test extensively
- Each level builds on the previous one, so you can start conservative and escalate
- All changes are committed individually, making it easy to revert any single change
- Fix Package mode is useful when you already know which package is problematic
- Fix All mode gives you the full picture first, so you fix the most important issues
- For monorepos, consider running repair on each workspace individually
- Combine with `/socket-setup` to ensure the Socket CLI is properly configured before starting
