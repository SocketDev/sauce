# Socket Security Skills

[![Follow @SocketSecurity](https://img.shields.io/twitter/follow/SocketSecurity?style=social)](https://twitter.com/SocketSecurity)
[![Follow @socket.dev on Bluesky](https://img.shields.io/badge/Follow-@socket.dev-1DA1F2?style=social&logo=bluesky)](https://bsky.app/profile/socket.dev)

Socket Security Skills are definitions for dependency security tasks like vulnerability scanning, package review, patching, firewall configuration, and secure dependency updates. They follow the standardized [Agent Skill](https://agentskills.io/home) format and are compatible with **40+ coding agent tools** including:

- **Claude Code** (Anthropic) - native skill/plugin support
- **Codex** (OpenAI) - Agent Skills standard + AGENTS.md fallback
- **Gemini CLI** (Google DeepMind) - extensions support
- **OpenCode** - skill directory support
- **Cursor** - plugin manifest support
- **VS Code Copilot / GitHub Copilot** - via AGENTS.md or Skills CLI
- **Windsurf** - via Skills CLI
- **Roo Code** - via Skills CLI
- **Any agent supporting the Agent Skills standard** - via `pnpm dlx skills add`

If your agent isn't listed above but supports skills, extensions, or custom instructions, it can likely use these skills via the [Skills CLI](https://skills.sh/) or the [`agents/README.md`](agents/README.md) fallback.

## How do Skills work?

Skills are self-contained folders that package instructions, scripts, and resources for an AI agent to use on a specific task. Each folder includes a `SKILL.md` file with YAML frontmatter (name and description) followed by the guidance your coding agent follows while the skill is active.

> [!NOTE]
> 'Skills' is an Anthropic term from Claude AI and Claude Code; other agent tools use their own names for the same idea. OpenAI Codex uses the open [Agent Skills](https://agentskills.io/specification) format, where each skill is a directory with a `SKILL.md` file that Codex discovers from standard `.agents/skills` locations documented in the [Codex Skills guide](https://developers.openai.com/codex/skills/). Codex also works with an `AGENTS.md` file. Google Gemini uses 'extensions', defined in a `gemini-extension.json` file. This repo works with all of them.

If your agent doesn't support skills, use [`agents/README.md`](agents/README.md) as a fallback: copy it into your project as `AGENTS.md`.

## Install

Socket Security Skills are compatible with Claude Code, Codex, Gemini CLI, Cursor, and any agent supporting the [Agent Skills standard](https://agentskills.io/specification).

### Quick Install

Install skills using the [Skills CLI](https://skills.sh/) (works with Claude Code, Codex, Gemini CLI, Cursor, and 40+ agents):

```shell
pnpm dlx skills add SocketDev/skills
```

To list available skills before installing:

```shell
pnpm dlx skills add SocketDev/skills --list
```

### Claude Code

1. Register the repository as a plugin marketplace:

```text
/plugin marketplace add SocketDev/skills
```

1. To install a skill, run:

```text
/plugin install <skill-name>@SocketDev/skills
```

For example:

```text
/plugin install socket-scan@SocketDev/skills
```

The installable plugin names are `socket-setup`, `socket-scan`, `socket-scan-setup`, `socket-inspect`, `socket-fix`, `socket-dep-cleanup`, `socket-dep-patch`, `socket-dep-replace`, and `socket-dep-upgrade`.

### Codex

1. Copy or symlink any skills you want to use from this repository's `skills/` directory into one of Codex's standard `.agents/skills` locations (for example, `$REPO_ROOT/.agents/skills` or `$HOME/.agents/skills`) as described in the [Codex Skills guide](https://developers.openai.com/codex/skills/).

2. Once a skill is available in one of those locations, Codex will discover it using the Agent Skills standard and load the `SKILL.md` instructions when it decides to use that skill or when you explicitly invoke it.

3. If your Codex setup still relies on `AGENTS.md`, you can use the generated [`agents/README.md`](agents/README.md) file in this repo as a fallback bundle of instructions - copy it into your project as `AGENTS.md`.

### Gemini CLI

1. This repo includes `gemini-extension.json` to integrate with the Gemini CLI.

2. Install locally:

```text
gemini extensions install . --consent
```

or use the GitHub URL:

```text
gemini extensions install https://github.com/SocketDev/skills.git --consent
```

1. See [Gemini CLI extensions docs](https://geminicli.com/docs/extensions/#installing-an-extension) for more help.

### Cursor

This repository includes Cursor plugin manifests:

- `.cursor-plugin/plugin.json`

Install from repository URL (or local checkout) via the Cursor plugin flow.

For contributors, regenerate manifests with:

```bash
node scripts/repo/publish.mts
```

### OpenCode

This repository includes an `.opencode/skills` directory that OpenCode discovers automatically.

1. Clone or install this repo into your project
2. OpenCode will discover skills from `.opencode/skills/`

Or manually copy skill folders into your project's `.opencode/skills/` directory.

### Other Agents (VS Code Copilot, Windsurf, Roo Code, etc.)

For any agent that supports the Agent Skills standard or custom instructions:

1. Use the Skills CLI (recommended):

```shell
pnpm dlx skills add SocketDev/skills
```

1. Or manually copy the [`agents/README.md`](agents/README.md) file into your agent's instructions/context directory as `AGENTS.md`. This file contains a summary of all available skills and their locations.

2. Skills call the Socket CLI and Batch PURL API directly, so no MCP server is required.

## Usage

This repository contains security-focused skills for dependency management. You can also contribute your own skills to the repository.

### Available skills

<!-- This table is auto-generated by scripts/repo/generate-agents.mts. Do not edit manually. -->
<!-- BEGIN_SKILLS_TABLE -->

#### Setup

Install, authenticate, and configure Socket for your project.

| Name                | Description                                                                                                                                                                                                                                 | Documentation                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `brew-publish`      | Operate the socket-release Homebrew tap flow - tap repo layout, formula bumps tied to published releases, and sha256 verification against the release's own checksums.txt.                                                                  | [SKILL.md](skills/socket-release/brew-publish/SKILL.md)   |
| `cargo-publish`     | Operate the socket-release crates.io flow - the cargo staged model, trusted publishing (OIDC), index-propagation waits, and yank-as-rollback.                                                                                               | [SKILL.md](skills/socket-release/cargo-publish/SKILL.md)  |
| `github-release`    | Cut, verify, and reconcile immutable GitHub releases - the registry-resolvability ORDER RULE, the draft-upload-undraft cut, checksums.txt, and tag-gap healing.                                                                             | [SKILL.md](skills/socket-release/github-release/SKILL.md) |
| `npm-publish`       | Operate the socket-release npm flow end to end - bootstrap (permissive-then-staged-only publishing access), staged publish dispatch, soak, --approve promote, backfill, and rollback/deprecate.                                             | [SKILL.md](skills/socket-release/npm-publish/SKILL.md)    |
| `socket-release`    | Stand up SocketDev publishing (npm, crates.io, GitHub releases, Homebrew tap) in a repo: copy in the release kit and run its bootstrap - name reservation, GitHub environments, npm trusted publisher, staged publish config, verification. | [SKILL.md](skills/socket-release/SKILL.md)                |
| `socket-scan-setup` | Set up prerequisites for Socket scanning - install the CLI, configure auth with the public demo token, and verify scan access.                                                                                                              | [SKILL.md](skills/socket-scan/socket-scan-setup/SKILL.md) |
| `socket-setup`      | Set up Socket - prompt for API key, install the CLI, authenticate, configure policies and tokens, set up CI/CD for firewall or patch modes across GitHub, GitLab, Bitbucket, and other systems.                                             | [SKILL.md](skills/socket-setup/SKILL.md)                  |

#### Analysis

Scan dependencies and inspect individual packages for security risks.

| Name             | Description                                                                                                                                                                                                                                                            | Documentation                              |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `socket-inspect` | Research a package before you depend on it - pull every signal from Socket (scores, alerts, malware verdicts, CVEs, supply-chain risk), check the socket.dev package page, evaluate alternatives, and surface available Socket patches.                                | [SKILL.md](skills/socket-inspect/SKILL.md) |
| `socket-scan`    | Run a full dependency scan using the Socket CLI. Creates a scan in the Socket dashboard, checks all dependencies for vulnerabilities and supply-chain risks, performs Tier 1 reachability analysis for enterprise customers, and provides license compliance auditing. | [SKILL.md](skills/socket-scan/SKILL.md)    |

#### Fix

Holistic dependency repair - orchestrate cleanup, replacement, patching, and upgrades in a single phased workflow with individual subskills for each operation.

| Name                 | Description                                                                                                                                                                                                                                            | Documentation                                             |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| `socket-dep-cleanup` | Evaluate and remove a single unused dependency from your project. Searches the entire codebase for all usages (imports, requires, config refs, scripts, type packages, indirect usage), reports findings, and performs full removal with verification. | [SKILL.md](skills/socket-fix/socket-dep-cleanup/SKILL.md) |
| `socket-dep-patch`   | Apply Socket's binary-level security patches without changing dependency versions. Uses socket-patch apply to fix vulnerabilities in-place, then verifies automated patching is configured so patches persist across installs.                         | [SKILL.md](skills/socket-fix/socket-dep-patch/SKILL.md)   |
| `socket-dep-replace` | Replace a dependency with an alternative package, eliminate it via code rewrite, or use socket-optimize for optimized replacements.                                                                                                                    | [SKILL.md](skills/socket-fix/socket-dep-replace/SKILL.md) |
| `socket-dep-upgrade` | Use socket fix to find and update vulnerable dependencies one at a time, then fix any breaking changes in the codebase. Security-audited upgrades with automated code migration.                                                                       | [SKILL.md](skills/socket-fix/socket-dep-upgrade/SKILL.md) |
| `socket-fix`         | Fix dependency security issues - either scan and fix everything (requires /socket-scan), or target a single named package. Orchestrates /socket-dep-cleanup, /socket-dep-replace, /socket-dep-patch, and /socket-dep-upgrade as subskills.             | [SKILL.md](skills/socket-fix/SKILL.md)                    |

<!-- END_SKILLS_TABLE -->

## Development

1. Create a new directory under `skills/` with a descriptive name
2. Add a `SKILL.md` file with YAML frontmatter (`name` and `description`) followed by guidance content
3. Add an entry in `.claude-plugin/marketplace.json` with matching `name` and `source` path
4. Run `node scripts/repo/publish.mts` to regenerate all artifacts
5. Run `node scripts/repo/publish.mts --check` to verify everything is in sync
6. Submit a pull request

## License

[MIT](./LICENSE)
