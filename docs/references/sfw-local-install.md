# Socket Firewall — local install

Install Socket Firewall (sfw) enterprise on your dev machine so every
package fetch — `npm install`, `pnpm add`, `cargo build`, `pip install`,
etc. — runs through the same firewall checks that CI runs. Mirrors the
shim setup in [`SocketDev/socket-registry/.github/actions/setup`](https://github.com/SocketDev/socket-registry/blob/main/.github/actions/setup/action.yml)
exactly, so local and CI behavior stay aligned.

## Prerequisites

- A Socket API token with firewall scopes from app.socket.dev → API tokens.
- `gh auth login` set up (the enterprise binary lives in the private
  `SocketDev/firewall-release` repo).
- macOS or Linux (Windows works in CI but the install script below is
  unix-only; adapt as needed).

## Install

### 1. Put the API token in `~/.sfw.config`

dotenv format, owner-only permissions:

```bash
touch ~/.sfw.config
chmod 600 ~/.sfw.config
echo 'SOCKET_API_TOKEN=<your-rotated-token>' > ~/.sfw.config
```

The canonical variable name is `SOCKET_API_TOKEN`. The legacy name
`SOCKET_API_KEY` is still accepted as an alias for one cycle so
existing dev configs don't break in lockstep with the rename. Both
are distinct from `SOCKET_CLI_API_TOKEN` (socket-cli's separate
setting). Set `chmod 600` BEFORE the token lands.

sfw also reads the env var directly, so you can put it in `~/.zshrc`
instead with the same name. The dotenv file is preferred because it's
namespaced and unaffected by shell-init order.

### 2. Download the enterprise binary

Pull the version + sha256 from `socket-registry/external-tools.json`
(canonical fleet pin):

```bash
TOOLS=~/projects/socket-registry/external-tools.json
SFW_VERSION=$(node -e "console.log(require('$TOOLS').sfw.version)")
PLATFORM=darwin-arm64   # or: darwin-x64, linux-x64, linux-arm64, linux-x64-musl, linux-arm64-musl
ASSET=$(node -e "console.log(require('$TOOLS').sfw.enterprise.checksums['$PLATFORM'].asset)")
SHA=$(node -e "console.log(require('$TOOLS').sfw.enterprise.checksums['$PLATFORM'].sha256)")

mkdir -p ~/.socket/sfw/bin
gh release download "v$SFW_VERSION" --repo SocketDev/firewall-release \
  --pattern "$ASSET" --output ~/.socket/sfw/bin/sfw-$SFW_VERSION --clobber

ACTUAL=$(shasum -a 256 ~/.socket/sfw/bin/sfw-$SFW_VERSION | cut -d' ' -f1)
[ "$ACTUAL" = "$SHA" ] || { echo "sha mismatch"; exit 1; }
chmod +x ~/.socket/sfw/bin/sfw-$SFW_VERSION
ln -sfn ~/.socket/sfw/bin/sfw-$SFW_VERSION ~/.socket/sfw/bin/sfw
```

### 3. Generate the shims

Save this as `~/.socket/sfw/regenerate-shims.sh` and `chmod +x` it.
Re-run it whenever you install or uninstall a wrapped tool.

The shim list — `npm yarn pnpm pip pip3 uv cargo gem bundler nuget`
(plus `go` on Linux) — mirrors socket-registry's setup action. For each
command:

- If the real binary is on PATH, write a wrapper that strips the shim
  dir from PATH and execs `<sfw> <real> "$@"`.
- If the real binary is missing, write a helpful-error stub that prints
  the install hint and exits 127.

The stub matters: without it, a workflow that calls a missing tool
fails with a generic "command not found" instead of a self-explanatory
"× sfw: nuget is not installed on this runner. Install NuGet from …".

See the canonical CI version in
[`socket-registry/.github/actions/setup/action.yml`](https://github.com/SocketDev/socket-registry/blob/main/.github/actions/setup/action.yml)
under the "Create sfw shims" step.

### 4. Add the shim dir to PATH

```bash
echo '
# Socket Firewall (sfw) enterprise — wraps npm/pnpm/cargo/uv/pip3/gem/bundler.
# Token in ~/.sfw.config (chmod 600). To bypass: PATH="${PATH/$HOME\/.socket\/sfw\/shims:/}" <cmd>
export PATH="$HOME/.socket/sfw/shims:$PATH"' >> ~/.zshrc
```

Open a fresh shell. `which npm` should resolve to `~/.socket/sfw/shims/npm`,
and `npm --version` should print `Protected by Socket Firewall` before
the version number.

## Drift watch

The sfw version + per-platform sha256s live in
`socket-registry/external-tools.json`. When CI bumps that file, your
local install drifts. Re-run the install steps above whenever you pull
socket-registry. The local file `~/.socket/sfw/bin/sfw-<old-version>` is
safe to keep — the `sfw` symlink is what matters.

CLAUDE.md's "Drift watch" rule applies here: if you see a different sfw
version pinned in another fleet repo, opt for the latest. The repo with
the newer version is canonical.

## Bypass for one command

```bash
PATH="${PATH/$HOME\/.socket\/sfw\/shims:/}" npm install
```

Useful when debugging an install issue you suspect sfw is causing — but
prefer to file a real fix rather than living in bypass mode.

## Uninstall

```bash
rm -rf ~/.socket/sfw
rm ~/.sfw.config
# Remove the PATH export from ~/.zshrc by hand.
```

The token in `~/.sfw.config` should be revoked at app.socket.dev as well
once you remove it locally.
