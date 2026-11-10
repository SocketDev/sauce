# AGENTS.md

Rules for people and agents who change this repository.

## Tooling

- Use the Node version in `.node-version` and `pnpm` from the repository root. Do not use `npx`, `pnpm dlx`, or `corepack`.
- `pnpm install` installs dependencies and points `core.hooksPath` at `.git-hooks/`.
- `pnpm run check` runs formatting, lint, the type check, the path and release-kit checks, `generate:check`, and a content scan of tracked files.
- `pnpm test` runs the Vitest suite under `test/repo/`. `pnpm run cover` runs it with coverage. `pnpm run test:fuzz-harnesses` runs the fuzz harnesses.
- `pnpm run type` type-checks the repository and the release-kit.
- `pnpm run fix` applies lint fixes and formatting.

## Generated artifacts

- `pnpm run generate` rebuilds `agents/README.md`, the `README.md` skills table, every agent plugin's generated files (including `.claude-plugin/marketplace.json`, `gemini-extension.json`, and `hermes/`), and `skills/_shared/docs/agent-sign-in.md` from `skills/` and `.claude-plugin/plugin.json`, then inlines shared sections. Run it after you change a skill, then commit the result. `pnpm run generate:check` fails when anything is out of date.

## Skills and agent plugins

- Each skill is `skills/<name>/SKILL.md`, optionally nested under another skill. Its frontmatter `metadata` sets `category` (the README table group) and `requires` (comma-separated skills it needs, such as `socket-connect` for skills that use the MCP server). Every plugin reads skills through `scripts/repo/plugins/skills.mts`.
- Text that more than one skill needs lives once in `skills/_shared/docs/<name>.md` and is inlined between `<!-- BEGIN_SECTION:<name>.md -->` and `<!-- END_SECTION:<name>.md -->` markers. Cursor rules can use the same markers.
- `.claude-plugin/plugin.json` is the hand-maintained name, version, and description. Every other plugin manifest is generated from it and from `skills/`; do not edit them by hand.
- To add an agent, write one target module in `scripts/repo/plugins/targets/` (its generated files and directories, its hand-maintained sources and instruction directories, whether its plugin bundles the MCP server, its sign-in steps, and a `generate` function that writes through the `ArtifactWriter` it is given), list it in `scripts/repo/plugins/registry.mts`, add a `### <agent>` install section to `README.md`, and run `pnpm run generate`. Nothing else needs editing: the shipped-surface lists, the drift check, the `socket-connect` sign-in section, and the contract tests in `test/repo/unit/plugins/` all read the registry.

## Commits

- Use Conventional Commits: `<type>(<scope>): <description>`, lowercase. The `commit-msg` hook enforces this.
- Do not add AI attribution lines or trailers to commits or pull requests.
- Keep pull requests small: one logical change each.

## Content

- This repository is public. Do not commit secrets, tokens, personal home paths, or customer names. The `pre-commit` hook and `pnpm run check` scan for secrets and personal home paths.
- Default to no code comments. Write comments that describe the present state of the code.
- Name test fixtures with fictional names.

## Releases

- Set the version in `.claude-plugin/plugin.json`, run `pnpm run generate`, and merge. Then run the `ci: publish claude marketplace` workflow, first with `dry-run: true`. It tags `v<version>` and creates the GitHub release.
