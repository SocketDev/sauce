---
name: socket-dep-cleanup
description:
  Evaluate and remove a single unused dependency from your project. Searches
  the entire codebase for all usages (imports, requires, config refs, scripts, type
  packages, indirect usage), reports findings, and performs full removal with verification.
---

# Dep Cleanup

Evaluate and remove a single unused dependency from your project. This skill targets ONE specific package at a time — searching the entire codebase for all usages, reporting findings, and performing full removal with build and test verification.

## When to Use

- The user wants to check if a specific dependency is still used
- The user wants to remove a package they suspect is unused
- The user is cleaning up after removing a feature or refactoring
- The user wants to reduce install size by trimming a specific unnecessary package
- The user asks whether a particular dependency is actually referenced anywhere

## Step 1: Identify the Target Package

If the user specifies a package name, use that. Otherwise, ask which package they want to evaluate.

If the user isn't sure which package to evaluate, help them pick one:

- Check `devDependencies` first — removing unused dev dependencies is lower risk
- Look for packages with names that suggest narrow or outdated functionality
- Suggest running `/socket-scan` first to get an overview of the dependency landscape

**One package at a time.** If the user wants to evaluate multiple packages, run this workflow once per package sequentially.

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

Search the **entire codebase** for every reference to the target package. Be thorough — check all of the following:

### Direct Import/Require Patterns

| Ecosystem     | Patterns to Search                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| npm/pnpm/yarn | `require('pkg')`, `require("pkg")`, `import ... from 'pkg'`, `import ... from "pkg"`, `import 'pkg'`, `import "pkg"`, `import('pkg')`, `import("pkg")`. Also check for subpath imports like `pkg/sub`.                                                                                                                                                                                                                                                                                                                                                          |
| PyPI          | `import pkg`, `from pkg import ...`. **Note:** the package name on PyPI often differs from the import name (e.g. `Pillow` → `PIL`, `beautifulsoup4` → `bs4`, `python-dotenv` → `dotenv`, `scikit-learn` → `sklearn`, `PyYAML` → `yaml`). Check both the package name and common import aliases. **Tip:** run `pip show <package-name>` — the output includes a `Location` field and the actual top-level package names are the directories at that location matching the package. Alternatively, check `top_level.txt` in the package's `.dist-info` directory. |
| Cargo         | `use crate_name::`, `extern crate crate_name`, references in proc-macro attributes. **Note:** hyphens in crate names become underscores in Rust code (e.g. `serde-json` → `serde_json`).                                                                                                                                                                                                                                                                                                                                                                        |
| Bundler       | `require 'gem_name'`, `require "gem_name"`, autoload references.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Maven         | `import groupId.artifactId.` or subpackage patterns in `.java` and `.kt` files. Match on the groupId prefix.                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| NuGet         | `using Namespace;` and `using static Namespace.` in `.cs` files. Match on the package's root namespace.                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Go            | Import paths in `.go` files matching the module path from `go.mod` `require` entries.                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

### Indirect Usage Detection

Some dependencies are used indirectly and will not appear in import statements. Check all of the following for the target package:

- **`@types/*` packages** — corresponds to a base package (e.g. `@types/node` supports Node.js APIs); check if the base package is used
- **Babel/ESLint/Jest/Prettier plugins** — referenced by short name in config files (e.g. `eslint-plugin-react` is listed as `react` in `.eslintrc`); search config files for the short name
- **CLI tools in `scripts`** — packages that provide binaries referenced in `package.json` `scripts` (e.g. `rimraf`, `concurrently`, `cross-env`); check the `scripts` block
- **Peer dependencies** — required by other installed packages; check if any installed package lists it as a peer dependency
- **Build tools and bundler plugins** — `webpack`, `vite`, `rollup`, `esbuild`, `parcel`, `turbopack` and their plugins; check config files
- **PostCSS/Tailwind plugins** — referenced in `postcss.config.*` or `tailwind.config.*`
- **Python entry points and console scripts** — packages providing CLI commands configured in `pyproject.toml` or `setup.cfg`
- **Bundler groups** — gems in `:development` or `:test` groups may only be used in specific contexts
- **Cargo build dependencies** — crates in `[build-dependencies]` are used by `build.rs`
- **Maven plugins** — `<plugin>` entries in `pom.xml` are not imported in code

### Where to Search

Search beyond just source code:

- Source files (`.ts`, `.js`, `.py`, `.rs`, `.go`, `.java`, `.cs`, `.rb`, etc.)
- Configuration files (`.eslintrc`, `babel.config.*`, `jest.config.*`, `webpack.config.*`, `vite.config.*`, etc.)
- `package.json` `scripts` block
- CI/CD configs (`.github/workflows/`, `.gitlab-ci.yml`, etc.)
- Shell scripts (`*.sh`)
- Dockerfiles
- Documentation that references the package as a runtime dependency

## Step 4: Report Findings

Present ALL findings to the user with file paths and line numbers.

### If No Usages Found

Report that the package appears to be unused:

```text
**{package-name}** — no usages found

Searched {N} files across the codebase. No direct imports, indirect references,
or configuration usage detected.

Proceeding with removal.
```

Then proceed to Step 5 (removal).

### If Usages Found

Show every usage location:

```text
**{package-name}** — found {N} usages

Direct imports:
  - src/utils/helper.ts:14 — import { merge } from '{package-name}'
  - src/api/handler.ts:3 — const pkg = require('{package-name}')

Indirect usage:
  - package.json:8 — "build": "{package-name} src/"  (CLI tool in scripts)
  - .eslintrc.json:5 — referenced as plugin shortname

Total: {N} locations in {M} files
```

Then ask the user: **"This package is used in {N} locations. Do you still want to remove it?"**

- If the user says **yes**, proceed to Step 5 (removal), which includes removing import statements and dead code
- If the user says **no**, stop and report that the package is in use

## Step 5: Full Removal

### 5a. Uninstall via Package Manager

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

### 5b. Remove Import Statements

Delete all import/require statements for the removed package across the codebase.

### 5c. Remove Dead Code

If any code blocks exist solely to use this package (e.g., a utility function that wraps the package, a middleware that depends entirely on it), remove that dead code too. Be conservative — only remove code that has no other purpose.

### 5d. Clean Up Config References

Remove references from configuration files:

- ESLint/Babel/Jest/Prettier plugin lists
- Build tool config (webpack loaders, Vite plugins, etc.)
- `package.json` scripts that use the package's CLI
- PostCSS/Tailwind plugin lists

### 5e. Remove Associated `@types/*`

If the removed package has a corresponding `@types/{package}` in devDependencies, remove that too (using the same package manager uninstall command).

## Step 6: Verify

Follow the standard build & test verification workflow (see `skills/_shared/docs/verify-build.md`):

1. **Build the project** using its standard build command
2. **Run the test suite** to catch any runtime dependency on the removed package
3. If something fails, identify what broke, re-add the package using the package manager's install/add command, and report the failure to the user

## Error Handling

- **Build or tests fail after removal**: Identify which removed code or missing module caused the failure by checking error messages. Re-add the package with the package manager's install/add command, restore removed code, and report that the package is still needed.
- **Package manager removal command fails**: The package may already have been removed from the lock file but still referenced in the manifest, or vice versa. Try manually editing the manifest file and re-running the package manager's install command.
- **False positive — package appears unused but is required**: Some packages are loaded dynamically, used as peer dependencies, or referenced only in build/CI scripts. When the search in Step 3 finds no usages but removal breaks the build, re-add the package and flag it as indirectly required.

## Tips

- Start with `devDependencies` — removing unused dev dependencies is lower risk than production ones
- When in doubt about indirect usage, flag it as "possibly used" rather than "definitely unused"
- Some packages are used only in CI, deployment scripts, or editor configs — the search in Step 3 covers these
- For PyPI, consult the package metadata on pypi.org if the import name is unclear
- For monorepos, check usage across all workspaces before removing a root dependency
- After cleanup, use the `/socket-scan` skill to verify no issues remain in the dependency set
