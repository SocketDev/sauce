# Socket Security Skills Reference

You have additional SKILLs documented in directories containing a "SKILL.md" file.

## Available Skills

| Skill              | Description                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| brew-publish       | Operate the socket-release Homebrew tap flow - the binary-download formula model, tap repo layout, formula bumps tied to published releases, and sha256 verification against the release's own checksums.txt. Use when bumping a Homebrew formula or standing up a tap for a Socket CLI.                                                                                                                               |
| cargo-publish      | Operate the socket-release crates.io flow - the cargo staged model (dry-run default), trusted publishing via OIDC under the cargo-publish environment, index-propagation waits, and yank-as-rollback. Use when publishing a Rust crate in a repo carrying scripts/socket-release/.                                                                                                                                     |
| github-release     | Cut, verify, and reconcile immutable GitHub releases with the socket-release kit - the registry-resolvability ORDER RULE, the three-step draft-upload-undraft cut, checksums.txt production, and tag-gap healing. Use when tagging a release, healing a missing tag/release, or when the github-release workflow gate refuses a tag.                                                                                   |
| npm-publish        | Operate the socket-release npm flow end to end - bootstrap a package (name reservation, permissive-then-staged-only publishing access, trusted publishing), dispatch a staged publish, promote with --approve, backfill an old version, and roll back with deprecate. Use when publishing an npm package in a repo carrying scripts/socket-release/.                                                                   |
| socket-connect     | Connect your agent to Socket by signing in through the browser - no API key to copy or paste. Bundles the hosted Socket MCP server (OAuth), lists every organization you belong to, and links the Socket CLI for scans.                                                                                                                                                                                                |
| socket-dep-cleanup | Evaluate and remove a single unused dependency from your project. Searches the entire codebase for all usages (imports, requires, config refs, scripts, type packages, indirect usage), reports findings, and performs full removal with verification.                                                                                                                                                                 |
| socket-dep-patch   | Apply Socket's binary-level security patches without changing dependency versions. Uses socket-patch apply to fix vulnerabilities in-place, then verifies automated patching is configured so patches persist across installs.                                                                                                                                                                                         |
| socket-dep-replace | Replace a dependency with an alternative package, eliminate it via code rewrite, or use socket-optimize for optimized replacements.                                                                                                                                                                                                                                                                                    |
| socket-dep-upgrade | Use socket fix to find and update vulnerable dependencies, then fix any breaking changes in the codebase. Security-audited upgrades with automated code migration.                                                                                                                                                                                                                                                     |
| socket-fix         | Fix dependency security issues - either scan and fix everything (requires /socket-scan), or target a single named package. Orchestrates /socket-dep-cleanup, /socket-dep-replace, /socket-dep-patch, and /socket-dep-upgrade as subskills.                                                                                                                                                                             |
| socket-inspect     | Research a package before you depend on it - pull every signal from Socket (scores, alerts, malware verdicts, CVEs, supply-chain risk), check the socket.dev package page, evaluate alternatives, and surface available Socket patches.                                                                                                                                                                                |
| socket-release     | Stand up SocketDev publishing (npm, crates.io, GitHub releases, Homebrew tap) in a repo - copy in the socket-release kit from a sauce checkout and run its bootstrap through name reservation, GitHub environments, npm trusted publisher, publishing-access tightening, staged publish config, and verification.                                                                                                      |
| socket-scan        | Run a dependency scan using the Socket CLI. Prompt unauthenticated users to log in or create an account. If they decline, offer a local SBOM that does not include Socket analysis. Authenticated users get temporary read-only scans by default (--tmp). Creates a persistent dashboard scan only when explicitly requested. Includes reachability analysis for enterprise customers and license compliance auditing. |
| socket-scan-setup  | Set up prerequisites for Socket scanning - install the CLI, sign in with your own Socket account, and verify scan access. Use this before the first scan or when encountering auth errors.                                                                                                                                                                                                                             |
| socket-setup       | Set up Socket - connect your account through browser sign-in, install the CLI, configure policies and CI tokens, and set up CI/CD for firewall or patch modes across GitHub, GitLab, Bitbucket, and other systems.                                                                                                                                                                                                     |

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

- `skills/socket-release/npm-publish/SKILL.md`

- `skills/socket-connect/SKILL.md`

- `skills/socket-fix/socket-dep-cleanup/SKILL.md`

- `skills/socket-fix/socket-dep-patch/SKILL.md`

- `skills/socket-fix/socket-dep-replace/SKILL.md`

- `skills/socket-fix/socket-dep-upgrade/SKILL.md`

- `skills/socket-fix/SKILL.md`

- `skills/socket-inspect/SKILL.md`

- `skills/socket-release/SKILL.md`

- `skills/socket-scan/SKILL.md`

- `skills/socket-scan/socket-scan-setup/SKILL.md`

- `skills/socket-setup/SKILL.md`

</details>
