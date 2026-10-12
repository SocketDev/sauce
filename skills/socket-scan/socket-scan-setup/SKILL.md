---
name: socket-scan-setup
description:
  Set up prerequisites for Socket scanning - install the CLI, configure
  user-owned authentication, and verify scan access. Use this before the first scan
  or when encountering auth errors.
---

# Scan Setup

Set up the Socket CLI and authentication so that `/socket-scan` works on the first try. This skill handles first-time setup, user-owned authentication, and troubleshooting auth errors.

## When to Use

- First-time scan setup - `/socket-scan` has never been run in this environment
- Auth errors - scan fails with 403, "org not found", or token errors
- CLI not installed - `socket: command not found`
- The user asks to configure Socket for scanning

## Setup Steps

### Step 1: Check Current Auth State

Check account access without printing credential values:

```shell
pnpm dlx socket organization list --json --no-banner --no-spinner
```

A successful result with a non-demo organization confirms account access. An empty result, demo-only result, or error leaves authentication unverified. Do not run `config get apiToken`; it prints the credential.

### Step 2: Ensure the Socket CLI Is Available

Use `pnpm dlx socket` to run the CLI. It fetches the latest version without a global install:

```shell
pnpm dlx socket --version
```

**Optional global install:** If you prefer a global `socket` command, install with `npm install -g socket@latest` (must be version **1.0.0 or higher**). If `npm install -g` fails due to permissions, `pnpm dlx socket` works as a drop-in prefix for all commands.

### Step 3: Configure Authentication

If the user has no account credential, ask whether they want to create an account or log in. If they decline, leave authentication unconfigured. Do not write an API token or default organization.

**For users with an existing account:** Set the `SOCKET_CLI_API_TOKEN` environment variable or run `pnpm dlx socket login`.

### Step 4: Verify Setup

Run the account check from Step 1. Treat an empty result, demo-only result, or error as unverified authentication. Do not print a token to confirm setup.

### Step 5: Test a Scan

Run a test scan only after the account check returns a non-demo organization:

```shell
pnpm dlx socket scan create . --tmp --json --no-banner --no-spinner
```

If the account check returns no non-demo organization or an error, do not report a Socket scan as available. Ask the user to log in or create an account. If they decline, offer a local SBOM:

```shell
pnpm dlx @cyclonedx/cdxgen -o bom.json -p
```

This creates a local dependency inventory. It does not query Socket or provide Socket analysis.

## Error Reference

| Error                       | Cause                                 | Fix                                                                          |
| --------------------------- | ------------------------------------- | ---------------------------------------------------------------------------- |
| `socket: command not found` | CLI not installed                     | Use `pnpm dlx socket` (recommended) or `npm install -g socket@latest`        |
| 403 / unauthorized          | Account access is missing or denied   | Run `pnpm dlx socket login` or configure a user-owned `SOCKET_CLI_API_TOKEN` |
| "org not found"             | The account lacks organization access | Log in with an account that has access to a Socket organization              |
| Outdated CLI (< 1.0.0)      | Global `socket` is v0.x (legacy)      | Use `pnpm dlx socket` (always latest) or `npm install -g socket@latest`      |
