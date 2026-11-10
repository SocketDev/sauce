---
name: socket-connect
description:
  Connect your agent to Socket by signing in through the browser - no API key
  to copy or paste. Signs in to the hosted Socket MCP server (OAuth), lists every
  organization you belong to, and links the Socket CLI for scans.
---

# Connect to Socket

Sign in to Socket from the agent with OAuth. The user approves access in the browser, and the agent gets a token for their own account. That token covers every organization the user belongs to, so nobody copies an organization API token out of the dashboard.

The Claude Code, Codex, Cursor, and Gemini CLI plugins add the hosted Socket MCP server (`https://mcp.socket.dev/`) for you, and other Socket skills install it as a dependency, so most users already have it. In Hermes Agent, or when the skills are installed without a plugin, add it once as shown in Step 2.

## When to Use

- The user wants to connect, sign in, or log in to Socket from the agent
- Another Socket skill needs account access and none is configured
- A Socket tool returns 401, "needs authentication", or "not connected"
- The user belongs to several Socket organizations and wants to pick one
- The user asks how to use Socket without pasting an API key

## Step 1: Check Whether Socket Is Connected

Look for a Socket MCP tool named `organizations` among your available tools. The full tool name depends on how the server was added. For example, it can be `mcp__plugin_socket-connect_socket__organizations`, `mcp__socket__organizations`, or `mcp__socket-mcp__organizations`. Match on the server URL or the `organizations` suffix, never on one hard-coded prefix.

- If the tool exists, call it. A list of organizations means the user is connected. Go to Step 3.
- If the call fails with an authentication error, or the tool is missing, go to Step 2.

## Step 2: Sign In With the Browser

Tell the user how to sign in for their agent. Nobody needs an API key.

| Agent               | How to sign in                                                                                  |
| ------------------- | ----------------------------------------------------------------------------------------------- |
| Claude Code         | Run `/mcp`, pick the Socket server, then choose **Authenticate**. A browser window opens.       |
| Claude Code (shell) | `claude mcp login <server-name>`, using the name shown by `/mcp`. Add `--no-browser` over SSH.  |
| Cursor              | Open **Customize** in the sidebar, select the Socket server, and sign in to it.                 |
| Gemini CLI          | Run `/mcp auth socket`.                                                                         |
| Codex               | Run `/mcp login socket`, or `codex mcp login socket` from a shell. Add `--no-browser` over SSH. |
| Hermes Agent        | Add the server first (below). Sign in again later with `hermes mcp login socket`.               |

If the Socket server is not listed at all, add it by URL. In Claude Code:

```shell
claude mcp add --transport http socket https://mcp.socket.dev/
```

In Hermes Agent, the Socket plugin does not add the server, so add it once with OAuth turned on. Hermes opens a browser to sign in. Then start a new session:

```shell
hermes mcp add socket --url https://mcp.socket.dev/ --auth oauth
```

The browser shows Socket's sign-in and consent pages. If the user has no account, they can create a free one there. After they approve, call `organizations` again to confirm.

Non-interactive runs (`claude -p`, Agent SDK, CI) cannot open a browser. Sign in once interactively, or use an API token as described in Step 5.

## Step 3: Choose Which Organizations to Use

The `organizations` tool returns the organizations this sign-in can reach. Which ones that is depends on what the user granted on Socket's consent page.

- **One organization:** use it. If the user wants a different organization, clear the Socket server's sign-in (in Claude Code, `/mcp` or `claude mcp logout <server-name>`) and sign in again, choosing that organization on the consent page.
- **Several organizations:** use all of them by default, or the ones the user selects. Remember the selection for the rest of the session, and never narrow it silently.

Org-scoped tools such as `alerts` and `threat_feed` take one `org_slug` per call. To cover several organizations, call the tool once per organization and label each result with its organization.

## Step 4: Use Socket Through MCP

Once connected, prefer the MCP tools over pasted tokens:

- `depscore` - scores for one or more packages (used by `/socket-inspect`)
- `alerts` - open alerts across the organization's monitored packages
- `threat_feed` - recent malware and threat reports
- `package_files`, `package_file_contents`, `package_file_grep` - read a published package's files

## Step 5: Connect the Socket CLI (Scans and Fixes)

The MCP server does not create scans. `/socket-scan` and `/socket-fix` use the Socket CLI, which signs in separately. `socket login` needs an interactive terminal, so the agent cannot run it through its shell tool. Ask the user to run it themselves (in Claude Code, type `! pnpm dlx socket login`):

```shell
pnpm dlx socket login
```

- If the CLI opens a browser and shows a device code, the user approves it the same way as Step 2. No token is pasted.
- If the CLI instead prompts for an API token, that CLI release predates browser login. The current npm release still prompts for a token. Ask the user whether they want to create an API token in the dashboard and paste it into the masked prompt (never into the chat), or skip CLI-only features for now.

The CLI sets its default organization to the first one it finds. If that differs from the organization chosen in Step 3, pass `--org <slug>` to CLI commands, or ask before changing the default with `pnpm dlx socket config set defaultOrg <slug>`.

Verify the CLI without printing a credential:

```shell
pnpm dlx socket organization list --json --no-banner --no-spinner
```

For CI and other non-interactive environments, an organization API token in `SOCKET_CLI_API_TOKEN` remains the right choice. See `/socket-setup` for CI configuration.

## Error Handling

- **No Socket tools after installing the plugin:** list the agent's MCP servers (Claude Code, Codex: `/mcp`; Hermes Agent: `hermes mcp list`). If Socket is missing, add it as in Step 2; the Hermes plugin never adds it. Then restart the agent or reload MCP servers (Hermes Agent: `/reload-mcp` or a new session).
- **Browser does not open:** copy the URL the agent prints into a browser. Over SSH, Claude Code and Codex take a `--no-browser` option; other agents print the URL for you to open locally.
- **`organizations` returns an empty list:** the account has no organization yet. Create one at <https://socket.dev/dashboard>, then call `organizations` again.
- **401 after it worked before:** the session expired or was revoked. Sign in again from Step 2.
- **Wrong account:** clear the server's authentication in `/mcp` (or `claude mcp logout <server-name>`), then sign in again.

## Tips

- Never ask the user to paste an API token into the chat. Browser sign-in keeps the credential out of the conversation.
- Do not print credential values to confirm a connection. Call `organizations` instead.
- Use every organization the sign-in reaches unless the user selects fewer. To reach an organization the sign-in does not cover, sign in again instead of asking for a token.
- The MCP server and the Socket CLI sign in separately. Being connected over MCP does not make `pnpm dlx socket scan create` work.
- If the user has no account and does not want one, leave Socket unconnected. Public package lookups such as `depscore` may still work.
