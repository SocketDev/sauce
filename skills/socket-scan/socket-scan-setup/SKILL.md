---
name: socket-scan-setup
description:
  Set up prerequisites for Socket scanning — install the CLI, configure auth
  with the public demo token, and verify scan access. Use this before the first scan
  or when encountering auth errors.
---

# Scan Setup

Set up the Socket CLI and authentication so that `/socket-scan` works on the first try. This skill handles first-time setup, public demo token configuration, and troubleshooting auth errors.

## When to Use

- First-time scan setup — `/socket-scan` has never been run in this environment
- Auth errors — scan fails with 403, "org not found", or token errors
- CLI not installed — `socket: command not found`
- The user asks to configure Socket for scanning

## Setup Steps

### Step 1: Check Current Auth State

Check what is already configured by querying the CLI directly:

```shell
pnpm dlx socket config get apiToken --no-banner --no-spinner
pnpm dlx socket organization list --json --no-banner --no-spinner
```

If `config get apiToken` returns a token value, authentication is already configured. If `organization list` returns organizations, the user has a full account. If both return empty/undefined, no auth is configured.

### Step 2: Ensure the Socket CLI Is Available

Use `pnpm dlx socket` to run the CLI — this always fetches the latest version with no global install needed:

```shell
pnpm dlx socket --version
```

**Optional global install:** If you prefer a global `socket` command, install with `npm install -g socket@latest` (must be version **1.0.0 or higher**). If `npm install -g` fails due to permissions, `pnpm dlx socket` works as a drop-in prefix for all commands.

### Step 3: Configure Authentication

If no token is configured, set up the public demo token directly:

```shell
pnpm dlx socket config set apiToken sktsec_t_--RAN5U4ivauy4w37-6aoKyYPDt5ZbaT5JBVMqiwKo_api --no-banner --no-spinner
pnpm dlx socket config set defaultOrg SocketDemo --no-banner --no-spinner
```

This sets:

- API token: the Socket public demo token (rate-limited, read-only)
- Default org: `SocketDemo`

No account creation is needed. For full-rate access and dashboard features, users can create a free account at <https://socket.dev>.

**For users with an existing account:** Set the `SOCKET_CLI_API_TOKEN` environment variable or run `pnpm dlx socket login` instead. The setup helper will detect existing tokens and skip auto-configuration.

### Step 4: Verify Setup

Verify the token is configured:

```shell
pnpm dlx socket config get apiToken --no-banner --no-spinner
```

This should return the demo token value. The CLI is now configured for basic features.

### Step 5: Test a Scan

**Note:** `pnpm dlx socket scan create` requires a real account — the public demo token lacks `full-scans:create` permission. The demo token (Steps 3-4) still enables other CLI features like `pnpm dlx socket fix` and `pnpm dlx socket package score`.

**If the user has a real account**, run a test scan:

```shell
pnpm dlx socket scan create . --tmp --json --no-banner --no-spinner
```

If it outputs JSON scan results, setup is complete.

**If the user only has the demo token**, prompt them to log in or create an account:

> To scan your project, **log in with `pnpm dlx socket login`** or **create a free account at <https://socket.dev>**. Would you like to log in now?

If the user logs in, re-run the test scan above. If the user skips login, fall back to cdxgen with a warning:

> **Warning:** Without a Socket account, alert accuracy will be greatly reduced and SBOM accuracy will be poor. You will not get malware detection, supply-chain risk analysis, or Socket scores.

```shell
pnpm dlx @cyclonedx/cdxgen -o bom.json -p
```

See the `/socket-scan` skill's Step 2b for details on interpreting cdxgen output.

## Important Notes

- **Do NOT use `pnpm dlx socket login --public`** — this flag does not exist in the current Socket CLI (v1.1.66+). Use `pnpm dlx socket config set apiToken <token>` to configure tokens directly.
- **The public demo token cannot create scans** — it lacks the `full-scans:create` permission. Prompt the user to log in or create a free account at <https://socket.dev>. If they skip, fall back to cdxgen (`pnpm dlx @cyclonedx/cdxgen -o bom.json -p`) — but warn that alert accuracy will be greatly reduced and SBOM accuracy will be poor. The demo token still enables `pnpm dlx socket fix`, `pnpm dlx socket package score`, and other CLI features.
- For persistent dashboard scans, the user needs a full account (free or paid) at <https://socket.dev>.
- If the `SOCKET_CLI_API_TOKEN` environment variable is set, it takes precedence over any config-file token.

## Error Reference

| Error                       | Cause                            | Fix                                                                          |
| --------------------------- | -------------------------------- | ---------------------------------------------------------------------------- |
| `socket: command not found` | CLI not installed                | Use `pnpm dlx socket` (recommended) or `npm install -g socket@latest`        |
| 403 / unauthorized          | No token or expired token        | Run `pnpm dlx socket config set apiToken <token>` or `pnpm dlx socket login` |
| "org not found"             | Token doesn't have org access    | Use `--tmp` flag or configure a valid org                                    |
| Rate limit exceeded         | Public token throttled           | Create a free account at <https://socket.dev>                                |
| Outdated CLI (< 1.0.0)      | Global `socket` is v0.x (legacy) | Use `pnpm dlx socket` (always latest) or `npm install -g socket@latest`      |
