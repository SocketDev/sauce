---
name: socket-reachability
description: Run Socket full application reachability analysis and read the
  .socket.facts.json report it writes. Use it to learn which vulnerabilities
  your code actually reaches, so you fix reachable CVEs first.
---

# Reachability Analysis

Run Socket's full application reachability analysis on a project, read the `.socket.facts.json` report, and rank vulnerabilities by whether the project's code reaches them. Fix the reachable ones first, with `/socket-fix`.

All commands in this skill use the `pnpm dlx socket` prefix. Do not install the CLI globally to run them.

## When to Use

- The user asks which vulnerabilities in their dependencies are reachable or exploitable from their code
- A scan from `/socket-scan` found many CVEs and the user wants to know which to fix first
- The user asks to run `pnpm dlx socket scan reach` or `pnpm dlx socket scan create --reach`
- The user has a `.socket.facts.json` file and wants it explained
- The user wants to cut alert noise by setting aside unreachable vulnerabilities
- A CI job needs a reachability report as a JSON file

## Prerequisites

- **Sign-in.** The CLI must be signed in to an organization. Use `/socket-connect` to sign in. For the CLI, the user runs `pnpm dlx socket login` in their own terminal; the agent cannot run it. Never ask the user to paste a token into chat, and never print one. Use `SOCKET_CLI_API_TOKEN` only in CI.
- **Plan.** The CLI checks the organization's plan before it runs the analysis. If it fails with "Full application reachability analysis requires an enterprise plan", tell the user plainly that this feature is not available on their current plan, and point them to <https://socket.dev/pricing>. Do not guess which plan they need.
- **Toolchains.** The analysis engine needs Node.js 22 or later, plus the toolchain for each language it analyzes. The docs list Java 8 to 27 for JVM projects, Python 3.11 or later with uv 0.6.8 or later, .NET 6 or later, the project's own Go toolchain, and Rust 1.74 or later with `rust-src`. See <https://docs.socket.dev/docs/full-application-reachability>.
- **Lock files.** The analysis reads the project's manifests and lock files. Install dependencies first if the lock files are missing. sbt projects, and Gradle projects without `gradle.lockfile` or `libs.versions.toml`, need `--dynamic-sbom-inference`, or run `pnpm dlx socket manifest dynamic-sbom-inference` first. Otherwise the analysis stops.

The CLI uploads manifest files to Socket, because the analysis first builds an SBOM from them. Tell the user this before the first run. Source code is analyzed locally by the engine the CLI downloads and caches in `~/.cache/socket/coana` (or `$XDG_CACHE_HOME/socket/coana`).

## Step 1: Confirm Sign-In and Organization

Check that the CLI can reach an organization:

```shell
pnpm dlx socket organization list --json --no-banner --no-spinner
```

If this fails or returns no organization, stop and send the user to `/socket-connect`. If there are several organizations, ask which one to use and pass it with `--org <org-slug>`.

If the hosted Socket MCP server is connected, its `organizations` tool lists the same organizations. Match the tool by the `organizations` suffix, not a fixed prefix (see `/socket-connect`, Step 1). The MCP tools do not run reachability analysis; use the CLI for that.

## Step 2: Pick the Command

| Goal                                                            | Command                               |
| --------------------------------------------------------------- | ------------------------------------- |
| Get a local reachability report only, with no scan in Socket    | `pnpm dlx socket scan reach`          |
| Run reachability and upload a full scan to the Socket dashboard | `pnpm dlx socket scan create --reach` |

Default to `pnpm dlx socket scan reach`. It creates no scan and keeps the report on disk. Use `pnpm dlx socket scan create --reach` only when the user explicitly wants the scan saved to the Socket dashboard.

`pnpm dlx socket scan create --reach` deletes `.socket.facts.json` after a successful scan. Add `--reach-retain-facts-file` if you need to read the report afterward. A failed scan keeps the file for debugging.

Both commands take exactly one target directory. It must exist and must be inside the current working directory.

## Step 3: Run the Analysis

Report only, for the current directory:

```shell
pnpm dlx socket scan reach . --org <org-slug> --json --no-banner --no-spinner 2>/dev/null
```

In `--json` mode the engine's own log goes to stderr, so `2>/dev/null` leaves clean JSON on stdout. On success the output looks like this:

```json
{ "ok": true, "data": { "reachabilityReport": ".socket.facts.json" } }
```

`data` may also carry a `tier1ReachabilityScanId`. On failure the output is `{ "ok": false, "message": "...", "cause": "..." }` and the exit code is non-zero. Show the user `message` and `cause`.

Write the report somewhere else with `--output` (the path must end in `.json`):

```shell
pnpm dlx socket scan reach ./proj --output ./reports/analysis.json
```

Reachability plus a dashboard scan, keeping the report. Run this only when the user explicitly asks to save the scan to the Socket dashboard; otherwise use `scan reach` above:

```shell
pnpm dlx socket scan create . --reach --reach-retain-facts-file --org <org-slug> --json --no-banner --no-spinner
```

Every `--reach-*` flag on `scan create` requires `--reach`.

<details><summary>Useful reachability flags</summary>

These work on both commands unless noted. Source: socket-cli `src/commands/scan/reachability-flags.mts`.

| Flag                                     | Default       | Use it to                                                                                                                                                   |
| ---------------------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--reach-ecosystems <list>`              | all           | Limit the analysis. Values: `cargo`, `composer`, `gem`, `golang`, `maven`, `npm`, `nuget`, `pypi`                                                           |
| `--reach-advisories <GHSA/CVE,...>`      | all           | Check only these advisories. CVE IDs are converted to GHSA. Others get `unknown`                                                                            |
| `--reach-analysis-timeout <time>`        | `10m`         | Allow more time, for example `1h`                                                                                                                           |
| `--reach-analysis-memory-limit <size>`   | `8192` (8 GB) | Raise or lower memory, for example `16GB`                                                                                                                   |
| `--reach-concurrency <n>`                | `1`           | Analyze several workspaces at once                                                                                                                          |
| `--reach-continue-on-missing-lock-files` | off           | Keep going when a Gradle or sbt project has no lock file, version catalog or generated SBOM                                                                 |
| `--reach-continue-on-install-errors`     | off           | Keep going when installing a workspace's dependencies fails                                                                                                 |
| `--reach-continue-on-analysis-errors`    | off           | Keep going when one workspace's analysis fails                                                                                                              |
| `--reach-continue-on-no-source-files`    | off           | Keep going when a workspace has no source files                                                                                                             |
| `--reach-retain-facts-file`              | off           | Keep `.socket.facts.json` after `scan create --reach`                                                                                                       |
| `--reach-fallback-to-regular-scan`       | off           | `scan create` only: upload a regular scan if reachability fails                                                                                             |
| `--reach-debug`                          | off           | Print engine debug output                                                                                                                                   |
| `--exclude-paths <globs>`                | none          | Skip paths, as globs relative to the current working directory (or `--cwd`), not the target. Use `**/name` to match at any depth. Negation is not supported |
| `--dynamic-sbom-inference`               | off           | Build the SBOM from the build tool. Recommended for JVM and .NET projects                                                                                   |

</details>

## Step 4: Read `.socket.facts.json`

The report is written to the scan's working directory as `.socket.facts.json`, unless `--output` named another path. Do not confuse this file with build-generated SBOM files such as `pom.xml.socket.facts.json` or `gradle.socket.facts.json`. Those are inputs, not reachability reports.

There is no published, versioned schema for this file. The CLI itself reads only these fields:

```text
{
  tier1ReachabilityScanId?: string,
  components: [{
    name, version,
    reachability?: [{
      ghsa_id,                       // snake case here
      reachability: [{ type, workspacePath, subprojectPath }]
    }]
  }]
}
```

`subprojectPath` is the build root (`.` for a single-root repo). `workspacePath` is the workspace inside it.

Other fields appear in the CLI's test fixtures only, so they may change. Each component can carry `type` (the purl type, such as `npm`) and `vulnerabilities: [{ ghsaId, severity, range }]` (camel case here). Each reachability entry can carry `analysisLevel` and `matches`. `matches` is an array of call chains. Each chain is an array of `{ package, sourceLocation: { filename, start, end }, confidence }`, where `start` and `end` have `line` and `column`. Inspect the real file before relying on these fields.

List every advisory with its reachability type, one line each:

```shell
node -e '
const f = require(require("path").resolve(process.argv[1]));
for (const c of f.components ?? []) {
  for (const r of c.reachability ?? []) {
    for (const e of r.reachability ?? []) {
      console.log([e.type, r.ghsa_id, `${c.name}@${c.version}`, e.subprojectPath, e.workspacePath].join("\t"));
    }
  }
}' .socket.facts.json | sort
```

## Step 5: Triage by Reachability

Group findings by `type`. The docs at <https://docs.socket.dev/docs/reachability-results> define these values:

| `type`                        | Meaning                                                                              | Priority                    |
| ----------------------------- | ------------------------------------------------------------------------------------ | --------------------------- |
| `reachable`                   | The project's code reaches the vulnerable code                                       | Fix first                   |
| `unreachable`                 | The vulnerable code is not reached                                                   | Lower; keep on the list     |
| `unknown`, `error`            | The analysis could not decide                                                        | Treat as possibly reachable |
| `undeterminable_reachability` | Socket found reachability cannot be determined for this CVE (often CLIs or binaries) | Treat as possibly reachable |
| `missing_support`             | Socket has not yet mapped this CVE to the vulnerable functions                       | Treat as possibly reachable |

Other values in that docs table (`maybe_reachable`, `pending`, `direct_dependency`) belong to precomputed reachability. Expect `reachable`, `unreachable` and `error` most often in a local report.

Report to the user:

1. Reachable advisories, with package, version, workspace, and the call sites from `matches` when present.
2. Undecided advisories (`unknown`, `error`, `undeterminable_reachability`, `missing_support`).
3. A count of unreachable advisories. Do not call them safe; say they were not reached in this analysis.

The engine also warns in text mode about each failed advisory as `<ghsaId> in <name>@<version> (<workspace>)`. Include those under undecided.

## Step 6: Fix Reachable Vulnerabilities First

Hand the reachable advisory IDs to `/socket-fix`. Its `--id` flag accepts GHSA IDs, CVE IDs, or PURLs, repeated or comma-separated. Preview first:

```shell
pnpm dlx socket fix --id GHSA-xxxx-xxxx-xxxx,GHSA-yyyy-yyyy-yyyy --no-apply-fixes --json
```

Let `/socket-fix` apply the changes and verify them. When no fixed version exists, use `/socket-dep-patch` for a Socket patch or `/socket-dep-replace` for a replacement package. Use `/socket-inspect` to look into a flagged package. After fixing, re-run Step 3 and confirm the advisories are gone.

## Step 7: Clean Up the Report

Delete `.socket.facts.json` when you are done with it, unless the user wants to keep it:

```shell
rm .socket.facts.json
```

A plain `pnpm dlx socket scan create` without `--reach` uploads a leftover `.socket.facts.json` as an SBOM, with stale reachability results. Do not commit the file. Suggest adding it to `.gitignore`.

## Language Support

The docs at <https://docs.socket.dev/docs/reachability-analysis> list full application reachability for:

- JavaScript and TypeScript (npm, yarn, pnpm)
- Python (uv, pip, Poetry, Anaconda)
- Go
- Java, Scala and Kotlin (Maven, Gradle, sbt)
- .NET C# (NuGet, Paket)
- Ruby (Bundler)
- Rust (cargo)
- PHP (Composer)

Analysis is function-level, except .NET, which is class-level. Check the docs for current support before telling a user their language is covered.

## Error Handling

- **"Full application reachability analysis requires an enterprise plan"**: the feature is not available on the organization's plan. Say so plainly and link <https://socket.dev/pricing>. Offer `/socket-scan` without reachability instead.
- **"Authentication failed"** or a missing API token: send the user to `/socket-connect` to sign in.
- **"Reachability analysis flags require --reach to be enabled"**: add `--reach` to `scan create`, or use `scan reach`.
- **`--output` rejected**: the path must end in `.json`.
- **Target rejected**: pass exactly one directory that exists inside the current working directory.
- **Missing lock files, install errors, or no source files**: fix the project setup, or add the matching `--reach-continue-on-*` flag and report the skipped workspaces.
- **Timeout or out of memory**: raise `--reach-analysis-timeout` or `--reach-analysis-memory-limit`, narrow with `--reach-ecosystems`, or scan one subdirectory.
- **Toolchain errors**: install the language toolchain listed in Prerequisites.

## Tips

- Default to `pnpm dlx socket scan reach`; it leaves no scan behind in Socket.
- Pass `--reach-retain-facts-file` whenever you run `scan create --reach` and need to read the report.
- Run with `--json --no-banner --no-spinner` and `2>/dev/null` for output you can parse.
- Read `ghsa_id` under `reachability[]` and `ghsaId` under `vulnerabilities[]` (when present); the casing differs.
- Unreachable is not the same as safe. It means this analysis found no path to the vulnerable code.
- Treat `unknown` and `error` as possibly reachable until a re-run decides them.
- Delete `.socket.facts.json` after reading it so a later scan does not upload stale results.
- For JVM and .NET projects, add `--dynamic-sbom-inference`. sbt projects, and Gradle projects without a lock file or version catalog, need it.
- For daily runs on GitHub repositories, see <https://docs.socket.dev/docs/managed-scans> (beta).
- Use `/socket-scan` for the full alert list, and this skill to rank its CVEs.
- More docs: <https://docs.socket.dev/docs/socket-scan>, <https://docs.socket.dev/docs/socket-fix>, <https://docs.socket.dev/docs/static-reachability-analysis>.
