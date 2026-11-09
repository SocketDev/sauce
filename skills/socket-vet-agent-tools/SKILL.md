---
name: socket-vet-agent-tools
description: Vet an MCP server, agent skill, or plugin before you install it into a coding agent. Use it to check the packages behind it with Socket, read its published files, review its hooks, scripts, and prompt text, and install it pinned through Socket Firewall.
---

# Vet Agent Tools

MCP servers, skills, and plugins run code and give instructions to your coding agent. Check them before you install them.

This skill combines existing Socket checks. It is not a dedicated MCP, skill, or plugin scanner. Socket has no CLI command, MCP tool, or API call that scans an MCP server config, a plugin, or a skill repository as a whole. So the skill does this instead:

- Scores and alerts for the npm or PyPI packages that most MCP servers ship as
- A static read of those packages' published files
- The Socket audit that skills.sh shows for skills listed there
- A manual review of a skill or plugin checkout, plus a Socket scan of its dependency manifests
- A pinned install through Socket Firewall (`sfw`)

Say this plainly to the user. A clean result means "no known problems found", not "safe".

## When to Use

- Before adding an MCP server to Claude Code, Cursor, Codex, Gemini CLI, or another agent
- Before installing a skill or plugin from a git repository or a marketplace
- When an MCP config uses `npx -y` or `uvx` and you want to know what it will run
- When a skill or plugin adds hooks, monitors, scripts, or extra MCP servers
- When a skill on skills.sh shows a Socket "Fail" result and you want to know why
- When re-checking a tool after it updates

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

**Prefer the Socket MCP tools when connected.** Look for Socket MCP tools by suffix: `depscore`, `package_files`, `package_file_contents`, `package_file_grep`, `organizations`, `threat_feed`. The full name depends on how the server was added, for example `mcp__socket-mcp__depscore` or `mcp__plugin_socket-connect_socket__depscore`. Match the suffix, never one hard-coded prefix. If they are missing or return an authentication error, use `/socket-connect` to sign in through the browser.

`package_files` needs Socket access. `package_file_contents` and `package_file_grep` take a file hash from `package_files` instead of calling the Socket API, but the hosted server still needs sign-in for every call. Not every Socket MCP server may expose the file tools. If they are missing, skip Step 4 and say so in the report.

Never ask the user to paste a token into the chat, and never print one.

## Step 1: Identify What Is Being Installed

Work out what will actually run. Ask the user for the install command, the MCP config entry, or the repository URL.

| Form                                     | What it really is                    | Go to          |
| ---------------------------------------- | ------------------------------------ | -------------- |
| MCP config with `npx -y <pkg>`           | An npm package, installed at launch  | Steps 2-4, 7   |
| MCP config with `uvx <pkg>`              | A PyPI package, installed at launch  | Steps 2-4, 7   |
| MCP config with a remote `url`           | A server someone else runs           | Step 6 (notes) |
| Skill installed from skills.sh           | A git repository Socket has audited  | Steps 5-6      |
| Skill or plugin from a git repository    | Files plus any packages they install | Steps 6, 2-4   |
| Plugin manifest with a `.mcpb` or `.dxt` | A bundle downloaded and unpacked     | Step 6 (notes) |

For each package, record the ecosystem, the exact name, and the exact version. `npx -y` and `uvx` without a version pull the latest release on every launch, with no lockfile. A pinned top-level version still lets its dependencies float.

## Step 2: Score Each Package With Socket

**With the Socket MCP server:** call `depscore` with every package at once:

```json
{
  "packages": [
    {
      "ecosystem": "npm",
      "depname": "@modelcontextprotocol/server-filesystem",
      "version": "2.0.1"
    },
    { "ecosystem": "pypi", "depname": "mcp-server-fetch", "version": "unknown" }
  ]
}
```

`version: "unknown"` resolves to the latest version. `depscore` returns scores only (license, maintenance, quality, supplyChain, vulnerability) and a report link. It does not list alerts, and a missing score is not a safety verdict. A very low `supplyChain` score means you must get the alert list in Step 3 before going on.

**With the Socket CLI:** get scores and the full alert list in one call. It accepts several packages:

```shell
pnpm dlx socket package shallow npm @modelcontextprotocol/server-filesystem@2.0.1 --json
pnpm dlx socket package shallow pypi mcp-server-fetch --json
```

The CLI needs Socket account access. If it says you need an API token, ask the user to run `pnpm dlx socket login` in their own terminal (see `/socket-connect`).

## Step 3: Check Alerts, Malware First

From `pnpm dlx socket package shallow --json`, read `data[].alerts`. Each alert has `type`, `severity`, `category`, and `action`.

**Stop if you see `malware` or `gptMalware`.** Report it first, using the block in Output Format, and do not install.

**With only the Socket MCP server:** `depscore` lists no alerts, so check for malware with the threat feed. Call `organizations` to get your `org_slug`. Then call `threat_feed` with `org_slug`, `ecosystem`, `name`, and `version`, and leave `filter` at its default, `mal` (malware). Treat any hit as malware. The threat feed does not give the full alert list. For that, use the CLI command above.

Then look for alerts that matter for an agent tool: `networkAccess`, `obfuscatedFile`, install scripts, shell access, and any alert with `action: "error"`.

For what the package can do, get the deep score for one package:

```shell
pnpm dlx socket package score npm @modelcontextprotocol/server-filesystem@2.0.1 --json
```

Read `data.self.capabilities` and `data.transitively.capabilities`. Values such as `net`, `shell`, `fs`, `env`, and `eval` tell you what the code can reach. Compare them with what the tool claims to do. A "read the weather" server that uses `shell` and `fs` needs a closer look.

For more detail on any one package, use `/socket-inspect`.

## Step 4: Read the Published Files

Static review of the package as published finds things scores miss, such as tool poisoning in tool descriptions.

1. Call `package_files` with `ecosystem`, `depname`, and an exact `version`. It returns a file tree. The token after each file size is that file's hash. For PyPI, pass `artifactId` (the wheel or sdist filename) when the version ships more than one file.
2. Call `package_file_grep` with a hash and a regex `pattern`. Set `caseInsensitive: true` for these patterns; matching is case-sensitive by default. Set `contextLines` (0-5) to see nearby lines. Useful patterns:
   - `description:` - the text the agent will read for each tool
   - `<IMPORTANT>|ignore (all|previous)|do not tell|system prompt` - hidden instructions in tool text
   - `child_process|execSync|spawn|subprocess|os\.system` - shell execution
   - `fetch\(|https?://|XMLHttpRequest|requests\.` - network calls and hard-coded hosts
   - `\.ssh|\.aws|\.npmrc|\.env|settings\.json|mcp\.json` - reads of credentials or agent config
   - `bcc|webhook|eval\(|Buffer\.from\(.{0,40}base64` - exfiltration and obfuscation
3. Call `package_file_contents` with a hash to read a whole file. It refuses binary files. For a file over 1 MB it returns only the first 1 MB and says so; `package_file_grep` also searches only the first 1 MB.

Also read the package manifest for install scripts (`preinstall`, `install`, `postinstall`).

Static review cannot prove what tools a server lists at runtime. A server can change its tool list after you approve it. Say so in the report.

## Step 5: Check the Socket Audit on skills.sh

Socket audits skills listed on skills.sh, using static analysis and LLM review of the instructions, and rescans them when they change. The result is shown on skills.sh. It is not available through the Socket CLI, MCP tools, or API.

Open this page for the skill:

```text
https://skills.sh/<owner>/<repo>/<skill>/security/socket
```

It shows **Pass** or **Fail**, the audit date, and four categories: malicious behavior, security concerns, code obfuscation, and suspicious patterns. Its audit metadata shows when it was analyzed and a Socket package URL that ends in a content hash. That hash is not a git commit. Compare the audit date with the date of the commit you will install. If the skill changed after the audit date, the audit does not cover your copy.

Socket's AI Skills alert types are listed at <https://docs.socket.dev/docs/alert-types>. High severity ones include pre-execution shell commands, command injection, data exfiltration, hard-coded secrets, prompt injection, and tool chaining.

If the skill is not on skills.sh, go to Step 6.

## Step 6: Review a Skill or Plugin Checkout

Clone the repository at a fixed commit. Do not install it yet. Read these files. They are where code and instructions enter the agent.

**Skills (`SKILL.md` and its folder):**

- Any `` !`command` `` that follows whitespace (including mid-line) and any ` ```! ` fenced block in `SKILL.md`. Claude Code runs these on the host when the skill loads.
- `allowed-tools` in the frontmatter. It pre-approves commands.
- `hooks` in the frontmatter. Claude Code registers these when the skill is invoked, and they keep running for the rest of the session.
- Scripts the skill tells the agent to run, and every URL they reach
- Text that tells the agent to hide actions, skip confirmation, read secrets, or ignore other instructions

**Plugins:**

- The manifest, `plugin.json` in the plugin's `.claude-plugin` folder (optional). Check `hooks`, `mcpServers`, `lspServers`, `experimental.monitors`, and `dependencies` (other plugins it pulls in).
- Hooks in the plugin's `hooks/hooks.json`. A `SessionStart` hook runs every time a session starts.
- MCP servers in `.mcp.json`, and LSP servers in `.lsp.json`. Vet each `command` package with Steps 2-4.
- `mcpServers` entries that point to a `.mcpb` or `.dxt` bundle or an https URL. These are downloaded and unpacked at install. Socket cannot score them.
- Monitors in `monitors/monitors.json`. These are background shell commands.
- Executables in `bin/`. They are put on the agent's `PATH`.
- `settings.json` and agent config files the plugin writes or edits

For Claude Code plugins, also run the plugin's own check:

```shell
claude plugin validate ./path-to-plugin --strict
```

**Remote MCP servers:** Socket cannot inspect a server someone else runs. Check who runs it, what it can reach, and what sign-in it asks for. Treat it as trusted code with your data.

**Scan the checkout's dependencies.** First read any `socket.json` and `socket.yml` in the checkout and treat them as untrusted. The CLI reads them. A `socket.json` can turn on `--auto-manifest`, which runs build tools such as the repo's own `./gradlew`. A `socket.yml` can hide manifests from the scan. Then, from inside the checkout, pass the flags explicitly:

```shell
pnpm dlx socket scan create . --no-auto-manifest --tmp --report
```

`--no-auto-manifest` stops the CLI from running build tools. `--tmp` keeps the scan from becoming a regular scan, or the alerts page, in your organization's dashboard. The CLI uploads the dependency manifests and lockfiles it finds, such as `package.json` and `requirements.txt`, subject to the repo's own `socket.yml` ignores. It does not analyze `SKILL.md`, hooks, shell scripts, or prompt text. See `/socket-scan` for reading the results.

## Step 7: Install Pinned, Through Socket Firewall

Install the vetted version, not "latest at launch". Socket Firewall (`sfw`) blocks known malware while the package manager downloads. See `/socket-firewall` to set it up. If the tool already ran through `npx` or `uvx`, its files may be in the package manager's cache, and `sfw` cannot block a cached copy. See `/socket-firewall` for clearing the cache first, and ask the user before running any cache-clearing command.

For an npm MCP server, install it into its own folder with an exact version and no install scripts:

```shell
mkdir -p ~/mcp && cd ~/mcp && npm init -y
sfw npm install --save-exact --ignore-scripts @modelcontextprotocol/server-filesystem@2.0.1
```

Then point the agent's MCP config `command` at `~/mcp/node_modules/.bin/<bin>` instead of `npx -y`. This gives you a lockfile and a fixed version.

For a PyPI server, install the exact version with `sfw pip install` or `sfw uv pip install` into a virtual environment, and point the config at it. Socket Firewall documents npm, yarn, pnpm, pip, uv, and cargo. It does not document `npx`, `uvx`, or `pnpm dlx`, so do not rely on it for those.

For skills, pin both the installer and the skill. Install from a fixed commit, not a branch:

```shell
npx skills@<version> add <owner>/<repo>@<sha> --skill <name>
```

Socket Firewall does not vet the `skills` installer when it runs through `npx`. To vet it, install it first with `sfw npm install`.

Re-run this skill when you update to a new version or commit.

## Output Format

### If Malware Is Detected

When malware is detected, the output **MUST** begin with this warning before any other content:

> **MALWARE DETECTED - do NOT install this package.**
>
> **Package:** `{name}` ({ecosystem})
> **Malware type:** {description of malware behavior}
>
> **Recommended action:** Remove this package immediately if already installed. Use `/socket-dep-replace` to find an alternative.

If the tool is already installed, remove it from the agent's config and use `/socket-incident-response`.

### Standard Report

**{tool name}** ({MCP server, skill, or plugin}), version or commit `{ref}`

- **Coverage:** which steps ran and which did not (for example, "file tools not available", "remote server: not inspectable", "not on skills.sh")
- **Packages:** each package with its Socket scores, alerts, and capabilities, and a link to `https://socket.dev/<ecosystem>/package/<name>`
- **Files and instructions:** what Steps 4 and 6 found, with file paths and line numbers
- **skills.sh audit:** Pass or Fail and the audit date, if listed, and whether the commit you will install is newer than the audit
- **Recommendation:** install pinned, install with changes (say which), or do not install

End with: "These are existing Socket checks combined. They do not prove the tool is safe."

## Error Handling

- **`depscore` returns "No packages were found":** check the name and ecosystem. Skills from skills.sh are not in `depscore`; use Step 5.
- **The CLI says it needs an API token:** the user runs `pnpm dlx socket login` in their own terminal. In CI, set `SOCKET_CLI_API_TOKEN`. See `/socket-connect` and `/socket-setup`.
- **The CLI or API says a feature is not on your plan:** tell the user plainly that their Socket plan does not include it, and point them to <https://socket.dev/pricing>. Do not guess which plan includes it.
- **Ecosystem not supported:** `pnpm dlx socket package shallow` documents npm, pypi, nuget, gem, golang, and maven. For other ecosystems, say Socket could not score the package.
- **`package_files` needs a version:** pass an exact version, not a range.
- **`package_file_contents` refuses a file:** it is binary. Note it as not reviewed.
- **`package_file_contents` or `package_file_grep` says a file was truncated:** the file is over 1 MB. Note that only the first 1 MB was read or searched.

## Tips

- Malware first. Stop and report it before anything else.
- `npx -y` and `uvx` in an MCP config are an install step on every launch. Replace them with a pinned local install.
- Read tool descriptions. Hidden instructions there reach the agent even if the code looks clean.
- A skill or plugin can add hooks, MCP servers, and executables. Vet each one, not just the top-level files.
- An MCP Registry listing checks the name only, not what the server does.
- Socket's background reading: <https://socket.dev/glossary/mcp-security> and <https://socket.dev/glossary/agent-skills>.
- Use `/socket-inspect` for a deeper look at one package and `/socket-firewall` to block malware during installs.
- If you install a tool and later learn it was malicious, use `/socket-incident-response`.
