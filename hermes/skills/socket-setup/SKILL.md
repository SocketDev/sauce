---
name: socket-setup
description: Set up Socket - connect your account through browser sign-in,
  install the CLI, configure policies and CI tokens, and set up CI/CD for
  firewall or patch modes across GitHub, GitLab, Bitbucket, and other systems.
metadata:
  category: setup
  requires: socket-connect
---

# Setup

## When to Use

- User wants to get started with Socket
- User needs to install/configure the Socket CLI
- User wants to authenticate with Socket
- User wants to set up Socket Firewall
- User wants to set up socket-patch for automated patching
- User wants to add Socket to CI/CD pipelines
- User wants to configure Socket policies (`socket.yml`)
- User wants to set up API tokens for CI or local development
- User is having trouble authenticating
- User wants to install Socket tools globally for local development
- User wants to integrate Socket into Dockerfiles

## Step 1: Check Prerequisites

Ask each tool for its version. A `command not found` error means the tool is not installed:

```shell
node --version
socket --version
sfw --version
socket-patch --version
```

Detect the package manager from the lock file in the project root - the command prints only the files that exist:

```shell
ls -d package-lock.json pnpm-lock.yaml yarn.lock bun.lock bun.lockb 2>/dev/null || true
```

`package-lock.json` means npm, `pnpm-lock.yaml` means pnpm, `yarn.lock` means yarn, and `bun.lock` or `bun.lockb` means bun. With no lock file, ask the user which package manager the project uses.

Handle results:

- If `node --version` fails: prompt the user to install Node.js. Suggest:
  - **nvm** (recommended): `curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash` then `nvm install 20`
  - **Homebrew** (macOS): `brew install node`
  - **Official installer**: <https://nodejs.org/>
- If `node --version` reports below v18: warn that Node.js 18+ is required and suggest upgrading
- If `socket --version` reports below 1.0.0: warn that the Socket CLI is below 1.x and prompt to update with `npm install -g socket@latest`
- If `socket --version` fails: proceed to Step 3 (Install the CLI)

## Step 2: Ask About Socket Account

Ask the user whether they have or want to create a Socket account. There are three tiers:

- **No account**: Finish installing the CLI and leave authentication unconfigured. Commands that require authentication remain unavailable.
- **Free account**: Create one at <https://socket.dev> to use account features supported by your plan.
  - Sign up / sign in: <https://socket.dev/auth/login>, or sign in from the agent with `/socket-connect`
- **Enterprise account**: All free account features plus reachability analysis (`socket scan reach`), policy configuration (`socket.yml`), and organization-level management.

Store the account tier for subsequent steps. If the user has no account, do not configure a credential or default organization.

## Step 3: Install the CLI

- Prerequisites: Node.js 18+ (verified in Step 1)
- `npm install -g socket`
- After install, confirm the version is >= 1.x:

  ```shell
  socket --version
  ```

- If the version is still below 1.x after install, error and suggest `npm install -g socket@latest`
- PATH troubleshooting: if `socket` is not found, check that the npm global bin directory is in `PATH`. Print the global install prefix with `npm prefix -g`; the bin directory is `<prefix>/bin` on macOS and Linux, and the prefix itself on Windows

## Step 4: Authenticate

### No account

If the user does not want an account, leave authentication unconfigured and continue installation. Mark commands that require authentication as unavailable. Do not set an API token or default organization.

### Free or Enterprise account

Sign in through the browser. Do not ask the user to copy an API token out of the dashboard for local use.

- **Agent (MCP):** run the `/socket-connect` skill. It signs in to the hosted Socket MCP server with OAuth and lists every organization the user belongs to. If the user belongs to several, use all of them unless the user selects specific ones.
- **CLI:** the user runs `socket login` in their own terminal (it needs an interactive TTY). CLI releases with browser login show a device code to approve in the browser. Older releases prompt for an API token instead; in that case, ask before having the user create one.
- **CI and other non-interactive environments:** an organization API token in `SOCKET_CLI_API_TOKEN` (see API Token Configuration below)
- Verify: `socket organization list`
- **Authentication is required for full-rate scanning (`socket scan create`) and `socket fix`**, dashboard access, and organization management

## Step 5: Ask What to Set Up

Ask which features the user wants to install. Check each feature's requirements before you configure it.

- **Firewall** (`sfw`) - free mode needs no API key; enterprise mode needs a user-owned credential
- **Patches** (`socket-patch apply`) - authentication-dependent actions need account authentication
- **Scanning** (`socket scan create`) - requires verified account authentication
- **Fix** (`socket fix`) - requires verified account authentication
- **Global Tools** - installation does not confirm authentication
- **Dockerfile Integration** - installation does not confirm authentication
- **Policies** (`socket.yml`) - enterprise only

If the user has no account or authentication is unverified, report authentication-dependent actions as unavailable. Continue with installation tasks that do not require authentication.

Route to the appropriate section(s) below.

## Step 6: Global Tools Installation

Ask the user if they want to install Socket tools globally (for local development) or just for CI.

If global, install all tools via npm:

```shell
npm install -g socket
npm install -g sfw
npm install -g @socketsecurity/socket-patch
```

After installing, verify each tool is available:

```shell
socket --version
sfw --version
socket-patch --version
```

Confirm all three print a version rather than `command not found`.

If any tool fails to install, check PATH and retry. `npm prefix -g` prints the global install prefix; the bin directory is `<prefix>/bin` on macOS and Linux, and the prefix itself on Windows.

## Step 7: Detect SCM and CI System

<!-- BEGIN_SECTION:ci-setup.md -->

### Detecting the CI/CD System

List the CI config files that exist in the project root - the command prints only the ones that are present:

```shell
ls -d .github/workflows .gitlab-ci.yml bitbucket-pipelines.yml Jenkinsfile .circleci/config.yml .travis.yml azure-pipelines.yml 2>/dev/null || true
```

Map each result to its CI system:

| CI System           | Config File               |
| ------------------- | ------------------------- |
| GitHub Actions      | `.github/workflows/*.yml` |
| GitLab CI           | `.gitlab-ci.yml`          |
| Bitbucket Pipelines | `bitbucket-pipelines.yml` |
| Jenkins             | `Jenkinsfile`             |
| CircleCI            | `.circleci/config.yml`    |
| Travis CI           | `.travis.yml`             |
| Azure Pipelines     | `azure-pipelines.yml`     |

If none of these files are present, treat the project as Generic / manual setup.

### Detecting the SCM Provider

Run `git remote -v` and match:

- `github.com` → GitHub
- `gitlab.com` or self-hosted GitLab → GitLab
- `bitbucket.org` → Bitbucket
- Other / not a git repo → Generic

The SCM suggests the likely CI system, but the CI config files found above take precedence.

### Integration Patterns

#### GitHub Actions

Use `SocketDev/action@v1` after `actions/checkout` and before install steps:

```yaml
- uses: SocketDev/action@v1
  with:
    mode: <mode> # firewall, firewall-free, or patch
```

#### GitLab CI / Bitbucket Pipelines / Generic

Install the Socket CLI or tool, then run it in a `before_script` or dedicated step after dependency install.

<!-- END_SECTION:ci-setup.md -->

## Firewall Setup

### Installing sfw per Package Manager

| Package Manager | Install sfw                                                                                                         |
| --------------- | ------------------------------------------------------------------------------------------------------------------- |
| npm             | `npm install -g sfw`                                                                                                |
| pnpm            | `pnpm add -g sfw`                                                                                                   |
| bun             | `bun add -g sfw`                                                                                                    |
| Standalone      | `curl -fsSL https://socket.dev/download/sfw/latest/{platform} -o /usr/local/bin/sfw && chmod +x /usr/local/bin/sfw` |

Replace `{platform}` with `linux-x64`, `darwin-arm64`, etc. as appropriate.

All Socket tools (sfw, socket-patch, socket CLI) are npm packages. The standalone curl method remains available for CI environments that may not have npm.

### GitHub Actions

- Use SocketDev/action@v1
- Free tier: mode: firewall-free (no socket-token needed)
- Enterprise: mode: firewall, socket-token: ${{ secrets.SOCKET_API_KEY }}
- Insert after actions/checkout, before install steps
- Prefix install commands with sfw (sfw npm install, sfw pip install, etc.)
- Guide user to set up GitHub secret if enterprise
- If GitHub: also offer to install the Socket Security GitHub App
  (github.com/apps/socket-security) for automatic PR scanning

### GitLab CI

- Add a `before_script` or dedicated stage to install `sfw`
- Install via npm: `npm install -g sfw`
- Or install standalone binary:

  ```bash
  curl -fsSL https://socket.dev/download/sfw/latest/linux-x64 -o /usr/local/bin/sfw && chmod +x /usr/local/bin/sfw
  ```

- Prefix install commands with sfw (`sfw npm install`, `sfw pip install`, etc.)
- Enterprise: set `SOCKET_CLI_API_TOKEN` as CI/CD variable in GitLab settings

### Bitbucket Pipelines

- Add pipe step to install `sfw` binary:

  ```bash
  curl -fsSL https://socket.dev/download/sfw/latest/linux-x64 -o /usr/local/bin/sfw && chmod +x /usr/local/bin/sfw
  ```

- Prefix install commands with sfw
- Enterprise: set `SOCKET_CLI_API_TOKEN` as repository variable

### Generic CI/CD

- Download `sfw` binary:

  ```bash
  # Linux x64
  curl -fsSL https://socket.dev/download/sfw/latest/linux-x64 -o /usr/local/bin/sfw && chmod +x /usr/local/bin/sfw
  # macOS arm64
  curl -fsSL https://socket.dev/download/sfw/latest/darwin-arm64 -o /usr/local/bin/sfw && chmod +x /usr/local/bin/sfw
  ```

- Or install via npm: `npm install -g sfw`
- Prefix install commands with sfw
- Set `SOCKET_CLI_API_TOKEN` as env var for enterprise

### Local Development

- `npm install -g sfw` (or standalone binary as above)
- Usage: `sfw npm install`, `sfw pip install`, etc.

## Patch Infrastructure Setup

Set up automated patching so `socket-patch apply` runs after every dependency install. For one-time manual patching, use the `/socket-dep-patch` skill instead.

<!-- BEGIN_SECTION:patch-automation.md -->

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
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| npm             | `npx @socketsecurity/socket-patch scan` then `npx @socketsecurity/socket-patch apply`                                                                       |
| pnpm            | `pnpm dlx @socketsecurity/socket-patch scan` then `pnpm dlx @socketsecurity/socket-patch apply`                                                             |
| yarn            | `npx @socketsecurity/socket-patch scan` then `npx @socketsecurity/socket-patch apply`                                                                       |
| bun             | `bunx @socketsecurity/socket-patch scan` then `bunx @socketsecurity/socket-patch apply`                                                                     |
| deno            | `deno run npm:@socketsecurity/socket-patch scan` then `deno run npm:@socketsecurity/socket-patch apply`                                                     |
| Python          | `pipx run socket-patch scan && pipx run socket-patch apply` (if pipx available), else `pip install socket-patch && socket-patch scan && socket-patch apply` |
| Standalone      | `curl -fsSL https://raw.githubusercontent.com/SocketDev/socket-patch/main/install.sh \| sh` then `socket-patch scan && socket-patch apply`                  |
| GitHub Actions  | `SocketDev/action@v1` with `mode: patch` (preferred - handles scan+apply automatically)                                                                     |

Use the runner that matches the detected package manager in the sections below: `npx` for npm and yarn, `pnpm dlx` for pnpm, `bunx` for bun.

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

Add a `RUN socket-patch apply` layer after the install layer. Use the appropriate runner for the project's package manager (e.g. `pnpm dlx` for pnpm, `bunx` for bun):

```dockerfile
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

<!-- END_SECTION:patch-automation.md -->

## Dockerfile Integration

Detect Dockerfiles and edit them directly to integrate Socket's firewall and/or patch tools.

### Step 1: Detect Dockerfiles

Find every Dockerfile in the project:

```shell
find . -type f \( -name 'Dockerfile' -o -name 'Dockerfile.*' -o -name '*.Dockerfile' -o -name 'Containerfile' \) -not -path '*/node_modules/*' -not -path '*/.git/*'
```

Read each file that the command lists and record, per file:

- Each `RUN` line that installs dependencies - `npm ci`, `npm install`, `yarn install`, `pnpm install`, `bun install`, `pip install`, `bundle install`, `cargo build`, `go mod download` - along with its line number and ecosystem
- Whether the file already mentions `sfw`
- Whether the file already mentions `socket-patch`

If no Dockerfiles are found or none contain dependency install steps, skip this section.

### Step 2: Read and Edit Dockerfiles

For each Dockerfile that has install steps, read the file and apply edits directly.

**Determine the mode** based on what the user chose in Step 5 (Firewall, Patches, or both).

**For each install line** recorded in Step 1:

- **Firewall mode**: Insert `RUN npm install -g sfw` on a new line before the install step. Prefix the install command with `sfw` (e.g., `RUN npm ci` → `RUN sfw npm ci`).
- **Patch mode**: Insert `RUN pnpm dlx @socketsecurity/socket-patch scan` and `RUN pnpm dlx @socketsecurity/socket-patch apply` on new lines after the install step, before any build or COPY steps.
- **Both modes**: Apply both sets of changes (sfw install + prefix before, socket-patch after).

**Rules**:

- Only modify stages that have dependency install steps (multi-stage build awareness - check for `FROM` lines to identify stage boundaries)
- Skip lines that already contain `sfw` or `socket-patch` to ensure idempotency
- Use the appropriate package manager runner for socket-patch (`npx` for npm and yarn, `pnpm dlx` for pnpm, `bunx` for bun - see Package Manager Reference table)

### Step 3: Present Changes for Approval

Before writing the modified Dockerfile, present the proposed changes to the user and explain each edit:

<details><summary>What each mode inserts, with a before/after Dockerfile example</summary>

- **Firewall**: inserts `RUN npm install -g sfw` before the install step, prefixes the install command with `sfw`
- **Patches**: inserts `RUN pnpm dlx @socketsecurity/socket-patch scan` and `RUN pnpm dlx @socketsecurity/socket-patch apply` after the install step, before build/copy steps

Only write the file after the user approves.

**Example** - a Dockerfile before and after (both modes):

Before:

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
```

After:

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install -g sfw
RUN sfw npm ci
RUN pnpm dlx @socketsecurity/socket-patch scan
RUN pnpm dlx @socketsecurity/socket-patch apply
COPY . .
RUN npm run build
```

</details>

## Socket Policy Configuration

> **Enterprise only** - free tier users cannot configure policies. Skip this section if on the free tier.

Configure Socket policies to control which issues are flagged during scans and CI checks.

### Repository-Level Policy (`socket.yml`)

Create `socket.yml` in the repository root with `version: 2` and these default issue rules, then adjust the values with the user:

<details><summary>The default socket.yml issue rules and what error/warn/ignore mean</summary>

```text
version: 2
issueRules:
  # CVE severity thresholds
  criticalCVE: error # Block on critical CVEs
  highCVE: warn # Warn on high CVEs
  mediumCVE: ignore # Ignore medium CVEs

  # Supply-chain alerts
  installScripts: error # Block packages with install scripts
  networkAccess: warn # Warn on unexpected network access
  shellAccess: warn # Warn on shell execution
  filesystemAccess: ignore # Ignore filesystem access alerts
  envVarsAccess: warn # Warn on environment variable reads
  obfuscatedCode: error # Block obfuscated code

  # Malware
  malware: error # Always block malware

  # License compliance
  gplLicense: warn # Warn on GPL licenses
  noLicense: warn # Warn on packages with no license
  nonPermissiveLicense: warn # Warn on restrictive licenses

projectIgnorePaths:
  - 'test/**'
  - 'tests/**'
  - 'examples/**'
  - 'docs/**'
  - '__fixtures__/**'
```

Issue rule values:

- `error` - fail the check / block the PR
- `warn` - report but don't fail
- `ignore` - suppress entirely

</details>

### Dashboard Policy Management (Enterprise)

For enterprise customers, policies can also be managed via the Socket dashboard:

- **Organization-level**: `https://socket.dev/dashboard/org/{ORG}/settings/policies`
- **Repository-level**: `https://socket.dev/dashboard/org/{ORG}/repo/{REPO}/settings/policies`

### Policy Priority Order

When multiple policies exist, they are applied in this order (highest priority first):

1. Repository `socket.yml` in repo root
2. Organization-level dashboard policy
3. Socket defaults

Repository-level settings override organization-level settings, which override defaults.

## API Token Configuration

Different Socket features use different tokens. For local use, prefer browser sign-in (`/socket-connect` and `socket login`) over API tokens. Use API tokens for CI and other environments that cannot open a browser.

### Token Types

| Token               | Environment Variable           | Used By                               | Required For                                               |
| ------------------- | ------------------------------ | ------------------------------------- | ---------------------------------------------------------- |
| CLI API Token       | `SOCKET_CLI_API_TOKEN`         | Socket CLI (`socket` commands), CI/CD | Enterprise scans, `socket fix`, `socket organization list` |
| Security API Key    | `SOCKET_SECURITY_API_KEY`      | Batch PURL API (`api.socket.dev`)     | Package inspection, license auditing                       |
| GitHub Action Token | `socket-token` (GitHub secret) | `SocketDev/action@v1`                 | Enterprise firewall mode in GitHub Actions                 |

### Creating Tokens

1. Sign in to the Socket dashboard: <https://socket.dev/auth/login>
2. Navigate to your organization's API tokens page: `https://socket.dev/dashboard/org/{ORG}/settings/integrations/api-tokens`
3. Create a new token with the appropriate scope
4. Copy the token value - it is only shown once

### Setting Tokens per CI System

| CI System           | How to Set Secrets                                                            |
| ------------------- | ----------------------------------------------------------------------------- |
| GitHub Actions      | Repository Settings → Secrets and variables → Actions → New repository secret |
| GitLab CI           | Settings → CI/CD → Variables → Add variable (masked, protected)               |
| Bitbucket Pipelines | Repository settings → Repository variables                                    |
| CircleCI            | Project Settings → Environment Variables                                      |
| Jenkins             | Credentials → Add Credentials → Secret text                                   |
| Azure Pipelines     | Pipelines → Library → Variable groups                                         |

### Local Development

For local development, authenticate using one of:

- **Browser sign-in (recommended)**: `/socket-connect` for the agent's Socket MCP tools, and `socket login` for the CLI. The MCP sign-in never needs a pasted token; `socket login` needs one only on CLI releases without browser login, including the current npm release.
- **Environment variable**: Set `SOCKET_CLI_API_TOKEN` in your shell profile or `.env.local`
- **Per-project**: Add `SOCKET_SECURITY_API_KEY` to `.env.local` (ensure `.env.local` is in `.gitignore`)

**Never commit API tokens to version control.** Use `socket login` locally and environment variables / secrets in CI.

## Error Handling

- **`socket: command not found`**: Ensure Node.js 18+ is installed, then run `npm install -g socket`. Check that the npm global bin directory is in `PATH` - `npm prefix -g` prints the global prefix, and the bin directory is `<prefix>/bin` on macOS and Linux, or the prefix itself on Windows.
- **`socket login` fails**: Check network connectivity. If behind a proxy, ensure `HTTPS_PROXY` is set. `socket login` needs an interactive terminal: have the user run it in their own shell rather than through the agent. Use `/socket-connect` for MCP tools. Offer a manually created `SOCKET_CLI_API_TOKEN` only if the user agrees.
- **`socket organization list` returns empty**: The API token may lack organization access. Verify the token at <https://socket.dev/dashboard> and ensure it has the correct scopes.
- **`sfw` not intercepting installs**: Ensure `sfw` is in `PATH` before the package manager. In CI, verify the install step runs before any dependency install commands.
- **GitHub Action fails with permission errors**: Ensure the `socket-token` secret is set correctly in the repository settings and the workflow has `contents: read` permission.
- **Socket CLI version < 1.x**: Run `npm install -g socket@latest` to update. Verify with `socket --version`.
- **Dockerfile editing issues**: Re-run the Dockerfile `find` command from the Dockerfile Integration section to verify which files and lines need changes. Only edit stages with dependency install steps and skip lines that already contain `sfw` or `socket-patch`.

## Tips

- Never commit API tokens. Use browser sign-in (`/socket-connect`, `socket login`) locally, env vars in CI.
- Never ask the user to paste a token into the chat.
- If the user has no account, leave authentication unconfigured. Do not assign a default organization or shared credential.

- Account features require a user-owned account credential. Follow the feature instructions to verify access.
- Use `SocketDev/action@v1` (correct casing) in GitHub workflow files.
- For monorepos, use `patch-cwd` to target specific directories.
- After setup, use the `/socket-scan` skill for a first audit and the `/socket-inspect` skill for package inspection.
- For GitHub repos, consider also installing the Socket Security GitHub App
  for automatic PR scanning.
- Run `socket --version`, `sfw --version`, and `socket-patch --version` at any time to verify tool installation status.
- Run the Dockerfile `find` command from the Dockerfile Integration section to locate all Dockerfiles before manual editing.
- The generated `socket.yml` uses `version: 2` - ensure this line is preserved when editing policies.
