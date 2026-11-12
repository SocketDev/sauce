# Socket for Hermes Agent

Socket's dependency-security skills for [Hermes Agent](https://github.com/NousResearch/hermes-agent). Use them to check packages before you install them, scan projects, fix vulnerable dependencies, block malware at install time, and respond to supply-chain incidents.

This is a portable [Agent Plugins v1](https://agent-plugins.org) package, generated from this repository's `skills/` directory by `pnpm run generate`. Do not edit `plugin.json` or `skills/` here by hand; edit `skills/` at the repository root instead.

One install ships:

- `skills/`: every Socket skill, each in its own directory. Skills that are nested in this repository's `skills/` tree, such as `socket-fix/socket-dep-patch`, get their own top-level directory here, because Hermes loads skills only one level deep. Hermes names them `socket:<skill>`, for example `socket:socket-inspect`, `socket:socket-firewall`, and `socket:socket-dep-patch`. Run `skills_list` to see them all.

## Install

```bash
hermes plugins install SocketDev/skills/hermes
hermes plugins enable socket
```

Then start a new Hermes session.

## Connect to Socket

The skills work best with the hosted Socket MCP server, which signs you in through the browser. You do not paste an API key, and one sign-in covers every Socket organization your account can see.

Add the server once:

```bash
hermes mcp add socket --url https://mcp.socket.dev/ --auth oauth
```

Hermes opens a browser on first connection. To sign in ahead of time, or again later, run:

```bash
hermes mcp login socket
```

Start a new session after you sign in. The tools appear as `mcp__socket__<tool>`, for example `mcp__socket__depscore`, `mcp__socket__alerts`, and `mcp__socket__organizations`.

The plugin does not add the server for you. A portable plugin's `mcp.json` cannot turn on OAuth for a remote server in Hermes, and the Socket MCP server requires OAuth. The `socket:socket-connect` skill walks through the steps above.

The skills that scan and fix projects use the Socket CLI, which signs in separately with `socket login`. The `socket:socket-connect` skill covers that too.

## What it does on your machine

- **Network calls:** the MCP server sends package names, versions, and your organization slugs to `mcp.socket.dev`. CLI-based skills call the Socket API at `api.socket.dev` and upload dependency manifests when you ask for a scan.
- **Shell commands:** skills run the Socket CLI, Socket Firewall (`sfw`), `socket-patch`, and your package manager. Some suggest global installs such as `npm install -g socket`, `npm install -g sfw`, or `npm install -g @socketsecurity/socket-patch`. Every command goes through Hermes's normal command approval.
- **Project changes:** `socket:socket-fix` and its `socket:socket-dep-*` skills edit package manifests, lockfiles, and source code when you ask them to fix dependencies. `socket:socket-policy` edits `socket.yml`.
- **Credentials:** Hermes stores the MCP sign-in in its own MCP token store. The Socket CLI stores its own login. When a Socket API token is set in your environment (`SOCKET_CLI_API_TOKEN`, `SOCKET_SECURITY_API_KEY`, `SOCKET_API_TOKEN`, or `SOCKET_API_KEY`), some skills use it to call `api.socket.dev`. The plugin itself stores nothing and reads no credential files. Never paste a token into the chat.
- **Telemetry:** none from the plugin.
- **No background processes and no self-update.** Updates arrive only through `hermes plugins update socket`.

## License

MIT
