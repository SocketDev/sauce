# Best practices: soak time, sfw, and socket optimize

Socket's dependency-security practices in one place, with the exact commands
and config we run. These practices pair with the skills in this repo: skills
guide the agent, and the workflows, hooks, and CLI commands below enforce the
same rules without one.

## The projects

- **[SocketDev/skills](https://github.com/SocketDev/sauce)** - this repo.
  Agent Skill definitions for dependency security tasks.
- **[SocketDev/action](https://github.com/SocketDev/action)** - the GitHub
  Action. Runs Socket in CLI mode (scan, report) or Firewall mode (block on
  policy) inside a workflow.
- **Hooks** - the guard layer that runs beside skills: git hooks and agent
  hooks that block wrong-tooling runs (wrong test runner, wrong package
  manager, unsoaked dependency) before they cost a cycle. Where skills are
  advisory, hooks are the gate.

([SocketDev/workflows](https://github.com/SocketDev/workflows) is the Socket
Enterprise workflow set, a separate product surface - not part of this
practices path.)

## Soak time: the 7-day minimum release age

No dependency younger than 7 days installs. A fresh publish is where
typosquat and account-takeover payloads live for their first hours; the soak
window gives registries, scanners, and the publisher time to catch them.

pnpm enforces it natively via `minimumReleaseAge` in `pnpm-workspace.yaml`:

```yaml
# pnpm-workspace.yaml
minimumReleaseAge: 10080 # minutes = 7 days
```

`socket doctor` enforces the policy on every run - adds the key when absent,
raises it when it sits below the floor, and says so either way:

```text
$ socket doctor
ℹ doctor: soak-time: enforced at 7 days (minimumReleaseAge added to pnpm-workspace.yaml).

$ socket doctor
ℹ doctor: soak-time: already enforced at 7 days.
```

## sfw: wrap every package-manager invocation

[sfw](https://github.com/SocketDev/sfw-free) wraps the package manager so an
install cannot pull a malicious package in the first place. Prefix every
install command with it:

```shell
sfw npm install
sfw pip install requests
sfw cargo fetch
sfw uv pip install flask
```

In CI, [SocketDev/action](https://github.com/SocketDev/action) runs the same
firewall in Firewall mode, so the wrap holds for unattended installs too.

## socket optimize: the dependency-tree flows

`socket optimize` runs the tree-improving flows in order. Each stage is safe
to skip on its own rules and never blocks the next:

1. **Origin sync** - fast-forwards the default branch to origin
   (fast-forward only), so the run reads the latest project inputs.
2. **Pastoralist audit** - reviews the repo's package-manager overrides:
   which are still needed, which are stale, which provider flagged them.
3. **@socketregistry overrides** - applies Socket's hardened drop-in
   packages as overrides.
4. **Dependency update** - re-resolves the lockfile with the new overrides.
5. **Bundle-stub offer** - when the repo bundles with rolldown, esbuild, or
   rollup, prints the stub-plugin wiring for that bundler, so heavyweight
   modules the runtime never reaches get replaced with empty stubs.

```text
$ socket optimize
ℹ Fast-forwarded main to origin/main.
ℹ Pastoralist override audit complete.
ℹ Optimizing packages for pnpm v11.19.0.
✔ 12 overrides added, 3 updated.
ℹ This project bundles with rolldown. Its bundle can shrink further: stub
  heavyweight modules the static analyzer keeps but the runtime never
  reaches.
```

The one rule that rides every flow: a version, an override, or a stub is
applied only after the proof - the lockfile resolves, the suite passes, the
path is unreachable. Anything else is reported, never written.

## Example workflows

Annotated, drop-in workflows carrying these practices live in
[examples/workflows/](examples/workflows/README.md), shaped the fleet way:
thin shells over a shared setup-and-install block, cadence-named workflows
(`ci.yml`, `weekly-update.yml`, `doctor-gate.yml`), and SHA-pinned external
actions. Each one passes the doctor practice gate itself.
