---
name: socket-sbom
description: Generate a CycloneDX SBOM for a project, export a CycloneDX or SPDX SBOM for an existing Socket scan, and check dependencies against the organization's license policy. Use it when someone asks for an SBOM, a bill of materials, or a license report.
---

# Socket SBOM

Produce software bills of materials (SBOMs) and license reports with Socket. There are three paths:

- **Local CycloneDX SBOM:** `pnpm dlx socket cdxgen` runs cdxgen on the project. It needs no Socket account.
- **SBOM for an existing Socket scan:** the Socket REST API exports a scan as CycloneDX or SPDX. The CLI has no command for this.
- **License report:** `pnpm dlx socket scan report --license` checks a scan against the organization's license policy, and `pnpm dlx socket license` shows that policy.

## When to Use

- Someone asks for an SBOM, a bill of materials, or a CycloneDX file for a project
- A customer, auditor, or procurement form asks for an SPDX or CycloneDX document
- Export the SBOM of a scan that Socket already ran
- Check whether the project's dependencies pass the organization's license policy
- List which licenses the organization allows
- Load a pre-generated SBOM into a Socket scan

## Prerequisites

<!-- BEGIN_SECTION:cli-setup.md -->

### Socket CLI Setup

Use `pnpm dlx socket` to run the Socket CLI - this always fetches the latest version and requires no global install. Verify it works:

```shell
pnpm dlx socket --version
```

All commands in this skill use the `pnpm dlx socket` prefix (e.g., `pnpm dlx socket scan create ...`).

<details><summary>Account authentication and optional global install</summary>

**Optional global install:** If you prefer a global `socket` command, install with `npm install -g socket@latest` (must be version **1.0.0 or higher**).

#### Authentication

Commands that require authentication need a Socket account and a credential that you own. Create an account at <https://socket.dev> if you do not have one.

Authenticate with one of these methods:

- **Interactive login**: the user runs `pnpm dlx socket login` in their own terminal (it needs an interactive TTY, so the agent cannot run it). CLI releases with browser login show a device code to approve in the browser; older releases, including the current npm release, prompt for an API token. The `/socket-connect` skill covers signing in and choosing organizations.
- **Environment variable (CI)**: Set `SOCKET_CLI_API_TOKEN` to an organization API token in CI or other non-interactive environments

Verify account authentication:

```shell
pnpm dlx socket organization list
```

If you do not want an account, leave authentication unconfigured. Commands that require authentication remain unavailable. Do not print or share credential values to verify setup.

If authentication fails or the CLI is not installed, use the `/socket-setup` skill for detailed guidance including Node.js installation, PATH troubleshooting, and CI/CD token configuration.

</details>
<!-- END_SECTION:cli-setup.md -->

Local generation with `pnpm dlx socket cdxgen` needs no account. Scan reports and the license policy need a signed-in CLI or an API token. Use `/socket-connect` to sign in: the user runs `pnpm dlx socket login` in their own terminal.

The API export in Step 3 is different. `pnpm dlx socket login` alone is not enough for it, because the CLI keeps its token in its own config and no CLI command calls the export endpoints. The user needs an organization API token with the `report:read` scope, set as `SOCKET_CLI_API_TOKEN` in their own shell. Never ask the user to paste a token into the chat, and never print one.

The hosted Socket MCP server has no SBOM or license-report tool. For license alerts on a few specific packages, use the MCP tool whose name ends in `alerts` with category `license` (match tools by suffix, see `/socket-connect` Step 1), or use `/socket-inspect`. Use the CLI and the REST API for whole-project SBOMs and policy reports.

## Step 1: Pick the Path

Ask what the SBOM is for, then pick:

| Need                                                     | Path                    |
| -------------------------------------------------------- | ----------------------- |
| A CycloneDX file built from the code on disk, no account | Step 2 (local cdxgen)   |
| An SPDX file                                             | Step 3 (API export)     |
| The SBOM of a scan Socket already ran                    | Step 3 (API export)     |
| Pass/fail against the license policy                     | Step 4 (scan report)    |
| The list of allowed and denied licenses                  | Step 5 (license policy) |
| Feed an existing SBOM into a Socket scan                 | Step 6 (import)         |

Local generation writes CycloneDX only. For SPDX, use the API export in Step 3.

## Step 2: Generate a CycloneDX SBOM Locally

`pnpm dlx socket cdxgen` (same as `pnpm dlx socket manifest cdxgen`) runs the cdxgen release pinned by the Socket CLI. It downloads cdxgen when needed with `npx`, `pnpm dlx`, or `yarn dlx`, based on the lockfile.

```shell
pnpm dlx socket cdxgen .
```

Socket changes some cdxgen defaults:

- **Output file:** `socket-cdx.json` unless you pass `-o` or `--output`. Upstream cdxgen writes `bom.json`.
- **Project type:** `js` unless you pass `-t` or `--type`. Pass `-t` once per ecosystem in a mixed repo.
- **Lifecycle:** `pre-build` with `--install-deps false` unless you pass `--lifecycle`. This avoids running package install scripts. Passing `--lifecycle build` adds build-time data but runs project code again. Ask the user before you use it.

Common commands:

```shell
# Java project
pnpm dlx socket cdxgen -t java .

# Java and JavaScript, named output, pretty JSON, CycloneDX 1.6
pnpm dlx socket cdxgen -t java -t js -o sbom.cdx.json --spec-version 1.6 --json-pretty .

# License-focused profile
pnpm dlx socket cdxgen --profile license-compliance -t js .

# cdxgen's own help, including the pinned cdxgen version
pnpm dlx socket cdxgen --help
```

<details><summary>Argument rules and forwarded flags</summary>

- The target path must be `.` or start with `./`, `../`, or `/`. A bare name such as `proj` is rejected as an unknown argument. Write `./proj`.
- Only flags Socket knows are forwarded. Unknown flags exit with code 2 and print `Unknown argument(s): ...`. `--project-tag`, `--include-regex`, and `--exclude-regex` are rejected. Use `--exclude` with a glob instead of `--exclude-regex`.
- `-c` is Socket's own `--config` flag. Use `--resolve-class` for cdxgen's class resolution.
- `-p` / `--print` prints the SBOM as a table with a tree. It does not write the SBOM to stdout.
- `--spec-version` takes 1.4, 1.5, 1.6, or 1.7. The default is 1.6.
- `--profile` takes values such as `generic` (the default), `license-compliance`, `appsec`, `research`, `operational`, `threat-modeling`, and `ml`.
- Other forwarded flags: `--exclude-type`, `-r` / `--recurse` (on by default; `--no-recurse` turns it off), `--deep`, `--required-only`, `--fail-on-error`, `--no-babel`, `--install-deps`, `--validate` / `--no-validate`, `--evidence`, `--filter`, `--only`, `--author`, `--include-formulation`, `--include-crypto`, `--standard`, `--min-confidence`, `--technique`, `--auto-compositions`, `--generate-key-and-sign`, `--export-proto`, `--proto-bin-file`, and the server flags `--server`, `--server-host`, `--server-port`.
- Dependency-Track upload flags: `--server-url`, `--api-key`, `--project-group`, `--project-name`, `--project-version`, `--project-id`, `--parent-project-id`, `--skip-dt-tls-check`. Do not put a Dependency-Track key on the command line in chat. Ask the user to run that upload themselves.

</details>

On success the CLI logs `socket-cdx.json created!` (or your output name). The exit code is cdxgen's exit code.

Read the result. It is a CycloneDX JSON document:

- `components[]`: each has `name`, `version`, `purl`, `scope`, `hashes`, `bom-ref`, and `licenses[]`. A license entry is `{"license": {"id"|"name"|"url"}}` or `{"expression": "..."}`.
- `dependencies[]`: each has `ref` and `dependsOn`.

Tell the user that a local SBOM is an inventory only. It has no Socket alerts, malware checks, or scores. Use `/socket-scan` for that.

## Step 3: Export an SBOM for an Existing Socket Scan

The Socket API exports a full scan as CycloneDX or SPDX. Both endpoints are marked Beta. No `pnpm dlx socket` command calls them, so use the REST API.

First get the scan ID. `pnpm dlx socket scan create` prints it, or list recent scans:

```shell
pnpm dlx socket scan list --json
pnpm dlx socket scan list my-repo main --json
```

Get the organization slug from the `slug` field of each organization in the JSON output (or from the MCP tool whose name ends in `organizations`):

```shell
pnpm dlx socket organization list --json
```

Set `ORG` to the slug and `SCAN_ID` to the scan ID in the shell. Then call the export endpoint. `SOCKET_CLI_API_TOKEN` must already be set by the user in their own shell. The endpoints need the `report:read` scope and cost 1 quota unit each.

`--fail-with-body` makes curl exit non-zero on an HTTP error such as 401, 403, 404, or 429. Without it, curl exits 0 and writes the API's JSON error into the output file. On failure, show the error body and delete the file.

```shell
# CycloneDX
curl -sS --fail-with-body -u "$SOCKET_CLI_API_TOKEN:" \
  "https://api.socket.dev/v0/orgs/$ORG/export/cdx/$SCAN_ID" -o socket-sbom.cdx.json \
  || { cat socket-sbom.cdx.json; rm -f socket-sbom.cdx.json; }

# SPDX, with vulnerability data
curl -sS --fail-with-body -u "$SOCKET_CLI_API_TOKEN:" \
  "https://api.socket.dev/v0/orgs/$ORG/export/spdx/$SCAN_ID?include_vulnerabilities=true" -o socket-sbom.spdx.json \
  || { cat socket-sbom.spdx.json; rm -f socket-sbom.spdx.json; }
```

Before you treat the file as an SBOM, check its contents. A CycloneDX export has `bomFormat` and `components`. An SPDX export has `spdxVersion`. If those are missing, the file holds an error, not an SBOM.

Query parameters, all optional strings:

- `include_vulnerabilities`: `true` adds vulnerability data, and reachability or VEX data when available. Default `false`.
- `author`: SBOM author. Default `OWASP Foundation`.
- `project_group`, `project_name`, `project_version`, `project_id`: Dependency-Track project fields.

Notes:

- Exported ecosystems: crates, go, maven, npm, nuget, pypi, rubygems, spdx, cdx. Packages from other ecosystems are left out of the export. Say so when the project uses one.
- The SPDX export is SPDX 2.3 JSON with `packages[]`. The CycloneDX export has `components[]`, `dependencies[]`, and `vulnerabilities[]`.
- An OpenVEX export also exists: <https://docs.socket.dev/reference/exportopenvex>.
- For a CSV of a scan's alerts with license details, see <https://docs.socket.dev/reference/getorgfullscancsv>.

If `SOCKET_CLI_API_TOKEN` is not set, do not ask for the token in chat. Offer the local SBOM from Step 2, or ask the user to set the variable in their own shell.

## Step 4: Check a Scan Against the License Policy

`pnpm dlx socket scan report` checks a scan against the organization's policies. By default it checks only the security policy. Add `--license` to also check the license policy. The security check uses the legacy security policy, so after an organization moves to the new Policies model its result may not match the live policy (see `/socket-policy`, Step 5).

```shell
pnpm dlx socket scan report <SCAN_ID> --license --markdown
pnpm dlx socket scan report <SCAN_ID> --license --json --fold=version
pnpm dlx socket scan report <SCAN_ID> --license --markdown --short
pnpm dlx socket scan report <SCAN_ID> --license report.md
```

- `--fold none|pkg|version|file` groups alerts. Default `none`.
- `--report-level defer|ignore|monitor|warn|error` sets the lowest level to report. Default `warn`.
- `--short` prints only the health result.
- An output path ending in `.json` or `.md` picks the format. `-` means stdout.
- The command exits with code 1 when the scan is not healthy.

`pnpm dlx socket scan create --report` creates a scan, waits, and runs the same report with the license policy included. Use it when there is no scan yet.

License problems appear as alerts. Common types:

| Severity | Alert                        |
| -------- | ---------------------------- |
| Critical | License Policy Violation     |
| High     | Explicitly Unlicensed Item   |
| Medium   | Misc. License Issues         |
| Low      | Copyleft License             |
| Low      | No License Found             |
| Low      | Non-permissive License       |
| Low      | Unidentified License         |
| Low      | Ambiguous License Classifier |
| Low      | License exception            |

For a per-package license list, view the raw scan:

```shell
pnpm dlx socket scan view <SCAN_ID> --json scan.json
```

Each artifact has a `license` field. The full-scan API adds `licenseDetails` and `licenseAttrib` when called with `include_license_details`.

## Step 5: Show the Organization's License Policy

```shell
pnpm dlx socket license
pnpm dlx socket organization policy license --json
```

Text output is a table of license names and whether each is allowed. Use `--json` for the full result. The token needs the `license-policy:read` scope.

Explain the default: any license not set in the policy is treated as denied. New or unknown licenses therefore fail until someone moves them to Monitor or Allow. The policy is changed in the dashboard under **Settings > Legal**. The CLI cannot change it. Use `/socket-policy` for policy changes.

## Step 6: Load an Existing SBOM Into a Socket Scan

The full-scan API accepts CycloneDX uploads. The docs use `bom.cdx.json` as the file name.

- `pnpm dlx socket scan create` picks up pre-generated CycloneDX and SPDX files whose names match the patterns the API lists at <https://docs.socket.dev/reference/getsupportedfiles>.
- `pnpm dlx socket scan create --reach --reach-use-only-pregenerated-sboms` builds the scan only from pre-generated CycloneDX and SPDX files in the project. See `/socket-reachability`.

The CLI's own SBOM uploads use names ending in `cdx.json`, such as `socket-uv-cdx.json`, so the `socket-cdx.json` name from Step 2 should match. The supported-files list above is the authority. Check the scan's file list to confirm.

## Error Handling

- **Feature not on the plan:** if the CLI or API says SBOM export, license reports, or another feature is not available on the user's plan, tell the user that plainly and point to <https://socket.dev/pricing>. Do not guess which plan includes it.
- **401 or not signed in:** use `/socket-connect`.
- **403:** the token lacks the needed scope (`report:read` for export, `full-scans:list` for scan list and view, `full-scans:list` and `security-policy:read` for `scan report`, `license-policy:read` for the license policy) or is limited to other repos. The user creates a new token in the dashboard.
- **`Unknown argument(s)` from cdxgen:** the path is not written as `./name`, or the flag is not forwarded. See Step 2.
- **Empty or small SBOM:** the project type is wrong. Pass `-t` for each ecosystem.
- **Exit code 1 from `scan report`:** the scan failed policy. This is a result, not a crash. Show the alerts.

## Tips

- Use `-o` with a name that says the format, such as `sbom.cdx.json`, so readers know it is CycloneDX.
- Keep the default `pre-build` lifecycle. Only use `--lifecycle build` when the user accepts that project code will run.
- For SPDX, use the API export. Local generation is CycloneDX only.
- Commit SBOMs only if the user asks. They go stale with every dependency change.
- Delete or move a generated `socket-cdx.json` or `*.cdx.json` before `pnpm dlx socket scan create`, unless the user means it to be uploaded. A later scan uploads it as a pre-generated SBOM, and it goes stale.
- Delete a leftover `.socket.facts.json` before a scan without `--reach`. A later scan uploads it as an SBOM and carries stale reachability results.
- To fix license or security alerts, use `/socket-fix`, `/socket-dep-upgrade`, `/socket-dep-replace`, or `/socket-dep-patch`. To check one package's license first, use `/socket-inspect`.
- In CI, set `SOCKET_CLI_API_TOKEN` and run `pnpm dlx socket scan create --report`. See `/socket-setup`.
- Docs: <https://docs.socket.dev/docs/socket-cdxgen>, <https://docs.socket.dev/docs/socket-scan>, <https://docs.socket.dev/reference/exportcdx>, <https://docs.socket.dev/reference/exportspdx>, <https://docs.socket.dev/docs/license-policy>, <https://docs.socket.dev/docs/license>, upstream cdxgen <https://cdxgen.github.io/cdxgen>.
