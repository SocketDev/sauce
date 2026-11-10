# Scan Codebase for Install/Build Locations

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

# Package Manager Reference

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

# GitHub Actions (Preferred for GitHub repos)

Use `SocketDev/action@v1` with `mode: patch`:

```yaml
- uses: SocketDev/action@v1
  with:
    mode: patch
    # patch-ecosystems: npm,pypi  (optional: limit to specific ecosystems)
    # patch-dry-run: false        (optional: dry run mode)
```

Place after `actions/checkout`, before install steps. No `socket-token` is needed for patch mode.

# GitLab CI

Add a step to install `socket-patch` and apply patches after dependency install. Use the appropriate package manager runner (see reference table above):

```yaml
before_script:
  - curl -fsSL https://raw.githubusercontent.com/SocketDev/socket-patch/main/install.sh | sh
  - npm install
  - socket-patch scan
  - socket-patch apply
```

# Bitbucket Pipelines

Add a step to install `socket-patch` and apply patches. Use the appropriate package manager runner (see reference table above):

```yaml
script:
  - curl -fsSL https://raw.githubusercontent.com/SocketDev/socket-patch/main/install.sh | sh
  - npm install
  - socket-patch scan
  - socket-patch apply
```

# Other CI/CD Systems (Jenkins, CircleCI, Travis, Azure, etc.)

Generic pattern for any CI system:

1. Install `socket-patch` via curl, npm, or the appropriate package manager runner (see reference table above)
2. Run your normal dependency install step
3. Run `socket-patch scan` to discover available patches
4. Run `socket-patch apply` after scan, before build

# Local Development (npm Projects)

Run `socket-patch setup` to add a postinstall hook to `package.json`:

```shell
socket-patch setup
```

This auto-adds a postinstall hook to your `package.json` scripts that runs `socket-patch scan && socket-patch apply` every time `npm install` runs.

# Dockerfile Patterns

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

# Makefile Patterns

Add a patch target that runs after install. Adapt commands to match the project's package manager:

```makefile
install:
 npm ci
 socket-patch scan
 socket-patch apply

build: install
 npm run build
```

# Generic Fallback

If the project uses an unusual build system, use the appropriate package manager runner (see reference table above):

- **Interpreted projects** (Python, Ruby): add `socket-patch scan && socket-patch apply` after `pip install` / `bundle install`
- **Compiled projects** (Rust, Go, Java): add `socket-patch scan && socket-patch apply` after dependency fetch, before compile
- **Containers**: add `RUN socket-patch scan` and `RUN socket-patch apply` layers after the install layer
