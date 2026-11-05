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

- `pnpm run generate` rebuilds `agents/README.md`, `README.md`, the plugin manifests, and `gemini-extension.json` from `skills/` and `package.json`. Run it after you change a skill, then commit the result. `pnpm run generate:check` fails when they are out of date.

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
