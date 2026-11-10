---
name: knowledge-update
description:
  Correct outdated model knowledge about Socket products - the CLI, Socket
  Firewall, the hosted MCP server, Socket for GitHub, reachability, socket.yml,
  and socket-patch. Read it before giving Socket advice from memory.
metadata:
  category: reference
---

# Socket Knowledge Updates (2026-11)

> **IMPORTANT:** These corrections were checked against Socket's public source and docs in November 2026. They override older training data. If your memory conflicts with this file, trust this file. If this file conflicts with a newer docs page, trust the docs page.

Each entry starts with the corrected fact in bold, then gives detail and a source. Every Socket CLI call in this repo is written `pnpm dlx socket ...`, so the CLI runs without a global install.

## When to Use

- Before answering a Socket question from memory: commands, flags, config files, install steps
- When a Socket command you remember fails with "unknown command" or "unknown flag"
- When the user mentions `socket info`, `socket report`, "Tier 1 reachability", or a `socket.yml` without `version: 2`
- When choosing between the Socket CLI, Socket Firewall, the Socket MCP server, and socket-patch
- When another Socket skill (`/socket-scan`, `/socket-fix`, `/socket-firewall`, `/socket-reachability`) needs current product facts

## Common Outdated Knowledge

- **The CLI npm package is `socket` (1.14.1 as of 2026-11-06), not only `@socketsecurity/cli`.** Install with `npm install -g socket`, or run it with `pnpm dlx socket`. It ships the binaries `socket`, `socket-npm`, `socket-npx`, `socket-pnpm`, and `socket-yarn`, and Socket's docs require Node.js 22 or newer (the package's `engines` field still says `>=18.20.8`; see https://docs.socket.dev/docs/cli-support). `@socketsecurity/cli` is still published at the same version, but the docs name `socket`. https://docs.socket.dev/docs/socket-cli
- **Find the current CLI version on npm, not on GitHub "latest release".** The GitHub latest-release API returned v1.1.146 while v1.14.1 was newest. Versions 2.0.0 to 2.1.0 were published to npm in late 2025 but are deprecated as bad builds. Use the `latest` dist-tag (1.14.1), not the highest semver. Check `https://registry.npmjs.org/socket` dist-tags. https://github.com/SocketDev/socket-cli/releases
- **`socket info` and `socket report create` / `socket report view` are 0.x commands and no longer exist.** Use `pnpm dlx socket package score <eco> <name>` or `pnpm dlx socket package shallow` for package lookups, and `pnpm dlx socket scan create` / `pnpm dlx socket scan report` / `pnpm dlx socket scan view` for scans. https://github.com/SocketDev/socket-cli/blob/v1.14.1/src/commands.mts
- **Reachability "Tier 1/2/3" are old names.** Tier 1 is now **Full Application Reachability**, Tier 2 is **Precomputed Reachability**, Tier 3 is **Dependency Reachability**. https://docs.socket.dev/docs/reachability-analysis
- **`socket.yml` is at `version: 2`, and the field is required.** v1 keys `ignore` and `issues` are now `projectIgnorePaths` and `issueRules`. https://docs.socket.dev/docs/socket-yml
- **The Socket MCP server is hosted at `https://mcp.socket.dev/` and signs in with OAuth.** No API key. Every tool call needs sign-in, including `depscore`. See `/socket-connect`. https://docs.socket.dev/docs/remote-socket-mcp
- **Socket Firewall is `sfw`, with a Free and an Enterprise edition.** Free installs with `npm i -g sfw` and needs no key. Enterprise needs an API key and a different binary. https://docs.socket.dev/docs/socket-firewall-overview
- **socket-patch is at v5, and hosted mode is now the default.** The old scan-then-apply-to-`node_modules` flow is now `--mode agent`. https://github.com/SocketDev/socket-patch/blob/v5.0.1/docs/migrating-to-v5.md
- **Socket docs have an LLM index at https://docs.socket.dev/llms.txt.** Append `.md` to any docs page URL for Markdown, for example https://docs.socket.dev/docs/socket-yml.md. `llms-full.txt` does not exist (404).

## Socket CLI

- **Root commands in 1.14.1:** `analytics`, `audit-log`, `ci`, `cdxgen`, `config`, `dependencies`, `fix`, `install`, `json`, `license`, `login`, `logout`, `manifest`, `npm`, `npx`, `pnpm`, `oops`, `optimize`, `organization`, `package`, `patch`, `raw-npm`, `raw-npx`, `repository`, `scan`, `security`, `threat-feed`, `uninstall`, `wrapper`, `yarn`. Aliases: `audit`, `deps`, `feed`, `org`, `pkg`, `repo`. https://github.com/SocketDev/socket-cli/blob/v1.14.1/src/commands.mts
- **`socket scan` subcommands:** `create`, `del`, `diff`, `github`, `list`, `metadata`, `reach`, `report`, `setup`, `view`. `pnpm dlx socket scan reach` computes full application reachability and has been listed in help since 1.11.2. https://github.com/SocketDev/socket-cli/blob/v1.14.1/CHANGELOG.md
- **`socket ci` is an alias for `socket scan create --report`.** It fails the run when the scan is unhealthy. https://github.com/SocketDev/socket-cli/blob/v1.14.1/README.md
- **Dependencies moved under `organization` in v1.0.0 (June 2025).** Use `pnpm dlx socket org deps`. `socket organization` also has `list`, `quota`, and `policy` (`license`, `security`). https://github.com/SocketDev/socket-cli/blob/v1.14.1/CHANGELOG.md
- **`socket fix` flags were renamed:** `--limit` is now `--pr-limit` (old name still works as an alias). To compute fixes without applying them, use `--no-apply-fixes`. It replaced `--only-compute` and `--dont-apply-fixes`. Do not use the old names: `--dont-apply-fixes` is silently ignored and `--only-compute` now maps to the positive `--apply-fixes`, so both can end up applying fixes and changing files. Example: `pnpm dlx socket fix --all --no-apply-fixes --output-file fixes.json`. `--test` and `--test-script` were removed in 1.1.1. A local `socket fix` without `--all` or `--id` is deprecated. https://github.com/SocketDev/socket-cli/blob/v1.14.1/CHANGELOG.md
- **`socket fix` exits with code 5 when it computed fixes it could not apply (since 1.8.4).** The `--output-file` JSON lists them under `notApplied`. https://github.com/SocketDev/socket-cli/blob/v1.14.1/CHANGELOG.md
- **`socket manifest dotnet` is new (beta, 1.13.0, 2026-11-03).** Other manifest subcommands: `auto`, `bazel`, `cdxgen`, `conda`, `dynamic-sbom-inference`, `gradle`, `kotlin`, `maven`, `scala`, `setup`. https://github.com/SocketDev/socket-cli/blob/v1.14.1/src/commands/manifest/cmd-manifest.mts
- **`socket threat-feed` is labelled beta.** Flags include `--eco`, `--filter`, `--pkg`, `--version`, `--org`, `--page`, `--per-page`. In 1.14.1 the value of `--filter` is never read; set the threat type with a positional argument instead (see `/socket-incident-response`, Step 2b). The REST endpoint `getthreatfeeditems` is deprecated in favor of `getorgthreatfeeditems`. https://docs.socket.dev/docs/socket-threat-feed
- **`socket cdxgen` pins `@cyclonedx/cdxgen` 12.1.2 and downloads it on first use** (with `npx`, `pnpm dlx`, or `yarn dlx`). It is not bundled, so it needs network access the first time. https://docs.socket.dev/docs/socket-cdxgen
- **`SOCKET_CLI_COANA_LAUNCHER` has no effect since 1.9.0.** The reachability engine downloads from Socket's servers and is cached at `$XDG_CACHE_HOME/socket/coana`. https://github.com/SocketDev/socket-cli/blob/v1.14.1/CHANGELOG.md
- **`socket login` signs the CLI in and sets defaults.** The user runs it in their own terminal. The 1.14.1 release prompts for an API token in a masked prompt; releases with browser login show a device code instead. For CI, set `SOCKET_CLI_API_TOKEN`. Never paste a token into chat. See `/socket-connect`.

## Reachability

- **Run full application reachability with `--reach` or the `reach` subcommand.**

```shell
pnpm dlx socket scan create --reach .
pnpm dlx socket scan reach .
```

- **`socket scan create` rejects `--reach-*` flags when `--reach` is missing (since 1.1.158).** Current flags include `--reach-ecosystems`, `--reach-analysis-timeout`, `--reach-analysis-memory-limit`, `--reach-retain-facts-file`, `--reach-disable-dependency-downloads` (1.12.0), and `--reach-advisories` (1.11.0). `--reach-disable-analysis-splitting` is a deprecated no-op. `--reach-exclude-paths` is deprecated; use `--exclude-paths`. See `/socket-reachability`. https://github.com/SocketDev/socket-cli/blob/v1.14.1/src/commands/scan/reachability-flags.mts
- **Full application reachability covers more than JS/TS and Python.** The docs list JS/TS, Python, Go, Java, .NET (C# only), Scala, Kotlin, Ruby, Rust, and PHP (Composer). .NET runs at class level, not function level. https://docs.socket.dev/docs/full-application-reachability
- **Results land in `.socket.facts.json`.** The CLI deletes it after a successful scan unless you pass `--reach-retain-facts-file`. Delete a retained file before the next scan, because a scan without `--reach` uploads it as an SBOM. Since 1.7.0, JVM builds write per-build files such as `pom.xml.socket.facts.json` and `gradle.socket.facts.json`. https://docs.socket.dev/docs/full-application-reachability
- **`--dynamic-sbom-inference` is now a standalone flag (1.1.166).** `--dynamic-sbom-inference-ecosystems maven,nuget` arrived in 1.14.0. https://github.com/SocketDev/socket-cli/blob/v1.14.1/CHANGELOG.md
- **Managed Scans (beta) run full application reachability daily on GitHub repos with no CI setup.** https://docs.socket.dev/docs/managed-scans
- **Plan availability:** do not state it from memory. If the CLI or API says a reachability tier is not on the user's plan, say so plainly and point to https://socket.dev/pricing. See `/socket-reachability`.

## Socket Firewall (sfw)

- **Free:** `npm i -g sfw`. No API key, no config. Wrapper mode only, public registries only. It supports npm, yarn, pnpm, pip, uv, and cargo. It blocks confirmed malware and warns on AI-detected threats. https://docs.socket.dev/docs/socket-firewall-free

```shell
sfw npm install
sfw pip install requests
sfw cargo fetch
```

- **The npm `sfw` package is a thin wrapper.** It downloads the Free binary from https://github.com/SocketDev/sfw-free and checks for updates once a day. Set `SFW_SKIP_UPDATE_CHECK=1` to skip the check.
- **Enterprise is a separate binary, also named `sfw`, from https://github.com/SocketDev/firewall-release/releases.** It reads `SOCKET_API_KEY` or a `.sfw.config` file, and the token needs the `packages` and `entitlements:list` scopes. It applies the organization's security policy and adds go (Linux only), gem, bundle, and dotnet wrappers. Poetry is not supported. https://docs.socket.dev/docs/socket-firewall-enterprise-wrapper-mode
- **Enterprise also has a Registry mode,** a persistent service that package managers point at. The docs recommend it over wrapper mode. https://docs.socket.dev/docs/socket-firewall-overview
- **In GitHub Actions, use `SocketDev/action` with `mode: firewall-free`, then run `sfw npm ci`.** https://github.com/SocketDev/sfw-free
- See `/socket-firewall`.

## Socket MCP Server

- **Hosted, OAuth, no key:** add `https://mcp.socket.dev/` as an HTTP server and sign in through the browser. https://docs.socket.dev/docs/guide-to-socket-mcp

```shell
claude mcp add --transport http socket https://mcp.socket.dev/
```

- **Tools are `depscore`, `organizations`, `alerts`, `threat_feed`, `package_files`, `package_file_contents`, and `package_file_grep`.** The docs guide still lists only `depscore`. The full set is in the `@socketsecurity/mcp` 0.3.0 README. Match tools by suffix, since the prefix depends on how the server was added. https://www.npmjs.com/package/@socketsecurity/mcp
- **Self-hosting uses npm `@socketsecurity/mcp` (bin `socket-mcp`) over stdio with an API key.** npm (0.3.0) is ahead of GitHub releases (v0.2.1). https://docs.socket.dev/docs/local-socket-mcp

## Socket for GitHub

- **It is a GitHub App that scans pull requests** when they are opened, reopened, or pushed to. It posts the check "Socket Security: Pull Request Alerts" and a "Socket Security: Project Report". Block alerts fail the check, Warn alerts show, Monitor and Ignore alerts stay hidden. A Neutral result means some dependency files could not be read. https://docs.socket.dev/docs/socket-for-github-pull-request-scanning
- **Ignore an alert with a PR comment:** `@SocketSecurity ignore <ecosystem>/<name>@<version>` (copy the exact command from Socket's PR comment) or `@SocketSecurity ignore-all`. The command must start the comment, come from a repo contributor, and sit in the main PR thread. Edit or delete the comment to undo it. https://docs.socket.dev/docs/ignoring-pull-request-alerts
- See `/socket-pr-alerts`.

## socket.yml and socket.json

- **The GitHub App reads `socket.yml` or `socket.yaml` in the repo root.** If both exist, `.yml` wins. The CLI walks up from the current directory and uses the first one it finds, so keep one file at the repo root. https://docs.socket.dev/docs/socket-yml
- **v2 fields:** `projectIgnorePaths` (gitignore-style), `triggerPaths`, `issueRules`, and `githubApp` (`enabled`, `pullRequestAlertsEnabled`, `dependencyOverviewEnabled`, `projectReportsEnabled`, `ignoreUsers`, `disableCommentsAndCheckRuns`). `issueRules` is deprecated in favor of repository labels.
- **Migrating v1 to v2:** add `version: 2`, rename `ignore` to `projectIgnorePaths` and `issues` to `issueRules`, move `enabled`, `projectReportsEnabled`, and `pullRequestAlertsEnabled` under `githubApp`, and remove `beta`.

```yaml
version: 2
projectIgnorePaths:
  - 'test/fixtures/'
githubApp:
  pullRequestAlertsEnabled: true
```

- **The CLI reads `projectIgnorePaths` from socket.yml** for `socket scan create`, `socket scan reach`, and `socket fix`. https://github.com/SocketDev/socket-cli/blob/v1.14.1/README.md
- **`socket.json` is a different file:** local CLI project settings, such as build-tool options written by `pnpm dlx socket manifest setup`. https://docs.socket.dev/docs/socketjson
- See `/socket-policy`.

## socket-patch

- **Standalone `socket-patch` is v5.0.1 (2026-10-13).** Install it with one of these. The README also documents a standalone installer script.

```shell
npm install -g @socketsecurity/socket-patch
cargo install socket-patch-cli
```

- **In v5, `socket-patch scan` edits lockfiles, manifests, and registry config, and works on a fresh checkout before install.** Modes: hosted (default for new projects; a project that already has agent-mode or vendored patches keeps that mode on a bare `scan` or `get` unless you pass `--mode`), `--mode vendored` (commits `.socket/vendor/`), and `--mode agent` (old in-place behavior; rerun `socket-patch apply` after each install). Also: `scan --dry-run`, `vex --output socket.vex.json`, and `list`. https://github.com/SocketDev/socket-patch/blob/v5.0.1/README.md
- **Free patches need no token.** For organization patches set `SOCKET_API_TOKEN` and `--org` (or `SOCKET_ORG_SLUG`). If the org cannot be resolved, v5 falls back to free patches with an `api_auth_fallback` warning. `get <name>` matches the exact package name.
- **`pnpm dlx socket patch` inside CLI 1.14.1 still bundles socket-patch 2.0.0,** with the older apply-to-`node_modules` behavior. https://github.com/SocketDev/socket-cli/blob/v1.14.1/package.json
- See `/socket-dep-patch`. Note that it still describes the agent-mode `socket-patch apply` flow, which needs installed packages.

## The Socket Skills Repo

- **The repo is now `SocketDev/sauce`.** `https://github.com/SocketDev/skills` redirects to it, so install commands that use `SocketDev/skills` still work. https://github.com/SocketDev/sauce

```shell
pnpm dlx skills add SocketDev/skills
```

- In Claude Code: `/plugin marketplace add SocketDev/skills`, then `/plugin install <name>@SocketDev/skills`.

## Tips

- Check facts in this file against https://docs.socket.dev/llms.txt before relying on them for a long task. Docs pages change faster than this file.
- When a command fails, run `pnpm dlx socket <command> --help` before guessing a flag. Do not invent flags.
- Do not state which plan unlocks a feature. When the CLI or API says a feature is not on the user's plan, say so and link https://socket.dev/pricing.
- Never ask the user to paste an API token into chat. Use `/socket-connect` for MCP sign-in and have the user run `pnpm dlx socket login` in their own terminal.
- Use `/socket-scan` for scans, `/socket-fix` for fixes, `/socket-inspect` for single-package checks, `/socket-sbom` for SBOMs, `/socket-incident-response` for active malware, and `/socket-vet-agent-tools` before installing MCP servers or plugins.
