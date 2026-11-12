---
name: socket-incident-response
description: Respond to a malware report or advisory about a package. Use it to confirm the report in Socket's threat feed, find out whether your projects use the bad version, contain it, check whether it ran, rotate secrets, and write up what happened.
metadata:
  category: protect
  requires: socket-connect
---

# Socket Incident Response

A malware report or advisory names a package and one or more bad versions. This skill walks through the response: confirm the report in Socket's threat feed, find out whether the project uses that package and version, find the dependency path that pulls it in, contain it, look for signs that the bad version was installed or ran, rotate secrets if it did, and report the result.

Work through the steps in order. Do not skip Step 5 just because the package is gone now. A package that was installed once can already have run its install scripts.

## When to Use

- A blog post, advisory, or alert names a malicious package or a compromised release
- Socket flagged a dependency as malware in a scan, a pull request, or the firewall
- The user asks "are we affected by this?" about a package and version
- The user wants to check the threat feed for new malware in an ecosystem
- A teammate installed a package that was later pulled from the registry
- The user needs a short incident write-up for their team

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

**Prefer the Socket MCP tools when connected.** Look for tools whose names end in `threat_feed`, `organizations`, `alerts`, `depscore`, `package_files`, `package_file_contents`, and `package_file_grep`. Match on the suffix, never on one hard-coded prefix (see `/socket-connect`, Step 1). If none are present, or a call fails with an authentication error, use `/socket-connect` to sign in through the browser. Never ask the user to paste a token into the chat, and never print one.

**Plans.** The threat feed is a beta feature that needs extra access on the organization. Do not tell the user which plan includes it. If the CLI, the MCP tool, or the API says the feature is not available (for example a 401 or 403 from the threat feed), say so plainly, link <https://socket.dev/pricing>, and continue with the steps that do not need it. Steps 3 to 8 work without the threat feed.

## Step 1: Collect the Report Details

Write down what the report says before you search. Ask the user for the link to the report if they have one.

- Ecosystem (npm, pypi, maven, and so on)
- Package name, including any scope, such as `@scope/name`
- Every bad version. Reports often list more than one.
- When the bad versions were published and when they were removed, if known
- Any indicators the report gives: file names, file hashes, domains, or install hooks
- A known safe version to roll back to

If the report names only a package and no version, treat every version published after the report's start date as suspect until Step 2 says otherwise.

## Step 2: Confirm the Report in Socket's Threat Feed

### 2a. With the MCP tool

1. Call `organizations` to get the `org_slug`.
2. Call `threat_feed` with `org_slug`, `ecosystem`, `name`, and `version`. Leave `filter` at its default, `mal` (malware, including possible malware).
3. Call it once. The threat feed is Socket's global list of flagged packages; the organization only grants access and does not narrow the results. If the user belongs to several organizations, use any one that has threat feed access. Use Step 3 to check each organization's own exposure.
4. If the response has more results, pass its `endCursor` (or `nextPageCursor`) value as `cursor` to get the next page.

Use only filter values the API accepts: `mal`, `vuln`, `typo`, `anom`, `spy`, `obf`, `dual`, `joke`, `tp`, `fp`, `u`, `c`. The tool description suggests some other short codes; they are not in the API's list, so do not use them. `obf` and `dual` work only through this tool's `filter`; the CLI cannot request them.

### 2b. With the CLI

```shell
pnpm dlx socket threat-feed npm --pkg <name> --version <x.y.z> --json --no-interactive --org <org-slug>
```

- **Always pass `--json`.** Without it the command opens a full-screen table that takes over the terminal (quit with `q`, `ESC`, or Ctrl-C). `--markdown` opens the same table.
- **Pass `--no-interactive`** so the command does not stop to ask for an organization.
- **Pass the name and version with `--pkg` and `--version`.** Positional arguments are matched against ecosystem and type keywords first, so a package named `mal`, `typo`, or `npm` would be read as a filter. Positional versions also miss prereleases such as `1.0.0-beta.1`.
- **Set the threat type with a positional argument**, such as `typo` in `pnpm dlx socket threat-feed npm typo --json`. In CLI 1.14.1 the value of `--filter` is never read. The CLI type keywords are `mal`, `vuln`, `typo`, `anom`, `spy`, `joke`, `tp`, `fp`, `u`, and `c`. Any other word, including `obf` and `dual`, becomes the package name filter. The CLI also lists `secret`, but the API does not accept it. With no type argument the API default, `mal`, applies.
- The help says the version filter is a prefix match and the package name is a substring match. Check each result's `purl` to make sure it is the package you mean.
- Positional ecosystems are gem, golang, maven, npm, nuget, and pypi. For others, such as cargo, composer, or swift, use `--eco <name>`.
- Set the page size with `--per-page` (alias `--pp`). `--page` is a cursor, not a page number: to get the next page, pass the `endCursor` (or `nextPageCursor`) value from the previous JSON response as `--page <cursor>`. Sort with `--direction asc` or `--direction desc`.

The CLI prints `{ "ok": true, "data": { ... } }` on success, and `{ "ok": false, "message": ..., "cause": ... }` with a non-zero exit code on failure.

### 2c. Read the results

Each item in `results` has these useful fields:

| Field              | What it tells you                                                        |
| ------------------ | ------------------------------------------------------------------------ |
| `purl`             | The exact package and version                                            |
| `threatType`       | For example `malware`, `possible_malware`, `typosquat`, `false_positive` |
| `description`      | Socket's summary of what the package does                                |
| `createdAt`        | When Socket first found the threat                                       |
| `publishedAt`      | When the version was published to the registry                           |
| `removedAt`        | When the registry removed it; `null` means it is still there             |
| `fileSha256`       | SHA-256 of the malicious file; use it as an indicator in Step 5          |
| `needsHumanReview` | `true` means Socket has not confirmed it yet                             |
| `locationHtmlUrl`  | The threat page on socket.dev; share it in the report                    |

Use `publishedAt` and `removedAt` as the exposure window. Any install of that version inside the window counts.

### 2d. If the threat feed is not available

Check the package version directly. This uses package scoring, not the threat feed:

```shell
pnpm dlx socket package shallow npm <name>@<x.y.z> --json
```

A malicious version shows alerts of type `malware` or `gptMalware` with severity `critical`. The MCP `depscore` tool gives the same kind of answer. For a full package review, use `/socket-inspect`.

If Socket has no record of the package yet, continue with the details from the report. Socket may not have finished its review.

## Step 3: Find Out Whether the Project Uses It

Check every place the package can come from. A clean `package.json` is not enough, because most malicious versions arrive as transitive dependencies.

1. **Lockfiles.** Search every lockfile in the repo for the package name, then check the versions next to each match:

   ```shell
   git ls-files | grep -E '(package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock)$' | xargs grep -n '<name>'
   ```

2. **Installed packages.** Read the version that is actually on disk. It can differ from the lockfile if someone ran an install without the lockfile:

   ```shell
   npm ls <name> --all
   ```

   With pnpm, run `pnpm why <name>`. With Yarn, run `yarn why <name>`.

3. **Other branches and open pull requests.** A bad version can sit in a feature branch or a Dependabot pull request. Search each branch's lockfiles too. On GitHub, pull requests from forks are not fetched by default, so the second command fetches them under `origin/pr/`:

   ```shell
   git fetch --all
   git fetch origin '+refs/pull/*/head:refs/remotes/origin/pr/*'
   git grep -n '<name>' $(git for-each-ref --format='%(refname)' refs/remotes) -- '*lock*'
   ```

4. **Other ecosystems.** Some campaigns re-publish the same payload to other registries. For example, one npm worm payload was also re-bundled into a Maven package. Check Python with `pip show <name>` or `uv tree`, and check any other manifests in the repo.

5. **Every repo in the organization.** Run `/socket-scan` on each repo you own, or use these:
   - The dashboard **Dependency Search** accepts `name`, `name@1.14` (prefix), or `name@1.14.1` (exact). See <https://docs.socket.dev/docs/dependency-search>.
   - The campaign page in the dashboard shows how many repos contain the affected versions, with an **Org Impact** tab listing repos and branches. See <https://socket.dev/blog/threat-intel-campaign-impact>.
   - The MCP `alerts` tool with `artifact_name` set to the package name lists open alerts on it across monitored repos.
   - `pnpm dlx socket organization dependencies --json` lists dependencies across monitored repos. It has no name filter, so page through with `--limit` and `--offset` and search the output.

If none of these find the bad version, the project is not affected now. Still check Step 5 for machines that installed it in the past.

## Step 4: Find the Dependency Path

Find which direct dependency pulls the package in. That tells you what to change in Step 6.

```shell
npm explain <name>
```

| Package manager | Command              | Docs                                                  |
| --------------- | -------------------- | ----------------------------------------------------- |
| npm             | `npm explain <name>` | <https://docs.npmjs.com/cli/v11/commands/npm-explain> |
| pnpm            | `pnpm why <name>`    | <https://pnpm.io/cli/why>                             |
| Yarn (Berry)    | `yarn why <name>`    | <https://yarnpkg.com/cli/why>                         |
| Yarn (classic)  | `yarn why <name>`    | <https://classic.yarnpkg.com/en/docs/cli/why>         |
| uv              | `uv tree`            | <https://docs.astral.sh/uv/reference/cli/#uv-tree>    |

Record each path, for example `my-app > some-lib@2.3.0 > bad-package@1.0.1`.

## Step 5: Check Whether the Bad Version Was Installed or Ran

Malware in npm packages usually runs from a `preinstall`, `install`, or `postinstall` script. These run during the install itself, before any code imports the package. See <https://docs.npmjs.com/cli/v11/using-npm/scripts>.

1. **Find every machine that installed it.** Developer laptops, CI runners, build servers, and container images. Check CI logs and lockfile history for installs between `publishedAt` and `removedAt`:

   ```shell
   git log -p -S '<x.y.z>' -- '*lock*'
   ```

   Search for the bad version, not the name. When a package already in the lockfile moves to the bad version, the count of its name does not change, so `-S '<name>'` misses that commit. Check that each matching hunk belongs to `<name>`.

2. **See what the bad version ships.** Use the MCP `package_files` tool with the ecosystem, `depname`, and `version`, then `package_file_contents` or `package_file_grep` to read its `package.json` scripts and payload files. This reads the files from Socket. It does not download or run anything.

3. **Look for the payload on disk.** Search `node_modules`, package manager caches, and home directories for the file names from the report or from `package_files`. Compare file hashes with the `fileSha256` from Step 2:

   ```shell
   shasum -a 256 <suspect-file>
   ```

4. **Do not trust a clean install directory.** Some payloads delete themselves after they run and swap in a clean `package.json` to remove the install script. A missing script or a missing payload file does not prove the script never ran.

5. **Decide.** If the bad version was installed with install scripts enabled, treat that machine and every secret it could read as exposed. Go to Step 7.

## Step 6: Contain It

1. **Remove or roll back.** Remove the package, or move to a known safe version.
   - If it is a direct dependency, set the safe version in the manifest and reinstall. Use `/socket-dep-upgrade` to upgrade with a security check, or `/socket-dep-replace` to swap it for another package.
   - If it is transitive, upgrade the parent from Step 4 to a release that no longer pulls it in, or force a safe version with your package manager's override field: [`overrides`](https://docs.npmjs.com/cli/v11/configuring-npm/package-json#overrides) for npm, [`resolutions`](https://yarnpkg.com/configuration/manifest#resolutions) for Yarn, or the overrides setting in pnpm's docs for pnpm.
2. **Clear local caches.** A cached copy can be reinstalled with no network request, and nothing can block that. Clear the cache on every affected machine with the commands in `/socket-firewall`, Step 2. Ask the user before running any of them.

   `pnpm store prune` removes only packages that no project uses, so run it after the bad version is gone from every project on that machine.

3. **Reinstall through the firewall.** Run the install as `sfw npm install` (or `sfw pnpm install`, `sfw pip install ...`). Socket Firewall Free blocks confirmed malware at download time. Use `/socket-firewall` to set it up and to read a block.
4. **Block it in policy.** Set the organization's malware alerts to **Block** so `pnpm dlx socket ci` (or `pnpm dlx socket scan create --report`) and pull request checks fail on it. Use `/socket-policy` to read and change the policy, and `/socket-pr-alerts` to handle the pull request side.
5. **Scan again.** Run `/socket-scan`, or create a scan with a report:

   ```shell
   pnpm dlx socket scan create . --tmp --report --json --no-banner --no-spinner
   ```

   `--tmp` keeps the scan out of the dashboard, as `/socket-scan` does by default. Drop it only if the user wants the scan saved. Check that no `malware` alerts remain in the report output.

## Step 7: Rotate Secrets

Socket does not publish one general rotation guide. The advice below is standard practice. Follow any steps the specific report gives first.

If Step 5 found that the bad version was installed with scripts enabled:

1. List every secret the affected machine or CI job could read: environment variables, `.npmrc` and other registry tokens, Git and GitHub tokens, cloud credentials, SSH keys, and CI secrets.
2. Revoke each one and issue a new one. Do this from a clean machine.
3. Check the logs of each service for use of the old credentials during the exposure window.
4. If a registry publish token was exposed, check the account's recent releases for versions nobody published on purpose. Consider moving to trusted publishing, which removes long-lived publish tokens.
5. Rebuild affected CI runners and containers from a clean image.

Never ask the user to paste a secret into the chat, and never print one while checking.

## Step 8: Report

Write a short summary for the team:

```text
Incident: <ecosystem>/<name> <bad versions>
Source: <report link>, <Socket threat page (locationHtmlUrl)>
Affected: <repos and branches>, or "not affected"
Dependency path: <path from Step 4>
Installed or ran: yes / no / unknown, and on which machines
Contained by: <removed, rolled back to x.y.z, override, policy set to Block>
Secrets rotated: <list, or "not needed">
Follow-up: <open items and owners>
```

If Socket's verdict looks wrong, send the false positive or false negative to support@socket.dev.

## Error Handling

- **Threat feed returns 401 or 403**: the token may lack the `threat-feed:list` permission, or the organization may not have threat feed access. Say so plainly, link <https://socket.dev/pricing>, and use Step 2d instead.
- **The CLI says no API token**: the user runs `pnpm dlx socket login` in their own terminal, or signs in through `/socket-connect`.
- **The CLI asks for an organization or exits early**: pass `--org <org-slug>` and `--no-interactive`.
- **Empty `results`**: the package may not be in the feed yet, or the filter excludes it. Try again without a version, or with a different type filter, and fall back to Step 2d.
- **429**: the API rate limit was hit. Wait, then retry with fewer pages.
- **`npm ls` exits non-zero**: it also does that for unrelated tree problems. Read the output for the package name before deciding.

## Tips

- Check the malware question first. Report a confirmed hit to the user before anything else.
- Check every bad version the report lists, not only the latest one.
- Trust the lockfile and the installed tree over `package.json`. Most bad versions arrive transitively.
- An install script runs at install time. Removing the package later does not undo what it did.
- Clear package caches before you reinstall. A firewall cannot block a cached copy.
- Use `--json` and `--no-interactive` with `pnpm dlx socket threat-feed`. Set the type with a positional argument, not `--filter`.
- Keep `/socket-firewall` on for installs after an incident, and use `/socket-inspect` before you add a replacement package.
- Docs: <https://docs.socket.dev/docs/socket-threat-feed>, <https://docs.socket.dev/docs/threat-feed>, <https://docs.socket.dev/reference/getorgthreatfeeditems>, and <https://docs.socket.dev/docs/sample-malware-packages> for safe test packages.
