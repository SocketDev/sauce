---
name: socket-policy
description: Edit a repository's socket.yml and change how Socket acts on alerts (block, warn, monitor, ignore). Use it to exclude paths from scans, tune the GitHub App per repo, check the file against the schema, or find and change the organization's security and license policy.
metadata:
  category: setup
  requires: socket-connect
---

# Socket Policy

Socket decides what to do with each alert in two places. The repository's `socket.yml` sets per-repo options: which paths to skip, GitHub App behavior, and a deprecated per-alert override. The organization's security and license policy lives on Socket's servers, and you change it in the dashboard or through the REST API. This skill edits `socket.yml`, checks it, and shows where to change the organization policy.

## When to Use

- Add, fix, or review a `socket.yml` or `socket.yaml` file
- Stop Socket from scanning test fixtures, examples, or vendored folders
- Turn GitHub App pull request comments, dependency overviews, or reports on or off for one repo
- Make Socket stop reporting an alert type, or start blocking one
- Read the organization's security or license policy from the CLI
- Find out why a `socket.yml` setting has no effect
- Migrate a version 1 `socket.yml` to version 2

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

Editing `socket.yml` needs no account. Reading or changing the organization policy does. Never ask the user to paste a token into the chat, and never print one.

## Step 1: Decide Where the Change Belongs

| Goal                                                   | Where to change it                                |
| ------------------------------------------------------ | ------------------------------------------------- |
| Skip folders or files in one repo                      | `socket.yml` `projectIgnorePaths`                 |
| Only run PR alert scans when certain files change      | `socket.yml` `triggerPaths` (GitHub App only)     |
| Turn GitHub App features on or off for one repo        | `socket.yml` `githubApp`                          |
| Block, warn, monitor, or ignore an alert type org-wide | Organization security policy (dashboard or API)   |
| Allow or deny licenses                                 | Organization license policy (Settings > Legal)    |
| Ignore one flagged package in one pull request         | `@SocketSecurity ignore` comment on that PR       |
| Turn one alert type off for one repo                   | `socket.yml` `issueRules` (deprecated, see below) |

A repo's `socket.yml` takes precedence over the organization's policy rules. Prefer the organization policy for anything that should apply to more than one repo.

## Step 2: Find the Existing File

Look in the repository root for `socket.yml`, then `socket.yaml`. The docs say the file belongs in the repository root. If both exist, `socket.yml` wins.

The CLI searches more widely: it starts in the current directory and walks up to the filesystem root, and in each directory it tries `socket.yml` before `socket.yaml`. Running the CLI from a subfolder can pick up a different file than the GitHub App does. Keep a single file at the repository root.

If the file has no `version` key and uses `ignore`, `issues`, `beta`, or top-level `enabled` keys, it is version 1. Migrate it:

1. Add `version: 2`
2. Rename `ignore` to `projectIgnorePaths`
3. Rename `issues` to `issueRules`
4. Move `enabled`, `projectReportsEnabled`, and `pullRequestAlertsEnabled` under `githubApp`
5. Remove `beta`

## Step 3: Write socket.yml

Start from this example from the Socket docs and remove what the user does not need:

```yaml
version: 2
projectIgnorePaths:
  - 'ignored-folder'
  - 'foo/bar/package.json'
triggerPaths:
  - 'package.json'
  - 'package-lock.json'
issueRules:
  unresolvedRequire: false
githubApp:
  enabled: true
  dependencyOverviewEnabled: true
  ignoreUsers: ['aBotOnGitHub']
  disableCommentsAndCheckRuns: false
```

### Keys

- `version` (required): set it to `2`.
- `projectIgnorePaths`: list of gitignore-style patterns for paths Socket skips. Socket always ignores `.git`, `.log`, `.nyc_output`, `.sass-cache`, `.yarn`, `bower_components`, `coverage`, and `node_modules`. Quote any pattern that contains `*` or starts with an exclamation mark.
- `triggerPaths`: gitignore-style patterns, default `["*"]`. The GitHub App runs a PR alert scan only when a file changed in the PR matches. The CLI ignores this key.
- `issueRules`: map of alert type to `true` or `false`. **Deprecated**: Socket plans to replace it with repository labels and Policies. Alert types you leave out follow the organization settings.
- `githubApp.enabled`: default `true`. `false` turns the GitHub App off for this repo and overrides the other `githubApp` settings.
- `githubApp.pullRequestAlertsEnabled`: default `true`.
- `githubApp.dependencyOverviewEnabled`: default `true`. It needs `enabled` and `pullRequestAlertsEnabled`.
- `githubApp.projectReportsEnabled`: default `true`.
- `githubApp.ignoreUsers`: list of GitHub users whose PRs the app skips. Default `[]`.
- `githubApp.disableCommentsAndCheckRuns`: default `false`. Overrides the organization setting for this repo.

The schema package also accepts `githubApp.authenticatedProjectReports`, but the docs do not describe it. Do not add it unless the user asks.

For GitLab, the GitLab app (beta) reads only `projectIgnorePaths` and `gitlabApp.enabled`, `gitlabApp.dependencyOverviewEnabled`, `gitlabApp.pullRequestAlertsEnabled`, and `gitlabApp.commitStatusEnabled`. Keep `version: 2` so the CLI and the GitHub App still accept the file.

### What the CLI uses

- `pnpm dlx socket scan create`, `pnpm dlx socket scan reach`, and `pnpm dlx socket fix` apply `projectIgnorePaths` when they collect manifest files. The CLI reads the patterns as a .gitignore at the project root.
- The package manager wrappers (`pnpm dlx socket npm`, `pnpm dlx socket npx`, `pnpm dlx socket pnpm`) apply `issueRules`. `false` hides that alert type. `true` does not bring back an alert type the organization policy ignores, because the wrappers never receive those alerts. These wrappers are the older install path; for blocking at install time, prefer `sfw` (see `/socket-firewall`).
- For a one-off scan, `pnpm dlx socket scan create --exclude-paths <glob>` excludes paths without editing the file. Its patterns are anchored globs relative to the current directory and do not support negation with a leading exclamation mark, so they differ from `projectIgnorePaths`.

## Step 4: Check the File

The Socket CLI has no command that validates `socket.yml`. Check it yourself:

1. Make sure the YAML parses and `version: 2` is present.
2. Compare every key against the list in Step 3. Watch for typos: the CLI's parser (`@socketsecurity/config`) **silently drops** keys it does not know. It does not report them.
3. Know that the CLI's parser only knows `version`, `projectIgnorePaths`, `issueRules`, and `githubApp` with `enabled`, `ignoreUsers`, `projectReportsEnabled`, `pullRequestAlertsEnabled`, `dependencyOverviewEnabled`, and `authenticatedProjectReports`. It drops `triggerPaths`, `githubApp.disableCommentsAndCheckRuns`, and `gitlabApp` too, but those keys are documented and the GitHub or GitLab app reads them. A clean parse does not prove every key took effect.
4. If the project already has `@socketsecurity/config` installed, parse the file with it. The call throws on bad YAML, and throws an error with a `validationErrors` list when the content does not match the schema:

```shell
node -e "require('@socketsecurity/config').parseSocketConfig(require('fs').readFileSync('socket.yml', 'utf8')); console.log('ok')"
```

Do not install packages just to run this check. If the package is not present, check by hand.

If the CLI cannot parse `socket.yml`, it treats the repo as if it had no file and keeps going. No error stops the scan. If ignored paths still show up in scan results, the file probably failed to parse.

## Step 5: Read the Organization Policy

The hosted Socket MCP tools from `/socket-connect` do not expose policy settings. Use the CLI after the user signs in with `/socket-connect`:

```shell
pnpm dlx socket organization policy security --org <org-slug>
pnpm dlx socket organization policy license --org <org-slug>
```

- `policy security` prints the default policy setting and a table of alert types and their actions. It needs the `security-policy:read` scope. Add `--json` for machine-readable output.
- `policy license` prints a table of licenses and whether each is allowed. It needs the `license-policy:read` scope.
- Both commands read the legacy policy endpoints. After an organization moves to the new Policies model, those endpoints become a frozen archive, so the output may not match the live policy. The CLI has no command for the new alert policies.

To see how a scan fares against the policy, use `/socket-scan`, or run a report on an existing scan:

```shell
pnpm dlx socket scan report <SCAN_ID> --short
```

It prints `OK` or `ERR`, and exits with code 1 when any alert in the scan has the Block (`error`) action. `--report-level` changes which alerts are listed, not the exit code.

`scan report` checks the scan against the legacy security policy. After an organization moves to Policies, it still uses the archived legacy policy, so its `OK` or `ERR` may not match the live policy.

## Step 6: Change Alert Actions

Socket has four alert actions:

| Action  | API value | Effect                                                               |
| ------- | --------- | -------------------------------------------------------------------- |
| Block   | `error`   | Shown to developers. Fails the PR check; the CLI exits with an error |
| Warn    | `warn`    | Shown to developers in PR comments and CLI warnings                  |
| Monitor | `monitor` | Not shown to developers in PR comments or CLI warnings               |
| Ignore  | `ignore`  | The alert is ignored                                                 |

### Policies model

Socket is moving organizations to Policies (<https://docs.socket.dev/docs/policies>). A policy starts from a baseline preset (Essential, Balanced, Comprehensive, or None) and adds an ordered list of rules. The first matching rule wins. Each repo belongs to exactly one policy through a repository label. Socket Firewall (see `/socket-firewall`) uses the Default policy. Rules select alerts with Vigil selectors (<https://docs.socket.dev/docs/vigil>).

The rollout is per organization. Until an organization confirms the move, policy and rule writes return 409. After the move, legacy security-policy writes return 409. Socket finalizes the move automatically after a set window, so every organization ends up on Policies.

Check the migration status before you change anything (needs the `alert-policy:list` scope):

```shell
curl -u "$SOCKET_CLI_API_TOKEN:" https://api.socket.dev/v0/orgs/<org-slug>/alert-policies/migration/status
```

The `state` field is one of:

- `null`: the migration is not enabled yet. Organizations created after Policies launched also return `null`; they already use Policies.
- `pending`: the preview is being prepared. Legacy policy still decides alerts.
- `previewing`: the preview is ready in the dashboard. Legacy policy still decides alerts.
- `accepted` or `auto_finalized`: the organization is on Policies. Policy and rule writes work. Legacy writes return 409.

The response also has `alert_policies_enabled` and `legacy_evaluation_enabled`, which say which configuration decides alerts right now. Details: <https://docs.socket.dev/docs/alert-policy-migration-status>.

### In the dashboard

Check the migration status first (see above).

- Before the migration: **Settings > Security Policy**. Pick a preset, then set each alert type to Block, Warn, Monitor, Ignore, or Inherit. "Remove Custom Settings" clears the overrides. Socket removes this page when the organization moves to Policies.
- After the migration: edit policies and rules on the **Policies** page (<https://docs.socket.dev/docs/policies>).
- License policy: **Settings > Legal**.

### With the REST API

The CLI has no command for Policies, so the REST API with an organization-wide API token is the only scripted way to read or change them. This is a departure from the usual `/socket-connect` sign-in: `pnpm dlx socket login` does not cover these calls. Repo-restricted tokens get 403. Have the user set the token as `SOCKET_CLI_API_TOKEN` in their own shell or CI secret store (the same variable `/socket-sbom` uses for its API calls), never in the chat, and never print it.

Always try an alert-policies or rules write with `?dry_run=true` first: Socket returns 200 with `dry_run: true` and saves nothing. Only those endpoints support dry run.

List alert policies (the default policy comes first):

```shell
curl -u "$SOCKET_CLI_API_TOKEN:" https://api.socket.dev/v0/orgs/<org-slug>/alert-policies
```

Add a rule to a policy as a dry run:

```shell
curl -u "$SOCKET_CLI_API_TOKEN:" -X POST \
  "https://api.socket.dev/v0/orgs/<org-slug>/alert-policies/<policy-id>/rules?dry_run=true" \
  -H "Content-Type: application/json" \
  -d '{"name":"Block critical CVEs","action":"error","vigil_selector":{"finding.alertType":"criticalCVE"}}'
```

Show the user the dry-run response. Ask before you send the real write without `dry_run`, because it changes the policy for every repo in that policy.

Scopes: `alert-policy:list` and `alert-policy:read` to read, `alert-policy:create`, `alert-policy:update`, and `alert-policy:delete` to write. Other endpoints:

- `PUT /orgs/{org}/alert-policies/{policy_id}` (or `default`) sets `name`, `description`, `repository_ids`, and `baseline`
- `PUT` and `DELETE /orgs/{org}/alert-policies/{policy_id}/rules/{rule_id}` edit or remove a rule
- Legacy: `GET` and `POST /orgs/{org}/settings/security-policy` read and write the old per-alert-type policy (scopes `security-policy:read`, `security-policy:update`). The legacy `POST` has **no dry run** and saves immediately, changing the policy for the whole organization. Show the user the exact request body and get an explicit yes before you send it. After the migration it returns 409.

Full reference: <https://docs.socket.dev/docs/security-policy-api> and <https://docs.socket.dev/docs/dry-run-writes>. License policy: <https://docs.socket.dev/reference/viewlicensepolicy> and <https://docs.socket.dev/reference/updateorglicensepolicy>.

### For one pull request

To ignore a flagged package in one PR, a contributor posts an `@SocketSecurity ignore` comment on the main PR thread. This is not a policy change. Use `/socket-pr-alerts`, Step 6, for the exact command and the rules.

## Error Handling

- **Ignored paths still scanned**: the CLI may have failed to parse `socket.yml` and fallen back to no config. Check the YAML and keys (Step 4). Also check that the CLI ran from inside the repo, since it walks up from the current directory.
- **A key has no effect in the CLI**: the CLI drops unknown keys, and it never reads `triggerPaths` or `disableCommentsAndCheckRuns`. Those apply only in the GitHub App.
- **403 from a policy endpoint**: the token is restricted to some repos, or lacks the scope. The user needs an organization-wide token with the right scope.
- **409 from a policy endpoint**: one of three causes. A policy or rule write before the migration is confirmed, a legacy security-policy write after it, or a duplicate policy name. Check the migration status endpoint (Step 6).
- **Feature not available on the plan**: tell the user plainly that Socket says the feature is not on their plan, and point them to <https://socket.dev/pricing>. Do not guess which plan includes it.
- **401 or not signed in**: use `/socket-connect`.

## Tips

- Keep one `socket.yml` at the repository root. Do not add one per package in a monorepo.
- Set org-wide alert actions in the organization policy, not in each repo's `issueRules`. `issueRules` is deprecated.
- Quote glob patterns in YAML, especially ones with `*` or `!`.
- Re-read the file after editing: a misspelled key fails silently.
- Dry-run every alert-policies and rules write and show the result before the real write. Legacy security-policy writes have no dry run: show the body and ask first.
- To fix the alerts a policy surfaces, use `/socket-fix`, `/socket-dep-upgrade`, `/socket-dep-patch`, or `/socket-dep-replace`. To check a package first, use `/socket-inspect`. Reachability results (`/socket-reachability`) help decide which alerts matter.
- Schema source: <https://www.npmjs.com/package/@socketsecurity/config> (its repo, <https://github.com/SocketDev/socket-config-js>, is archived). Docs: <https://docs.socket.dev/docs/socket-yml>.
