# Socket Security Skills Reference

You have additional SKILLs documented in directories containing a "SKILL.md" file.

## Available Skills

| Skill                    | Description                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| brew-publish             | Operate the socket-release Homebrew tap flow - the binary-download formula model, tap repo layout, formula bumps tied to published releases, and sha256 verification against the release's own checksums.txt. Use when bumping a Homebrew formula or standing up a tap for a Socket CLI.                                                                                                                               |
| cargo-publish            | Operate the socket-release crates.io flow - the cargo staged model (dry-run default), trusted publishing via OIDC under the cargo-publish environment, index-propagation waits, and yank-as-rollback. Use when publishing a Rust crate in a repo carrying scripts/socket-release/.                                                                                                                                     |
| github-release           | Cut, verify, and reconcile immutable GitHub releases with the socket-release kit - the registry-resolvability ORDER RULE, the three-step draft-upload-undraft cut, checksums.txt production, and tag-gap healing. Use when tagging a release, healing a missing tag/release, or when the github-release workflow gate refuses a tag.                                                                                   |
| knowledge-update         | Correct outdated model knowledge about Socket products - the CLI, Socket Firewall, the hosted MCP server, Socket for GitHub, reachability, socket.yml, and socket-patch. Read it before giving Socket advice from memory.                                                                                                                                                                                              |
| npm-publish              | Operate the socket-release npm flow end to end - bootstrap a package (name reservation, permissive-then-staged-only publishing access, trusted publishing), dispatch a staged publish, promote with --approve, backfill an old version, and roll back with deprecate. Use when publishing an npm package in a repo carrying scripts/socket-release/.                                                                   |
| socket-connect           | Connect your agent to Socket by signing in through the browser - no API key to copy or paste. Signs in to the hosted Socket MCP server (OAuth), lists every organization you belong to, and links the Socket CLI for scans.                                                                                                                                                                                            |
| socket-dep-cleanup       | Evaluate and remove a single unused dependency from your project. Searches the entire codebase for all usages (imports, requires, config refs, scripts, type packages, indirect usage), reports findings, and performs full removal with verification.                                                                                                                                                                 |
| socket-dep-patch         | Apply Socket's binary-level security patches without changing dependency versions. Uses socket-patch apply to fix vulnerabilities in-place, then verifies automated patching is configured so patches persist across installs.                                                                                                                                                                                         |
| socket-dep-replace       | Replace a dependency with an alternative package, eliminate it via code rewrite, or use socket-optimize for optimized replacements.                                                                                                                                                                                                                                                                                    |
| socket-dep-upgrade       | Use socket fix to find and update vulnerable dependencies, then fix any breaking changes in the codebase. Security-audited upgrades with automated code migration.                                                                                                                                                                                                                                                     |
| socket-firewall          | Run package installs through Socket Firewall (`sfw`) to block malware at download time, and handle a block when one happens. Use it when installing dependencies, when an install fails with a Socket block, or when setting up Enterprise policy and private registries.                                                                                                                                              |
| socket-fix               | Fix dependency security issues - either scan and fix everything (requires /socket-scan), or target a single named package. Orchestrates /socket-dep-cleanup, /socket-dep-replace, /socket-dep-patch, and /socket-dep-upgrade as subskills.                                                                                                                                                                             |
| socket-incident-response | Respond to a malware report or advisory about a package. Use it to confirm the report in Socket's threat feed, find out whether your projects use the bad version, contain it, check whether it ran, rotate secrets, and write up what happened.                                                                                                                                                                       |
| socket-inspect           | Research a package before you depend on it - pull every signal from Socket (scores, alerts, malware verdicts, CVEs, supply-chain risk), check the socket.dev package page, evaluate alternatives, and surface available Socket patches.                                                                                                                                                                                |
| socket-policy            | Edit a repository's socket.yml and change how Socket acts on alerts (block, warn, monitor, ignore). Use it to exclude paths from scans, tune the GitHub App per repo, check the file against the schema, or find and change the organization's security and license policy.                                                                                                                                            |
| socket-pr-alerts         | Triage the alerts Socket for GitHub posts on a pull request and decide what to fix, replace, or accept. Use it when a PR has a failing "Socket Security" check or a Socket alerts comment.                                                                                                                                                                                                                             |
| socket-reachability      | Run Socket full application reachability analysis and read the .socket.facts.json report it writes. Use it to learn which vulnerabilities your code actually reaches, so you fix reachable CVEs first.                                                                                                                                                                                                                 |
| socket-release           | Stand up SocketDev publishing (npm, crates.io, GitHub releases, Homebrew tap) in a repo - copy in the socket-release kit from a sauce checkout and run its bootstrap through name reservation, GitHub environments, npm trusted publisher, publishing-access tightening, staged publish config, and verification.                                                                                                      |
| socket-sbom              | Generate a CycloneDX SBOM for a project, export a CycloneDX or SPDX SBOM for an existing Socket scan, and check dependencies against the organization's license policy. Use it when someone asks for an SBOM, a bill of materials, or a license report.                                                                                                                                                                |
| socket-scan              | Run a dependency scan using the Socket CLI. Prompt unauthenticated users to log in or create an account. If they decline, offer a local SBOM that does not include Socket analysis. Authenticated users get temporary read-only scans by default (--tmp). Creates a persistent dashboard scan only when explicitly requested. Includes reachability analysis for enterprise customers and license compliance auditing. |
| socket-scan-setup        | Set up prerequisites for Socket scanning - install the CLI, sign in with your own Socket account, and verify scan access. Use this before the first scan or when encountering auth errors.                                                                                                                                                                                                                             |
| socket-setup             | Set up Socket - connect your account through browser sign-in, install the CLI, configure policies and CI tokens, and set up CI/CD for firewall or patch modes across GitHub, GitLab, Bitbucket, and other systems.                                                                                                                                                                                                     |
| socket-vet-agent-tools   | Vet an MCP server, agent skill, or plugin before you install it into a coding agent. Use it to check the packages behind it with Socket, read its published files, review its hooks, scripts, and prompt text, and install it pinned through Socket Firewall.                                                                                                                                                          |

## Usage

**IMPORTANT:** You MUST read the SKILL.md file whenever the description of the skills matches the user intent, or may help accomplish their task.

## Skill Paths

Paths referenced within SKILL folders are relative to that SKILL. For example the scan `scripts/example.sh` would be referenced as `scan/scripts/example.sh`.

## Skill Files

The skills are located in:

<details><summary>Every bundled SKILL.md path</summary>

- `skills/socket-release/brew-publish/SKILL.md`

- `skills/socket-release/cargo-publish/SKILL.md`

- `skills/socket-release/github-release/SKILL.md`

- `skills/knowledge-update/SKILL.md`

- `skills/socket-release/npm-publish/SKILL.md`

- `skills/socket-connect/SKILL.md`

- `skills/socket-fix/socket-dep-cleanup/SKILL.md`

- `skills/socket-fix/socket-dep-patch/SKILL.md`

- `skills/socket-fix/socket-dep-replace/SKILL.md`

- `skills/socket-fix/socket-dep-upgrade/SKILL.md`

- `skills/socket-firewall/SKILL.md`

- `skills/socket-fix/SKILL.md`

- `skills/socket-incident-response/SKILL.md`

- `skills/socket-inspect/SKILL.md`

- `skills/socket-policy/SKILL.md`

- `skills/socket-pr-alerts/SKILL.md`

- `skills/socket-reachability/SKILL.md`

- `skills/socket-release/SKILL.md`

- `skills/socket-sbom/SKILL.md`

- `skills/socket-scan/SKILL.md`

- `skills/socket-scan/socket-scan-setup/SKILL.md`

- `skills/socket-setup/SKILL.md`

- `skills/socket-vet-agent-tools/SKILL.md`

</details>
