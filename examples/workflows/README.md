# Example workflows

Drop-in GitHub workflows that carry the practices from
[docs/best-practices.md](../../docs/best-practices.md). Each file is
annotated with the practice it shows, and each one passes the doctor
practice gate itself: installs are sfw-wrapped and Socket runs in the
workflow.

| File | Shows |
| --- | --- |
| [ci.yml](ci.yml) | The fleet-shaped CI: the setup-and-install block up front (the fleet's one-composite leg), SocketDev/action, sfw-wrapped install, `socket doctor`, test |
| [weekly-update.yml](weekly-update.yml) | Fleet cadence naming: weekly `socket optimize --pin` on a Monday cron, result reviewed as a PR |
| [doctor-gate.yml](doctor-gate.yml) | `socket doctor` as the pull-request gate: exit 1 on any practice violation |

The fleet conventions on display:

- **Thin shells over composites.** Every job opens with the same
  setup-and-install leg (checkout + setup + cache + install). Fleet members
  write it as one call, `uses: ./.github/actions/fleet/setup-and-install`;
  the examples inline the parts and mark the composite's name so the shape
  stays visible.
- **Workflow names say the cadence or destination** (`weekly-update.yml`,
  `npm-publish.yml`), never the tool.
- **External actions pin the SHA with a label comment**; fleet composites
  are referenced by local `./` path, never a cross-repo `uses:@sha`.

Notes:

- Adjust the package manager to your repo; keep the `sfw` prefix on every
  install command.
- `socket doctor` adds `minimumReleaseAge: 10080` on first run. Commit that
  change - it is the soak-time policy landing in your repo.
- `socket optimize --pin` tightens overrides to exact versions. Drop the
  flag for the looser default.
