# Example workflows

Drop-in GitHub workflows that carry the practices from
[docs/best-practices.md](../../docs/best-practices.md). Each file is
annotated with the practice it shows, and each one passes the doctor
practice gate itself: installs are sfw-wrapped and Socket runs in the
workflow.

| File | Shows |
| --- | --- |
| [ci.yml](ci.yml) | The full practices CI: SocketDev/action, sfw-wrapped install, `socket doctor`, test |
| [socket-optimize.yml](socket-optimize.yml) | Weekly `socket optimize --pin` on a cron, with the result reviewed as a PR |
| [doctor-gate.yml](doctor-gate.yml) | `socket doctor` as a pull-request gate that fails on any practice violation |

Notes:

- Adjust the package manager to your repo; keep the `sfw` prefix on every
  install command.
- `socket doctor` adds `minimumReleaseAge: 10080` on first run. Commit that
  change - it is the soak-time policy landing in your repo.
- `socket optimize --pin` tightens overrides to exact versions. Drop the
  flag for the looser default.
