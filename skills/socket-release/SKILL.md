---
name: socket-release
description:
  Stand up SocketDev publishing (npm, crates.io, GitHub releases, Homebrew
  tap) in a repo — copy in the socket-release kit from a sauce checkout and
  run its bootstrap through name reservation, GitHub environments, npm
  trusted publisher, publishing-access tightening, staged publish config,
  and verification.
disable-model-invocation: true
---

# Socket Release Setup

Install the socket-release kit into the current repo and stand publishing
up. Everything destructive is dry-run by default; the bootstrap prints the
exact next command after every run, and every human moment renders as a
🖐 HUMAN GATE — stop and show it, never improvise around it.

## Steps

1. **Get the kit source.** Shallow-clone sauce to the canonical clone home:

   ```
   git clone --depth=1 --single-branch https://github.com/SocketDev/sauce.git ~/.socket/_wheelhouse/repo-clones/SocketDev-sauce
   ```

   Done when: `~/.socket/_wheelhouse/repo-clones/SocketDev-sauce/release-kit/install.mts` exists.

2. **Install the kit.** Plan first, then apply with the channels this repo
   publishes on (`npm`, `crates`, `github-release`, `brew`):

   ```
   node ~/.socket/_wheelhouse/repo-clones/SocketDev-sauce/release-kit/install.mts --target . --channels npm,github-release
   node ~/.socket/_wheelhouse/repo-clones/SocketDev-sauce/release-kit/install.mts --target . --channels npm,github-release --apply
   ```

   Done when: the same command with `--verify` exits 0.

3. **Pin the kit dependencies.** The payload imports plain specifiers; add
   the exact pins:

   ```
   pnpm add -D @socketsecurity/lib@6.5.2 @socketsecurity/sdk@4.1.3 playwright-core@1.61.1
   ```

   Done when: `node scripts/socket-release/bootstrap.mts preflight` shows
   the `kit-deps-resolvable` check passing.

4. **Bootstrap.** Run the plan, then follow `nextCommand` and the gates:

   ```
   node scripts/socket-release/bootstrap.mts
   node scripts/socket-release/bootstrap.mts --apply
   ```

   The run stops at human gates (reserve-name consent, npm web-2FA,
   staged-placeholder promote, GitHub 403 fallback) — render the gate and
   wait. Done when: `node scripts/socket-release/bootstrap.mts verify`
   exits 0 and reports the stood-up detail (trusted publisher conforming,
   environments restricted, publishing access staged-only).

## Browser law

Playwright browser law (verbatim, non-negotiable):

- Launch ONLY via openNpmBrowserSession (scripts/socket-release/publish-infra/npm/browser-session.mts) on the durable profile ~/.config/socket-wheelhouse/staged-browser-profile.
- The launch shape is channel + chromiumSandbox: true + headless + the two sanctioned ignoreDefaultArgs entries, and nothing else — never an args array, never a sandbox-disabling flag.
- Login is NEVER scripted: the operator signs in once in the headed window; no password, OTP, or cookie passes through the process.
- All npm browser tools share the ONE durable profile so a single sign-in covers every tool.
- npm auth is decided by the /-/whoami BODY on the website origin, never the HTTP status.
- A human-verification challenge PAUSES the run for the operator with a visible countdown and is never retried blindly.

## Operating the channels

- **npm staged publishing**: see [npm-publish](npm-publish/SKILL.md)
- **GitHub releases + ORDER RULE**: see [gh-release](gh-release/SKILL.md)
- **crates.io staged model**: see [crates-publish](crates-publish/SKILL.md)
- **Homebrew tap bumps**: see [brew-tap](brew-tap/SKILL.md)
