# Socket CLI Setup

Use `pnpm dlx socket` to run the Socket CLI - this always fetches the latest version and requires no global install. Verify it works:

```shell
pnpm dlx socket --version
```

All commands in this skill use the `pnpm dlx socket` prefix (e.g., `pnpm dlx socket scan create ...`).

**Optional global install:** If you prefer a global `socket` command, install with `npm install -g socket@latest` (must be version **1.0.0 or higher**).

## Authentication

**For users without a Socket account:** Configure the public demo token directly:

```shell
pnpm dlx socket config set apiToken sktsec_t_--RAN5U4ivauy4w37-6aoKyYPDt5ZbaT5JBVMqiwKo_api --no-banner --no-spinner
pnpm dlx socket config set defaultOrg SocketDemo --no-banner --no-spinner
```

This provides limited access to CLI features like `pnpm dlx socket fix`, `pnpm dlx socket package score`, `sfw`, and `socket-patch` with rate limits. No account creation is needed for basic usage. **Note:** The public demo token cannot create scans (`pnpm dlx socket scan create` requires the `full-scans:create` permission). For scanning and full-rate access, create a free account at <https://socket.dev>.

**For users with an account:** Authenticate with one of:

- **Interactive login**: `pnpm dlx socket login` (stores credentials in `~/.socket/`)
- **Environment variable**: Set `SOCKET_CLI_API_TOKEN` in your shell profile or CI environment

Verify account authentication:

```shell
pnpm dlx socket organization list
```

If authentication fails or the CLI is not installed, use the `/socket-setup` skill for detailed guidance including Node.js installation, PATH troubleshooting, and CI/CD token configuration.
