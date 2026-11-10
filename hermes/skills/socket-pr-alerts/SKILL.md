---
name: socket-pr-alerts
description: Triage the alerts Socket for GitHub posts on a pull request and decide what to fix, replace, or accept. Use it when a PR has a failing "Socket Security" check or a Socket alerts comment.
metadata:
  category: analysis
  requires: socket-connect
---

# Socket PR Alerts

Socket for GitHub (the GitHub App) scans a pull request when it is opened or reopened, and when new commits are pushed. It looks at changes to supported manifest files and lockfiles, then posts checks and comments on the PR. This skill reads those results, explains each alert, and helps the user decide, alert by alert, whether to fix it, replace the package, or accept the risk.

## When to Use

- A PR has a failing `Socket Security: Pull Request Alerts` check
- A PR has a comment from `socket-security[bot]` and the user wants to know what it means
- The user asks whether a Socket alert on a PR is safe to ignore
- The user wants to ignore an alert on one PR, or accept it for all future PRs
- The user opened an alert from a PR comment in the Socket dashboard and wants help reading it

## Prerequisites

- The GitHub CLI (`gh`), signed in to an account that can read the repository.
- Socket for GitHub installed on the repository. If it is not, use `/socket-setup`.
- Optional: the hosted Socket MCP server for package lookups. If its tools are missing or return an authentication error, use `/socket-connect` to sign in through the browser. Never ask the user to paste a token into the chat.

This skill does not need the Socket CLI. To scan locally as well, set up the CLI with `/socket-setup`.

## Step 1: Read the Socket Checks

Socket adds up to two checks to a PR:

| Check                                  | What it means                                                                                                                                                                                           |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Socket Security: Pull Request Alerts` | Gates the merge. **Success**: no Block alerts. **Failure**: at least one Block alert. **Neutral**: Socket could not read every dependency file, so results may be incomplete.                           |
| `Socket Security: Project Report`      | A full scan of the dependencies at that commit. Its details link opens the report in the Socket dashboard. `githubApp.projectReportsEnabled: false` in `socket.yml` turns it off, so it may be missing. |

List the checks on the PR:

```shell
gh pr checks <number> -R <owner>/<repo> --json name,state,bucket,link,workflow
```

For the check output, get the head commit and read the check runs from the `socket-security` app:

```shell
gh pr view <number> -R <owner>/<repo> --json headRefOid -q .headRefOid
gh api repos/<owner>/<repo>/commits/<head-sha>/check-runs?per_page=100 --paginate --jq '.check_runs[]|select(.app.slug=="socket-security")|{name,conclusion,details_url,title:.output.title,summary:.output.summary}'
```

Trust `conclusion`, not the title. A failing Pull Request Alerts check can still have a title that ends in "Complete with warnings".

If the check is **Neutral**, tell the user the results may be incomplete before triaging anything.

## Step 2: Read the Socket Comments

Socket posts its comments on the main PR thread as `socket-security[bot]`:

```shell
gh api repos/<owner>/<repo>/issues/<number>/comments --paginate --jq '.[]|select(.user.login=="socket-security[bot]")|.body'
```

There are usually two comments:

1. **Dependency overview.** Starts with "Review the following changes in direct dependencies." It is a table of added and updated direct dependencies with Supply Chain Security, Vulnerability, Quality, Maintenance and License scores. It is context, not a list of problems.
2. **Alerts.** A table with Priority, Alert and Action columns. The Priority icon shows a priority score, such as "Priority 140 (Low)". It is not the alert's severity. The PR comment does not show severity; get it from the alert page linked in the comment. `depscore` returns only 0-100 scores, not alert severity. Each alert is a collapsible block with:
   - the alert title, the ecosystem, and the package
   - **From:** the dependency path that pulls the package in
   - links to the package, the alert, and the alert type's page under `https://socket.dev/alerts/`
   - next steps, a suggestion, and the exact ignore command for that package

If a row says "See N more rows in the dashboard", the comment is truncated. Open the "View full report" link at the end of the comment to see every alert.

The PR shows only alerts whose action is **Block** or **Warn**:

| Action  | On the PR | Fails the check |
| ------- | --------- | --------------- |
| Block   | yes       | yes             |
| Warn    | yes       | no              |
| Monitor | no        | no              |
| Ignore  | no        | no              |

The organization's security policy sets the action for each alert type, so the same alert can be Block in one organization and Warn in another.

## Step 3: Understand Each Alert

Socket groups alerts into five categories: Supply chain risk, Vulnerability, Quality, Maintenance and License. Each has Critical, High, Medium and Low severities. See [package issues](https://docs.socket.dev/docs/package-issues) and the [alert list](https://socket.dev/alerts).

| Category and severity   | What it means                                                    |
| ----------------------- | ---------------------------------------------------------------- |
| Supply chain, Critical  | Known malware, typosquats, HTTP dependencies and similar threats |
| Supply chain, High      | Unsafe until someone inspects it                                 |
| Vulnerability, Critical | Update to a fixed version now                                    |
| Vulnerability, High     | Update as soon as you reasonably can                             |
| License, Critical       | Replace the package now                                          |
| License, High           | Needs legal review                                               |

For more detail on a package, use `/socket-inspect`. With the Socket MCP server connected, find the `depscore` tool by its suffix and call it for the package. To read the package's code behind an alert such as Obfuscated code or Install-time scripts, use the `package_files`, `package_file_contents` and `package_file_grep` tools.

## Step 4: Check Reachability on the Alert Details Page

The Priority icon in each alert row, and the "This alert" link in the alert's block, open that alert in the PR's diff scan in the Socket dashboard. Reachability dependency chains are on the **Alert Details** page for the organization's alerts in the dashboard. That page shows:

- an overview of the alert: what it is, its severity and category
- detected instances, sorted by a priority score that uses reachability, fixability and other factors
- reachability dependency chains: the path from the project's code to the vulnerable package, and where reachability stops
- the alert's status, triage action and notes

For a vulnerability, the chain answers three questions: is it reachable, which dependency brings it in, and what to update to remove it. See [the Alert Details page](https://socket.dev/blog/introducing-the-alert-details-page) and [reachability results](https://docs.socket.dev/docs/reachability-results).

The dashboard shows a label. The API returns the type in parentheses.

| Verdict                                                                                                                       | What to do                                                                                                                                  |
| ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Reachable (`reachable`)                                                                                                       | Fix it                                                                                                                                      |
| Potentially reachable (`maybe_reachable`)                                                                                     | A chain exists from a direct dependency down to the package. Treat it as reachable                                                          |
| Unreachable (`unreachable`)                                                                                                   | No path to the vulnerable code was found. Lower priority; accepting it is reasonable if you record why. It is not proof the package is safe |
| Pending precomputation (`pending`)                                                                                            | Needs a new scan                                                                                                                            |
| Direct Dependency (`direct_dependency`)                                                                                       | Precomputed analysis cannot judge direct dependencies. Treat it as reachable                                                                |
| Not yet supported (`missing_support`), Not determinable (`undeterminable_reachability`), Unknown (`unknown`), Error (`error`) | No verdict. Treat it as possibly reachable, not as safe                                                                                     |

The dashboard needs a login. If the agent cannot open a page, give the user the link and ask what the page shows. To run full application reachability yourself, use `/socket-reachability`. If the CLI or dashboard says reachability is not available on the user's plan, tell the user plainly and point to <https://socket.dev/pricing>.

## Step 5: Decide Fix, Replace, or Accept

Follow [Socket's guidance](https://docs.socket.dev/docs/what-to-do-with-socket-alerts) for each alert:

| Alert                                                    | Decision                                                                                                                               |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Known malware, protestware or troll                      | Remove the package now and pick a different one: `/socket-dep-replace`. For a malware campaign, also see `/socket-incident-response`   |
| Potential typosquat                                      | Confirm the package is the one the user meant. If not, replace it                                                                      |
| Vulnerability with a fixed version, reachable or unknown | Upgrade: `/socket-fix` for the fix flow, or `/socket-dep-upgrade` for one package. Use `/socket-dep-patch` when no upgrade is possible |
| Vulnerability that is unreachable                        | Accepting the risk is reasonable. Record why                                                                                           |
| Install scripts or native code                           | Audit the package source before accepting                                                                                              |
| Telemetry                                                | Follow the alert's instructions to turn it off                                                                                         |
| License, High or Critical                                | Get a legal review, or replace the package                                                                                             |
| The same harmless alert keeps showing up across PRs      | Change the policy: `/socket-policy`                                                                                                    |

When the alert comes from a transitive package, the **From:** path in the comment or the dependency chain on the Alert Details page names the direct dependency to upgrade or replace.

Present the decisions to the user as a short table: package, alert, action, severity, decision, and reason. Let the user confirm before changing code.

## Step 6: Accept an Alert on This PR Only

To accept an alert for this PR only, a repository contributor posts a comment on the main PR thread. The command must be the very first thing in the comment:

```text
@SocketSecurity ignore npm/<package>@<version>
```

Use the exact command from the alert's own block in the Socket comment. It names the ecosystem, package and version. To ignore every alert on the PR:

```text
@SocketSecurity ignore-all
```

- Ignoring reruns the PR alert report without the ignored package.
- To undo it, edit or delete the comment that ignored the package.
- The command applies to this PR only. The same alert comes back on future PRs.

Posting the comment sends a message as the user. Draft the comment, show it, and ask before posting. After the user approves, post it:

```shell
gh pr comment <number> -R <owner>/<repo> --body '@SocketSecurity ignore npm/<package>@<version>'
```

See [ignoring pull request alerts](https://docs.socket.dev/docs/ignoring-pull-request-alerts).

## Step 7: Accept an Alert for All Future PRs

To accept an alert beyond this PR, change its triage state in the dashboard, or create an **alert resolution**. A resolution records a reason (Remediated, False positive, Tolerable risk, or Other) and a scope. Future alerts that match the scope are resolved automatically. Resolutions are checked before policy rules.

- Use the narrowest scope: this repository, this package and version, and this alert type.
- An org-wide scope on alert type only is rarely what you want.
- To undo a resolution, delete it.

The resolution API is documented at [alert resolutions](https://docs.socket.dev/docs/alert-resolutions), with a dry-run mode for writes. A resolution changes shared state for the organization, so confirm the scope and reason with the user before creating one.

To change how a whole class of alerts is handled, for example to move an alert type from Block to Warn, use `/socket-policy` instead.

## Step 8: Hand Off and Re-check

1. Hand each "fix" or "replace" decision to the matching skill: `/socket-fix`, `/socket-dep-upgrade`, `/socket-dep-replace`, or `/socket-dep-patch`.
2. Push the changes to the PR branch. Socket scans again on every push.
3. Repeat Step 1 until `Socket Security: Pull Request Alerts` passes, or every remaining alert has a recorded decision.

To make this check required before merging, add `Socket Security: Pull Request Alerts` as a required status check in branch protection. See [enable branch protection](https://docs.socket.dev/docs/enable-branch-protection).

## Error Handling

- **No Socket checks or comments on the PR**: Socket for GitHub may not be installed, the PR may not change a manifest or lockfile, `socket.yml` (or `socket.yaml`) may turn PR alerts off (`githubApp.enabled`, `githubApp.pullRequestAlertsEnabled`, `githubApp.disableCommentsAndCheckRuns`, `triggerPaths`, or `githubApp.ignoreUsers` for bot authors), or the organization setting "Disable Comments and Check Runs" may be on and not overridden in that file. Check the file at the repository root, ask an organization admin about the setting, or use `/socket-setup`.
- **The ignore command did nothing**: Check that the command is the first thing in the comment, that it is on the main PR thread and not a review comment, and that the author is a repository contributor.
- **`gh` returns 401 or 404**: The account cannot read the repository. Ask the user to sign in with `gh auth login` in their own terminal.
- **A Socket tool needs authentication**: Use `/socket-connect`. Do not ask for a token in the chat.

## Tips

- Read every alert before ignoring anything. `@SocketSecurity ignore-all` hides every alert on the PR, including ones nobody has read.
- Never ignore malware or a typosquat. Remove the package.
- Prefer a narrow resolution over a policy change, and a policy change over repeated ignore comments.
- The Socket MCP `alerts` tool lists the organization's latest alerts, not the alerts on one PR. Use the PR comment for PR triage.
- The CLI has no command to ignore or resolve alerts. Use the PR comment or the dashboard.
- Use `/socket-scan` to scan locally before pushing, and `/socket-firewall` to block bad packages at install time.
- Socket's documentation index for agents is at <https://docs.socket.dev/llms.txt>.
