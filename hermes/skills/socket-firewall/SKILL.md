---
name: socket-firewall
description: Run package installs through Socket Firewall (`sfw`) to block malware at download time, and handle a block when one happens. Use it when installing dependencies, when an install fails with a Socket block, or when setting up Enterprise policy and private registries.
metadata:
  category: protect
  requires: socket-connect
---

# Socket Firewall

Socket Firewall (`sfw`) sits between a package manager and its registry as an HTTP/HTTPS proxy. For every package the package manager downloads, it reads the name, version and registry, checks them against Socket's data and your organization's policy, and then allows or blocks the download. It checks every dependency depth, so transitive dependencies are covered too.

This skill covers running installs through `sfw`, reading a block, what to do after one, and Enterprise policy and private registries. For wiring the firewall into CI pipelines and Dockerfiles, use `/socket-setup`. This skill does not repeat that setup.

## When to Use

- Install, add, or update dependencies with malware blocking turned on
- An install failed with a 403 or a "blocked by the Socket Security Policy" message
- Check that the firewall is working on this machine
- Choose between Socket Firewall Free and Socket Firewall Enterprise
- Use the firewall with a private registry, mirror, Artifactory, Nexus, or CodeArtifact
- Apply an organization's policy (block, warn, monitor) to local installs
- Replace the older `socket npm` wrapper with `sfw`

## Free and Enterprise

There are two variants. Both use the same `sfw` command.

| Feature                     | Free                               | Enterprise                                                                  |
| --------------------------- | ---------------------------------- | --------------------------------------------------------------------------- |
| API key                     | Not needed, no config              | Required                                                                    |
| Modes                       | Wrapper only                       | Registry mode (recommended) and wrapper mode                                |
| What is blocked             | Confirmed (human-reviewed) malware | Whatever your organization policy sets to Block                             |
| AI-detected threats         | Warning only                       | Per policy                                                                  |
| Unknown or unscanned        | Not blocked                        | Configurable                                                                |
| Registries                  | Public registries only             | Public and private registries                                               |
| Allow-list                  | No                                 | Yes                                                                         |
| Dashboard                   | No                                 | Yes                                                                         |
| Telemetry                   | Always on, cannot be disabled      | Can be disabled                                                             |
| Package managers/ecosystems | npm, yarn, pnpm, pip, uv, cargo    | JS/TS, Python, Go, Java (Maven, Gradle), Ruby, Rust, .NET (NuGet), and more |

Sources: <https://docs.socket.dev/docs/socket-firewall-overview> and <https://docs.socket.dev/docs/socket-firewall-free>.

Plans: Socket Firewall Enterprise needs an API key tied to a Socket organization. See <https://socket.dev/pricing> for which plans include it. Do not tell the user which plan they need from memory. Send them to <https://socket.dev/pricing> for current plan details. If `sfw`, the dashboard, or the API says a feature is not available on the user's plan, say so plainly and link the pricing page.

## Step 1: Check That sfw Is Available

```shell
command -v sfw
```

If nothing prints, ask the user before installing anything globally. Offer the npm wrapper, or the standalone binary below:

```shell
npm i -g sfw
```

The `sfw` npm package downloads the matching Socket Firewall Free binary from GitHub releases, verifies its digest, and caches it. It checks for a newer binary once a day in the background. Set `SFW_SKIP_UPDATE_CHECK=1` to skip that check when a cached binary exists. It runs the binary with your terminal's input and output and exits with the same exit code.

On Alpine or other musl-based Linux, do not use the npm wrapper. It always downloads the glibc build (`sfw-free-linux-<arch>`). Use the `sfw-free-musl-linux-*` standalone binary instead.

<details><summary>Install a standalone binary instead (no Node.js)</summary>

Download the asset for your platform from <https://github.com/SocketDev/sfw-free/releases/latest>:

- `sfw-free-linux-x86_64`, `sfw-free-linux-arm64`
- `sfw-free-musl-linux-x86_64`, `sfw-free-musl-linux-arm64`
- `sfw-free-macos-arm64`, `sfw-free-macos-x86_64`
- `sfw-free-windows-x86_64.exe`, `sfw-free-windows-arm64.exe`

Rename it to `sfw`, make it executable, and put it on `PATH`. On macOS, clear the quarantine flag on the unsigned binary:

```shell
xattr -dr com.apple.quarantine ./path/to/sfw
```

On Alpine arm64, install the C++ runtime first:

```shell
apk add --no-cache libstdc++ libgcc
```

Enterprise binaries come from <https://github.com/SocketDev/firewall-release/releases> instead (asset names start with `sfw-`, for example `sfw-linux-x86_64`).

</details>

The only documented flag is `sfw --help`. Do not rely on other flags such as `--version` with the Free binary. If a `sfw --version` check (for example from `/socket-setup`) fails, use `command -v sfw` instead.

## Step 2: Clear Local Package Caches

`sfw` only sees network requests. A package already in the local cache installs without a check. Before the first protected install on a machine, or after a scare, clear the cache for the package manager in use:

| Package manager | Clear the cache                                            |
| --------------- | ---------------------------------------------------------- |
| npm             | `npm cache clean --force`                                  |
| yarn v1         | `yarn cache clean`                                         |
| yarn v2+        | `yarn cache clean --mirror`                                |
| pnpm            | `pnpm store prune` (unreferenced packages only; see below) |
| pip             | `pip cache purge`                                          |
| uv              | `uv cache clean`                                           |
| cargo           | `rm -fr ~/.cargo/registry ~/.cargo/git` (everything)       |

`pnpm store prune` keeps packages that any project still references, and those install with no network request, so `sfw` never checks them. For a full re-check, delete `node_modules` and the store directory that `pnpm store path` prints. Ask the user first.

Ask the user before running the cargo removal. It deletes every cached crate. Cargo's `cargo clean gc -Zgc` removes only unused crates, but it is unstable and needs a nightly toolchain.

## Step 3: Run Installs Through sfw

Put `sfw` in front of the package manager command. All arguments pass through unchanged.

```shell
sfw npm install
sfw npm install --save some-package@1.33.7
sfw yarn install
sfw pnpm install
sfw pip install requests
sfw uv pip install flask
sfw cargo fetch
```

Free supports npm, yarn, pnpm, pip, uv and cargo. Other package managers might work, but support is not guaranteed.

When this skill is active and the agent runs an install for the user, prefix it with `sfw`. That includes installs done for `/socket-fix`, `/socket-dep-upgrade` and `/socket-dep-replace`.

To make every install go through the firewall in an interactive shell, add an alias or a function to the shell profile (ask the user before editing their profile). Pick one. Do not add both: the shell expands the alias inside the function definition and the profile fails to load.

Option A, alias:

```shell
alias npm="sfw npm"
```

Option B, function (use instead of the alias, not with it):

```shell
npm() { sfw npm "$@"; }
```

On PowerShell:

```powershell
function npm { sfw npm @args }
```

To skip the alias for one command, run `command npm install lodash`, or call the package manager by its full path.

## Step 4: Confirm It Blocks

Socket publishes test packages that are blocked with the default policy, such as `lodahs` (a mistyped `lodash`). Run the test in a new directory outside the user's project, such as under the system temp directory. Create a `package.json` there first. Without one, npm installs into the nearest parent folder that has a `package.json` or `node_modules`, which could be the user's project. Run the test in a subshell, so the shell stays in the user's project for the steps that follow.

```shell
(
  cd "$(mktemp -d)" &&
  npm init -y &&
  sfw npm install lodahs
)
```

The install should fail. If it succeeds, one of these happened:

- The request did not go through the firewall.
- The package came from the local cache (see Step 2).
- The firewall could not reach or parse Socket's API and let the request through. Rerun with `SFW_DEBUG=true` to see errors, and report the result at <https://github.com/SocketDev/sfw-free/issues>. More test packages: <https://docs.socket.dev/docs/sample-malware-packages>.

## Step 5: Read a Block

When a download is blocked, the firewall returns HTTP **403** and the package manager fails, for example pnpm `ERR_PNPM_FETCH_403` or npm `E403`. Look for these in the output:

- Free: the package manager shows the 403, and `sfw` prints a Socket Firewall summary. The exact text varies by version.
- Enterprise service mode: `Package blocked for violating organization security policy` (see <https://github.com/SocketDev/firewall-release/wiki/Service-Setup>)
- Enterprise registry mode: `Access denied: Your download has been blocked by the Socket Security Policy. Reason: Known malware. Please contact your Security Team. Request ID: <id>`. The npm CLI shows this through its `npm-notice` header. The contact sentence can be changed by the firewall admin. If an Artifactory or Nexus instance sits in front of the firewall, it replaces this page with its own 403.

The exact terminal output varies by version and mode. Free prints a "Protected by Socket Firewall" banner even when nothing is blocked. Enterprise wrapper mode prints nothing extra by default unless a request is blocked or an error occurs.

<details><summary>Response headers and JSON report (Enterprise)</summary>

Registry mode adds these response headers:

- `X-Socket-Decision`: `allowed`, `blocked`, or `fail_open`
- `X-Socket-Block-Reason`: comma-separated alert types, such as `malware,typosquat`
- `X-Socket-Warn-Reason` and `X-Socket-Monitor-Reason`
- `X-Socket-Request-ID`: give this to your security team or Socket support

In Enterprise wrapper mode, set `SFW_JSON_REPORT_PATH` to write a JSON report of the run:

```shell
SFW_JSON_REPORT_PATH=./sfw-report.json sfw npm install
```

The report's `blocked` array lists each blocked package with a `purlString` (for example `pkg:npm/name@1.0.0`) and a `registryFqdn`. The full schema is not documented, so read only those fields.

</details>

## Step 6: Decide What to Do After a Block

1. **Do not bypass the firewall.** Do not rerun the install without `sfw`, with `command npm`, or against a different registry to get around a block. The default policy blocks only **Known Malware**. Possible typosquats and protestware warn by default, and telemetry is monitored.
2. **Identify the package.** Take the name and version from the error, the 403 URL, or the JSON report. Check whether it is a direct dependency or arrives through another package (for npm, `npm ls <name>`).
3. **Look it up.** Run `/socket-inspect` on the package, or open `https://socket.dev/<ecosystem>/package/<name>/overview/<version>`. If a Socket MCP `depscore` or `alerts` tool is available (match the tool by suffix, see `/socket-connect`), use it.
4. **Remove or replace it.**
   - Direct dependency: remove it, or use `/socket-dep-replace` to swap in an alternative.
   - Transitive dependency: upgrade or replace the parent that pulls it in (`/socket-dep-upgrade`), then install again through `sfw`.
5. **If it was already installed before the firewall was in place**, treat it as a possible compromise and follow `/socket-incident-response`.
6. **If you believe it is a false positive**, report it to support@socket.dev. Enterprise users can also ask their Socket admin to review the org policy (`/socket-policy`). Free has no allow-list.

Tell the user which package was blocked, why (if the output says), and what you plan to do. Wait for approval before removing or replacing dependencies.

## Step 7: Enterprise Wrapper Mode (Org Policy)

Enterprise wrapper mode applies your organization's policy to local installs. It uses the Enterprise binary from `SocketDev/firewall-release` and an API token. Docs: <https://docs.socket.dev/docs/socket-firewall-enterprise-wrapper-mode> and <https://docs.socket.dev/docs/socket-firewall-enterprise-wrapper-mode-configuration>.

### 7a. Token

The token needs the `packages` and `entitlements:list` scopes. The user creates it in the Socket dashboard (see `/socket-setup`, "Creating Tokens") and writes it into the config file themselves. Never ask the user to paste a token into chat, and never print one.

`sfw` reads the token from the environment or a dotenv-format `.sfw.config` file. The docs use `SOCKET_API_KEY`. `SOCKET_API_TOKEN` and `SOCKET_CLI_API_TOKEN` are also accepted.

```text
SOCKET_API_KEY=<your token>
```

Config file lookup:

- Default: `~/.sfw.config`, then `/run/secrets/dot-env-secrets`
- With `SFW_CONFIG_RELATIVE_PATHS` set: `./.sfw.config`, then parent directories, then the home directory, then `/run/secrets/dot-env-secrets`. Use this for a different token or org per repo. Add `.sfw.config` to `.gitignore` so the token is never committed.

### 7b. Supported Commands

Wrapper mode supports npm, yarn, pnpm, pip, pip3, uv, cargo, gem, bundle, dotnet, and go (Linux only). Poetry is not supported. Maven and Gradle need registry mode (Step 8).

### 7c. Private Registries

List private registries so the firewall inspects them instead of blocking them as unknown hosts:

```shell
SFW_CUSTOM_REGISTRIES='npm:packages.example.com/npm-mirror,pypi:packages.example.com/pypi-mirror'
```

- Each entry is `kind:fqdn`, `kind:fqdn/url-prefix`, `kind:protocol://fqdn` or `kind:protocol://fqdn/url-prefix`, with no trailing slash.
- Kinds: `npm`, `pypi`, `maven`, `golang`, `gem`, `cargo`, `nuget`.
- Special kinds: `block`; `wrap` (re-encrypts TLS without inspection; the client must trust the sfw CA); `bypass` (no TLS interception, for example for git).

### 7d. Other Settings

| Variable                              | Effect                                                        |
| ------------------------------------- | ------------------------------------------------------------- |
| `SFW_UNKNOWN_HOST_ACTION`             | `block` (default), `warn`, or `ignore` for unrecognized hosts |
| `SFW_JSON_REPORT_PATH`                | Write a JSON report of the run                                |
| `SFW_REPORT_MESSAGE`                  | Custom text in the report's "Need help?" section              |
| `SFW_TELEMETRY_DISABLED=true`         | Turn off telemetry                                            |
| `SFW_HTTP_PORT`, `SFW_HTTPS_PORT`     | Proxy ports (defaults 80 and 443)                             |
| `SFW_ALLOW_BAD_DESTINATION_CERT=true` | Accept invalid upstream certificates                          |
| `SFW_DEBUG=true`                      | Debug output                                                  |

## Step 8: Enterprise Registry Mode (Centralized)

Registry mode is the recommended Enterprise setup for teams. The firewall runs as a Docker container (`socketdev/socket-registry-firewall`), and package managers use it as their registry. No developer needs `sfw` installed.

- Downstream: clients point straight at the firewall, for example `npm config set registry https://firewall.company.com/npm/`.
- Upstream: Artifactory or Nexus remote repositories point at the firewall.
- It covers npm, PyPI, Maven, Cargo, RubyGems, NuGet, Go, Conda, VS Code Marketplace and OpenVSX, and Hugging Face.
- By default, API errors and unscanned packages are allowed with a warning (fail open). Admins can change both.

Its own config file is also named `socket.yml`, but it is the firewall's routing config, not the repository policy file the Socket CLI reads. Do not mix them up.

This is server infrastructure. Do not deploy it for the user. Point the admin to:

- <https://docs.socket.dev/docs/socket-firewall-enterprise-registry-mode>
- <https://docs.socket.dev/docs/socket-firewall-enterprise-registry-mode-installations>
- <https://docs.socket.dev/docs/socket-firewall-enterprise-registry-mode-configuration-reference>
- Artifactory: <https://docs.socket.dev/docs/socket-firewall-enterprise-registry-mode-artifactory-configuration>
- Nexus: <https://docs.socket.dev/docs/socket-firewall-enterprise-registry-mode-nexus-configuration>
- CodeArtifact: <https://docs.socket.dev/docs/socket-firewall-enterprise-registry-mode-codeartifact-configuration>

## CI and Docker

Use `/socket-setup` to add the firewall to GitHub Actions, GitLab CI, Bitbucket, other CI systems, and Dockerfiles. In short: the `SocketDev/action` GitHub Action installs `sfw` (`mode: firewall-free`, or `mode: firewall-enterprise` with a `socket-token` secret), and each install step still needs the `sfw` prefix. In CI, use an org API token stored as a secret, never a personal sign-in.

## Known Limitations

- Free blocks unrecognized hosts. Private registries such as a company npm mirror fail with a 403 under Free (for example `ERR_PNPM_FETCH_403`). Use Enterprise with `SFW_CUSTOM_REGISTRIES`, or install from that registry without the firewall only after the user agrees.
- Free may block non-registry downloads from hosts it does not recognize, such as tool binaries fetched during an install. Some common build-toolchain hosts are allowed.
- Yarn 3 can fail through `sfw` (Free and Enterprise) with an error about `httpsCaFilePath`. See the workaround at <https://github.com/SocketDev/firewall-release/wiki/Wrapper-Mode#caveats>.
- `npm stage` commands (npm 11.15.0+) currently fail through `sfw`. Run `npm stage` steps with plain npm.
- The firewall needs network access to Socket. It does not work offline.
- Free telemetry is always on. It sends a machine ID, the package names and versions it blocked or allowed, latency, errors, and the GitHub org name. Tell users who need it off that Enterprise can disable it.

## Tips

- Prefer `sfw` over the older `socket npm`, `socket npx`, `socket pnpm` and `socket yarn` wrappers. Socket's docs call Socket Firewall their recommended successor.
- Clear package caches once (Step 2). A cached package is never checked.
- A block is a result, not an error to work around. Investigate with `/socket-inspect` before anything else.
- `sfw` blocks at install time. Pair it with `/socket-scan` and `/socket-pr-alerts` to catch risks already in the dependency tree and in pull requests.
- For account access to Socket tools, use `/socket-connect`. `sfw` Free needs no account.
- Report false positives and false negatives to support@socket.dev. Report Free bugs at <https://github.com/SocketDev/sfw-free/issues>.
- Docs index for anything not covered here: <https://docs.socket.dev/llms.txt>.
