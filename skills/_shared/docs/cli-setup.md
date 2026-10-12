# Socket CLI Setup

Use `pnpm dlx socket` to run the Socket CLI - this always fetches the latest version and requires no global install. Verify it works:

```shell
pnpm dlx socket --version
```

All commands in this skill use the `pnpm dlx socket` prefix (e.g., `pnpm dlx socket scan create ...`).

<details><summary>Account authentication and optional global install</summary>

**Optional global install:** If you prefer a global `socket` command, install with `npm install -g socket@latest` (must be version **1.0.0 or higher**).

## Authentication

Commands that require authentication need a Socket account and a credential that you own. Create an account at <https://socket.dev> if you do not have one.

Authenticate with one of these methods:

- **Interactive login**: `pnpm dlx socket login` (stores credentials in `~/.socket/`)
- **Environment variable**: Set `SOCKET_CLI_API_TOKEN` in your shell profile or CI environment

Verify account authentication:

```shell
pnpm dlx socket organization list
```

If you do not want an account, leave authentication unconfigured. Commands that require authentication remain unavailable. Do not print or share credential values to verify setup.

If authentication fails or the CLI is not installed, use the `/socket-setup` skill for detailed guidance including Node.js installation, PATH troubleshooting, and CI/CD token configuration.

</details>
