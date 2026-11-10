The Claude Code, Codex, Cursor, and Gemini CLI plugins add the hosted Socket MCP server (`https://mcp.socket.dev/`) for you. In Hermes Agent, or when the skills are installed without a plugin, add it once as shown below.

| Agent               | How to sign in                                                                                  |
| ------------------- | ----------------------------------------------------------------------------------------------- |
| Claude Code         | Run `/mcp`, pick the Socket server, then choose **Authenticate**. A browser window opens.       |
| Claude Code (shell) | `claude mcp login <server-name>`, using the name shown by `/mcp`. Add `--no-browser` over SSH.  |
| Codex               | Run `/mcp login socket`, or `codex mcp login socket` from a shell. Add `--no-browser` over SSH. |
| Cursor              | Open **Customize** in the sidebar, select the Socket server, and sign in to it.                 |
| Gemini CLI          | Run `/mcp auth socket`.                                                                         |
| Hermes Agent        | Add the server first (below). Sign in again later with `hermes mcp login socket`.               |

If the Socket server is not listed at all, add it by URL.

In Claude Code:

```shell
claude mcp add --transport http socket https://mcp.socket.dev/
```

In Hermes Agent, the Socket plugin does not add the server, so add it once with OAuth turned on. Hermes opens a browser to sign in. Then start a new session:

```shell
hermes mcp add socket --url https://mcp.socket.dev/ --auth oauth
```
