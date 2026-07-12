---
name: socket-dep-patch
description:
  Apply Socket's binary-level security patches without changing dependency
  versions. Uses socket-patch apply to fix vulnerabilities in-place, then verifies
  automated patching is configured so patches persist across installs.
---

# Dep Patch

Apply Socket's binary-level security patches to vulnerable dependencies **without changing their version numbers**. This skill uses `socket-patch apply` to fix known vulnerabilities in-place. Patches are applied in bulk — `socket-patch apply` patches all available packages at once.

After applying patches, this skill checks whether the project is set up to **keep patches applied automatically** (via postinstall hooks, CI steps, or Dockerfile layers). If not, it walks through configuring automated patching.

## How This Differs from `/socket-dep-upgrade`

|                          | `/socket-dep-patch` (this skill)                                            | `/socket-dep-upgrade`                     |
| ------------------------ | --------------------------------------------------------------------------- | ----------------------------------------- |
| **Primary tool**         | `socket-patch apply`                                                        | `socket fix`                              |
| **What it does**         | Applies binary-level patches without changing versions                      | Upgrades dependency versions to fix CVEs  |
| **Version changes?**     | No                                                                          | Yes                                       |
| **Code changes needed?** | No                                                                          | Possibly (API migration for major bumps)  |
| **Scope**                | All patchable packages at once                                              | One dependency at a time                  |
| **When to use**          | You need fixes without version churn, or the upstream fix doesn't exist yet | You want to bring dependencies up to date |

Use `/socket-dep-patch` when you want to fix vulnerabilities without risking breaking changes from version upgrades. Use `/socket-dep-upgrade` when you want full version upgrades with automated code migration.

## When to Use

- The user wants to fix vulnerabilities without changing dependency versions
- The user wants to apply Socket's binary patches to their project
- A vulnerability has no upstream fix yet but Socket provides a patch
- The user wants a quick, low-risk security fix across all dependencies

## Prerequisites

- No API key is required for `socket-patch`. It works on the free tier.
- **Dependencies must be installed before patching.** `socket-patch` operates on installed packages (e.g. `node_modules/`). If dependencies are not yet installed, run the project's install command first (e.g. `npm install`, `pnpm install`, `bun install`, `pip install -r requirements.txt`).

## Step 1: Install socket-patch

Choose the installation method for your ecosystem:

| Method                   | Command                                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------- |
| npm (one-off)            | `pnpm dlx @socketsecurity/socket-patch apply`                                               |
| npm (global)             | `npm install -g @socketsecurity/socket-patch`                                               |
| pip                      | `pip install socket-patch`                                                                  |
| cargo                    | `cargo install socket-patch-cli`                                                            |
| Standalone (macOS/Linux) | `curl -fsSL https://raw.githubusercontent.com/SocketDev/socket-patch/main/install.sh \| sh` |

Verify installation:

```shell
socket-patch --version
```

## Step 2: Scan for Available Patches

Run `socket-patch scan` to discover which installed packages have Socket patches available. This downloads patch metadata to the `.socket/` folder without modifying any packages.

```shell
socket-patch scan
```

Review the output to see which packages have patches available and what vulnerabilities they address.

## Step 3: Apply Patches

Apply all patches discovered by `socket-patch scan`:

```shell
socket-patch apply
```

This applies patches from the `.socket/` folder to installed packages (e.g. within `node_modules/`). No version numbers change in your manifest or lock files.

After patching, verify the project still works:

1. Build the project
2. Run the full test suite
3. Check `.socket/manifest.json` for a summary of applied patches

## Step 4: Verify

1. Run `socket-patch scan` to confirm all available patches were applied
2. Run the build to ensure nothing breaks
3. Commit `.socket/manifest.json` to version control to track which patches are applied

## Step 5: Check Patch Setup

After patches are applied and verified, check whether the project is configured to **keep patches applied automatically** (i.e. after every dependency install). If not, patches will be lost the next time someone runs `npm install` or CI rebuilds `node_modules/`.

### What to Check

Scan the project for evidence of automated patching in any of these locations:

| Location                                                                                       | What Counts as Configured                                                                                       |
| ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `package.json` `scripts.postinstall`                                                           | Contains `socket-patch scan` and `socket-patch apply` (or `@socketsecurity/socket-patch`)                       |
| `.github/workflows/*.yml`                                                                      | Contains `SocketDev/action@v1` with `mode: patch`, OR a step running `socket-patch scan` / `socket-patch apply` |
| `.gitlab-ci.yml`                                                                               | Contains a step running `socket-patch scan` / `socket-patch apply`                                              |
| `bitbucket-pipelines.yml`                                                                      | Contains a step running `socket-patch scan` / `socket-patch apply`                                              |
| `Dockerfile` / `docker-compose.yml`                                                            | Contains a `RUN` layer with `socket-patch scan` / `socket-patch apply`                                          |
| `Makefile` / `Justfile`                                                                        | Contains a target that runs `socket-patch scan` / `socket-patch apply`                                          |
| Other CI configs (`.circleci/config.yml`, `Jenkinsfile`, `azure-pipelines.yml`, `.travis.yml`) | Contains a step running `socket-patch scan` / `socket-patch apply`                                              |

### Report Results

If automated patching **is** configured, report where:

```text
Patch setup check: OK

  Automated patching found in:
    - .github/workflows/ci.yml (SocketDev/action@v1 mode: patch)
    - package.json postinstall hook

  Patches will persist across installs.
```

If automated patching is **not** configured, warn the user and offer to set it up:

```text
Patch setup check: NOT CONFIGURED

  No automated patching found in CI, postinstall hooks, or Dockerfiles.
  Patches will be lost the next time dependencies are reinstalled.

  Would you like to set up automated patching? [yes/no]
```

If the user says yes (or if they don't respond and you're running inside `/socket-fix` Fix All mode), proceed to the Automated Patch Setup section below.

If the user says no, skip setup and finish.

---

## Automated Patch Setup

Set up automated patching so `socket-patch apply` runs after every dependency install, keeping patches persistent across installs and CI rebuilds.

### Scan Codebase for Install/Build Locations

Before configuring automation, scan the project to find ALL places where dependencies are installed and builds happen:

| Location                        | What to Look For                              |
| ------------------------------- | --------------------------------------------- |
| `package.json` scripts          | `install`, `postinstall`, `build`, `prebuild` |
| CI configs (all formats)        | install steps, build steps                    |
| `Makefile` / `Justfile`         | install and build targets                     |
| `Dockerfile` / `docker-compose` | `RUN install`, `RUN build` layers             |
| Shell scripts (`*.sh`)          | install/build commands                        |
| `pyproject.toml` / `setup.py`   | build system config                           |
| `Cargo.toml`                    | build scripts                                 |

For each location, record the file path, the install command, and where to insert `socket-patch scan` and `socket-patch apply` (after install, before build).

Present findings to the user before making changes.

### Package Manager Reference

Use the appropriate command to run `socket-patch` based on the project's package manager:

| Package Manager | Run socket-patch                                                                                                                                            |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| npm             | `pnpm dlx @socketsecurity/socket-patch scan` then `pnpm dlx @socketsecurity/socket-patch apply`                                                             |
| pnpm            | `pnpx @socketsecurity/socket-patch scan` then `pnpx @socketsecurity/socket-patch apply`                                                                     |
| yarn            | `pnpm dlx @socketsecurity/socket-patch scan` then `pnpm dlx @socketsecurity/socket-patch apply`                                                             |
| bun             | `bunx @socketsecurity/socket-patch scan` then `bunx @socketsecurity/socket-patch apply`                                                                     |
| deno            | `deno run npm:@socketsecurity/socket-patch scan` then `deno run npm:@socketsecurity/socket-patch apply`                                                     |
| Python          | `pipx run socket-patch scan && pipx run socket-patch apply` (if pipx available), else `pip install socket-patch && socket-patch scan && socket-patch apply` |
| Standalone      | `curl -fsSL https://raw.githubusercontent.com/SocketDev/socket-patch/main/install.sh                                                                        | sh`then`socket-patch scan && socket-patch apply` |
| GitHub Actions  | `SocketDev/action@v1` with `mode: patch` (preferred — handles scan+apply automatically)                                                                     |

Use the appropriate runner (`npx`, `pnpx`, `bunx`, etc.) based on the detected package manager in the sections below.

### GitHub Actions (Preferred for GitHub repos)

Use `SocketDev/action@v1` with `mode: patch`:

```yaml
- uses: SocketDev/action@v1
  with:
    mode: patch
    # patch-ecosystems: npm,pypi  (optional: limit to specific ecosystems)
    # patch-dry-run: false        (optional: dry run mode)
```

Place after `actions/checkout`, before install steps. No `socket-token` is needed for patch mode.

### GitLab CI

Add a step to install `socket-patch` and apply patches after dependency install. Use the appropriate package manager runner (see reference table above):

```yaml
before_script:
  - curl -fsSL https://raw.githubusercontent.com/SocketDev/socket-patch/main/install.sh | sh
  - npm install
  - socket-patch scan
  - socket-patch apply
```

### Bitbucket Pipelines

Add a step to install `socket-patch` and apply patches. Use the appropriate package manager runner (see reference table above):

```yaml
script:
  - curl -fsSL https://raw.githubusercontent.com/SocketDev/socket-patch/main/install.sh | sh
  - npm install
  - socket-patch scan
  - socket-patch apply
```

### Other CI/CD Systems (Jenkins, CircleCI, Travis, Azure, etc.)

Generic pattern for any CI system:

1. Install `socket-patch` via curl, npm, or the appropriate package manager runner (see reference table above)
2. Run your normal dependency install step
3. Run `socket-patch scan` to discover available patches
4. Run `socket-patch apply` after scan, before build

### Local Development (npm Projects)

Run `socket-patch setup` to add a postinstall hook to `package.json`:

```shell
socket-patch setup
```

This auto-adds a postinstall hook to your `package.json` scripts that runs `socket-patch scan && socket-patch apply` every time `npm install` runs.

### Dockerfile Patterns

Add a `RUN socket-patch apply` layer after the install layer. Use the appropriate runner for the project's package manager (e.g., `pnpx` for pnpm, `bunx` for bun):

```text
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
RUN pnpm dlx @socketsecurity/socket-patch scan
RUN pnpm dlx @socketsecurity/socket-patch apply
COPY . .
RUN npm run build
```

### Makefile Patterns

Add a patch target that runs after install. Adapt commands to match the project's package manager:

```makefile
install:
 npm ci
 socket-patch scan
 socket-patch apply

build: install
 npm run build
```

### Generic Fallback

If the project uses an unusual build system, use the appropriate package manager runner (see reference table above):

- **Interpreted projects** (Python, Ruby): add `socket-patch scan && socket-patch apply` after `pip install` / `bundle install`
- **Compiled projects** (Rust, Go, Java): add `socket-patch scan && socket-patch apply` after dependency fetch, before compile
- **Containers**: add `RUN socket-patch scan` and `RUN socket-patch apply` layers after the install layer

## Error Handling

- **`socket-patch` not found**: Install it using one of the methods in Step 1. For CI, ensure the install step runs before `socket-patch apply`.
- **"No .socket folder found, skipping patch application"**: Dependencies may not be installed, or `socket-patch scan` was not run first. Ensure dependencies are installed (e.g. `npm install`), then run `socket-patch scan` before `socket-patch apply`.
- **No patches available**: Run `socket-patch scan` first to check. If scan finds nothing, Socket doesn't have binary patches for the current vulnerabilities. Consider using the `/socket-dep-upgrade` skill to upgrade versions instead.
- **Build fails after patching**: Run `socket-patch scan` to identify which patches are available, then apply selectively. Report the failing patch so the user can decide whether to skip it.
- **Permission errors**: Ensure write access to `node_modules/` or the equivalent dependency directory.

## Tips

- `socket-patch apply` does not require an API key — it works on the free tier
- Use `SocketDev/action@v1` (correct casing) in GitHub workflow files
- For monorepos, use `patch-cwd` to target specific directories
- Commit `.socket/manifest.json` to track which patches are applied
- After patching, use the `/socket-scan` skill to verify no residual vulnerabilities remain
- Combine with the `/socket-dep-upgrade` skill for vulnerabilities that don't have binary patches available
