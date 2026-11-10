---
name: socket-dep-replace
description:
  Replace a dependency with an alternative package, eliminate it via code
  rewrite, or use socket-optimize for optimized replacements.
---

# Dep Replace

Replace a dependency with an alternative package, eliminate it via code rewrite, or use `socket-optimize` for optimized replacements. This skill targets ONE specific package at a time - building a full usage map, presenting replacement strategies, and executing the migration with build and test verification.

## When to Use

- The user wants to swap a dependency for a different package (e.g., migrating from `moment` to `dayjs`)
- The user wants to replace a flagged or unmaintained dependency
- The user wants to inline a trivial utility package (e.g., `is-odd`, `left-pad`)
- The user wants to use `socket-optimize` to find optimized replacements
- The user asks how to migrate away from a specific package

## Prerequisites

- **Socket CLI** - optional but recommended. Required for Strategy A (`socket-optimize`). Install via `/socket-setup` if not available.
- **Build and test commands** - the project should have a working build and test setup for verification.

## Step 1: Identify the Target Package

If the user specifies a package name, use that. If they also specify a replacement, note it for Step 5.

If the user isn't sure which package to replace, help them pick one:

- Suggest running `/socket-scan` first to identify flagged or low-score dependencies
- Check for packages with known maintenance issues or security alerts
- Look for trivial utility packages that could be inlined

**One package at a time.** If the user wants to replace multiple packages, run this workflow once per package sequentially.

## Step 2: Detect the Ecosystem

Identify which ecosystem the target package belongs to by checking manifest and lock files:

| Ecosystem | Manifest Files                                                           |
| --------- | ------------------------------------------------------------------------ |
| npm       | `package.json` + `package-lock.json`                                     |
| pnpm      | `package.json` + `pnpm-lock.yaml`                                        |
| yarn      | `package.json` + `yarn.lock`                                             |
| PyPI      | `requirements.txt`, `pyproject.toml`, `setup.py`, `setup.cfg`, `Pipfile` |
| Cargo     | `Cargo.toml`                                                             |
| Bundler   | `Gemfile`                                                                |
| Maven     | `pom.xml`                                                                |
| NuGet     | `*.csproj`, `packages.config`                                            |
| Go        | `go.mod`                                                                 |

For npm, pnpm, and yarn: differentiate by which lock file is present (`package-lock.json`, `pnpm-lock.yaml`, or `yarn.lock`).

## Step 3: Search for All Usages

Search the **entire codebase** for every reference to the target package. Be thorough - check all of the following:

### Direct Import/Require Patterns

| Ecosystem     | Patterns to Search                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| npm/pnpm/yarn | `require('pkg')`, `require("pkg")`, `import ... from 'pkg'`, `import ... from "pkg"`, `import 'pkg'`, `import "pkg"`, `import('pkg')`, `import("pkg")`. Also check for subpath imports like `pkg/sub`.                                                                                                                                                                                                                                                                                                                                                          |
| PyPI          | `import pkg`, `from pkg import ...`. **Note:** the package name on PyPI often differs from the import name (e.g. `Pillow` → `PIL`, `beautifulsoup4` → `bs4`, `python-dotenv` → `dotenv`, `scikit-learn` → `sklearn`, `PyYAML` → `yaml`). Check both the package name and common import aliases. **Tip:** run `pip show <package-name>` - the output includes a `Location` field and the actual top-level package names are the directories at that location matching the package. Alternatively, check `top_level.txt` in the package's `.dist-info` directory. |
| Cargo         | `use crate_name::`, `extern crate crate_name`, references in proc-macro attributes. **Note:** hyphens in crate names become underscores in Rust code (e.g. `serde-json` → `serde_json`).                                                                                                                                                                                                                                                                                                                                                                        |
| Bundler       | `require 'gem_name'`, `require "gem_name"`, autoload references.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Maven         | `import groupId.artifactId.` or subpackage patterns in `.java` and `.kt` files. Match on the groupId prefix.                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| NuGet         | `using Namespace;` and `using static Namespace.` in `.cs` files. Match on the package's root namespace.                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Go            | Import paths in `.go` files matching the module path from `go.mod` `require` entries.                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

### Indirect Usage Detection

Some dependencies are used indirectly and will not appear in import statements. Check all of the following for the target package:

- **`@types/*` packages** - corresponds to a base package (e.g. `@types/node` supports Node.js APIs); check if the base package is used
- **Babel/ESLint/Jest/Prettier plugins** - referenced by short name in config files (e.g. `eslint-plugin-react` is listed as `react` in `.eslintrc`); search config files for the short name
- **CLI tools in `scripts`** - packages that provide binaries referenced in `package.json` `scripts` (e.g. `rimraf`, `concurrently`, `cross-env`); check the `scripts` block
- **Peer dependencies** - required by other installed packages; check if any installed package lists it as a peer dependency
- **Build tools and bundler plugins** - `webpack`, `vite`, `rollup`, `esbuild`, `parcel`, `turbopack` and their plugins; check config files
- **PostCSS/Tailwind plugins** - referenced in `postcss.config.*` or `tailwind.config.*`
- **Python entry points and console scripts** - packages providing CLI commands configured in `pyproject.toml` or `setup.cfg`
- **Bundler groups** - gems in `:development` or `:test` groups may only be used in specific contexts
- **Cargo build dependencies** - crates in `[build-dependencies]` are used by `build.rs`
- **Maven plugins** - `<plugin>` entries in `pom.xml` are not imported in code

### Where to Search

Search beyond just source code:

- Source files (`.ts`, `.js`, `.py`, `.rs`, `.go`, `.java`, `.cs`, `.rb`, etc.)
- Configuration files (`.eslintrc`, `babel.config.*`, `jest.config.*`, `webpack.config.*`, `vite.config.*`, etc.)
- `package.json` `scripts` block
- CI/CD configs (`.github/workflows/`, `.gitlab-ci.yml`, etc.)
- Shell scripts (`*.sh`)
- Dockerfiles
- Documentation that references the package as a runtime dependency

### Build the Usage Map

**This is what distinguishes dep-replace from dep-cleanup.** For each call site, record:

- The **file path and line number**
- The **specific APIs used** (named imports, method calls, constructor invocations)
- The **usage pattern** (e.g., "uses `merge` for deep object merging", "uses `format` for date formatting")

This usage map drives the migration - it tells you exactly what API surface needs to be replaced.

```text
Usage map for 'lodash':

  src/utils/helper.ts:14 — import { merge, cloneDeep } from 'lodash'
    - merge (deep object merge, called with 2 args)
    - cloneDeep (object cloning)

  src/api/handler.ts:3 — import { get, set } from 'lodash'
    - get (nested property access with dot-path)
    - set (nested property assignment with dot-path)

  src/components/Table.tsx:8 — import { sortBy, groupBy } from 'lodash'
    - sortBy (array sorting by key)
    - groupBy (array grouping by key)

Unique APIs used: merge, cloneDeep, get, set, sortBy, groupBy (6 total)
```

## Step 4: Report Findings

Present ALL findings to the user with the full usage map:

```text
**{package-name}** — found {N} usages across {M} files

Usage map:
  {file}:{line} — {import statement}
    - {api} ({usage pattern})
    ...

Unique APIs used: {list} ({count} total)
```

If the package has zero usages, suggest using `/socket-dep-cleanup` instead (it's unused, not needing replacement).

## Step 5: Determine Replacement Strategy

Present three strategies in priority order. If the user already specified a replacement package, skip to Strategy B with that package pre-selected.

### Strategy A: `socket-optimize`

If the Socket CLI is installed:

1. Run `socket-optimize <package>` to get optimized replacement suggestions
2. Present the suggestions to the user with package names, descriptions, and Socket scores
3. If the user picks one, proceed to Step 6 with that replacement

If the Socket CLI is not installed, mention that `socket-optimize` is available via `/socket-setup` and move to Strategy B.

### Strategy B: Research Alternatives via `/socket-inspect`

1. Research candidate replacement packages - use knowledge of the ecosystem to identify 2-4 alternatives
2. For each candidate, gather via `/socket-inspect`:
   - Socket score and alerts
   - Number of dependencies
   - Package size
   - Maintenance status (last publish date, open issues)
3. Build an **API compatibility table** showing which APIs from the usage map each candidate supports:

```text
API Compatibility:

| API Used        | dayjs         | date-fns      | luxon         |
|-----------------|---------------|---------------|---------------|
| format()        | .format()     | format()      | .toFormat()   |
| parse()         | dayjs()       | parse()       | DateTime.fromFormat() |
| diff()          | .diff()       | differenceIn*()| .diff()      |
| add()           | .add()        | add*()        | .plus()       |
| isValid()       | .isValid()    | isValid()     | .isValid      |

Coverage: dayjs 5/5, date-fns 5/5, luxon 5/5
```

1. Present the comparison and let the user pick a replacement

### Strategy C: Inline Elimination

Suitable when ALL of the following are true:

- The package implements less than ~50 lines of logic
- The package has no or minimal transitive dependencies
- Only 1-3 APIs from the package are used in the codebase

If the package qualifies:

1. Propose an inline implementation for each used API
2. Show the user the proposed code
3. If approved, the inline code will be placed in a local utility file during Step 6

**Always ask user approval before proceeding with any strategy.**

## Step 6: Execute the Migration

### 6a. Install Replacement Package (Strategies A & B)

| Ecosystem | Install Command                                                         |
| --------- | ----------------------------------------------------------------------- |
| npm       | `npm install {package}`                                                 |
| pnpm      | `pnpm add {package}`                                                    |
| yarn      | `yarn add {package}`                                                    |
| PyPI      | `pip install {package}` or add to `requirements.txt` / `pyproject.toml` |
| Cargo     | `cargo add {package}`                                                   |
| Bundler   | Add to `Gemfile`, then `bundle install`                                 |
| Maven     | Add `<dependency>` to `pom.xml`, then `mvn dependency:resolve`          |
| NuGet     | `dotnet add package {package}`                                          |
| Go        | `go get {package}`                                                      |

For Strategy C (inline), skip this step.

### 6b. Rewrite Import Statements

- **Strategies A & B**: Update all import/require statements to use the new package name and its API surface
- **Strategy C**: Replace imports with a reference to the new local utility file (e.g., `import { isOdd } from './utils/is-odd'`)

For Strategy C, create the local utility file with the inline implementation.

### 6c. Rewrite API Call Sites

Using the usage map from Step 3, rewrite each call site:

- **Rename APIs** if the replacement uses different names (e.g., `moment.format()` → `dayjs.format()`)
- **Adjust signatures** if the replacement has different parameter orders or types
- **Handle behavioral differences** - note any cases where the replacement behaves differently and add comments or adapter code

### 6d. Remove Original Package

| Ecosystem | Removal Command                                                                                                                 |
| --------- | ------------------------------------------------------------------------------------------------------------------------------- |
| npm       | `npm uninstall {package}`                                                                                                       |
| pnpm      | `pnpm remove {package}`                                                                                                         |
| yarn      | `yarn remove {package}`                                                                                                         |
| PyPI      | Edit `requirements.txt` / `pyproject.toml` directly to remove the line, then `pip install -r requirements.txt` or `poetry lock` |
| Cargo     | `cargo remove {package}`                                                                                                        |
| Bundler   | Edit `Gemfile` to remove the entry, then `bundle install`                                                                       |
| Maven     | Edit `pom.xml` to remove the `<dependency>` block, then `mvn dependency:resolve`                                                |
| NuGet     | `dotnet remove package {package}`                                                                                               |
| Go        | Edit `go.mod` to remove the entry, then `go mod tidy`                                                                           |

### 6e. Handle `@types/*` Packages

- Remove `@types/{old-package}` if it exists in devDependencies
- Install `@types/{new-package}` if the replacement needs it and it exists

### 6f. Clean Up Config References

Update any configuration files that reference the old package:

- ESLint/Babel/Jest/Prettier plugin lists
- Build tool config (webpack loaders, Vite plugins, etc.)
- `package.json` scripts that use the package's CLI
- PostCSS/Tailwind plugin lists

## Step 7: Verify

Follow the standard build & test verification workflow:

1. **Build the project** using its standard build command
2. **Run the test suite** to catch any issues with the replacement
3. **Search for leftover references** to the old package name across the codebase
4. If something fails, **revert all changes** - restore the original package, revert code changes, and report the failure to the user

## Error Handling

- **Build or tests fail after migration**: Check error messages to identify whether the issue is a missing API, a behavioral difference, or a type mismatch. Revert all changes and report the specific incompatibility.
- **No suitable replacement found**: Report that no alternative meets the criteria. Suggest the user check Socket's package page for more options or consider whether the dependency is truly needed.
- **Replacement package has worse Socket score**: Warn the user that the replacement may introduce new risks. Let them decide whether to proceed.
- **Partial API coverage**: If no single replacement covers all used APIs, report the gap and let the user decide - they may want to use multiple packages or inline the uncovered APIs.
- **`socket-optimize` not available**: Fall back to Strategy B (manual research).

## How This Differs from /socket-dep-cleanup

| Aspect           | /socket-dep-cleanup               | /socket-dep-replace                                   |
| ---------------- | --------------------------------- | ----------------------------------------------------- |
| **Goal**         | Remove an unused dependency       | Swap a used dependency for an alternative             |
| **Precondition** | Package is (suspected) unused     | Package IS used but needs replacement                 |
| **Usage search** | Determines IF the package is used | Builds a detailed map of WHAT APIs are used           |
| **Code changes** | Remove dead imports and code      | Rewrite imports and call sites to use the replacement |
| **Outcome**      | Fewer dependencies                | Same or fewer dependencies, different package         |

## Tips

- For large migrations (many call sites or complex API differences), use subagents to parallelize the rewrite across files
- Run `/socket-scan` after replacement to verify the new dependency's security posture
- When replacing a package used across many files, consider creating a thin adapter module first, then swapping the implementation behind it
- For Strategy C (inline), keep the utility file small and well-tested - don't inline complex logic
- If the user isn't sure which replacement to pick, Strategy B's API compatibility table helps make an informed decision
