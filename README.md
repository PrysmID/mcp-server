# `@prysmid/mcp` — Official Prysmid MCP server

Manage your Prysmid auth workspace from any MCP-compatible agent: Claude Code, Cursor, Continue, your own runtime — anything that speaks the Model Context Protocol.

## What it does

Exposes the full Prysmid platform API as MCP tools so an agent can:

- create workspaces
- configure login policies (passwords, MFA, passkey-first, lockout)
- add identity providers (Google, GitHub, Microsoft, generic OIDC)
- create OIDC apps (with redirect URIs, PKCE, dev mode)
- manage users (invite, list, remove)
- update branding (logos, colors, label policy)
- manage SMTP overrides
- query subscription / billing state

## Tools

The tool surface comes from three layers, merged at startup:

1. **Hand-written** (`src/tools/*.ts`) — polished schemas with rich
   descriptions for the operations agents reach for first
   (`list_workspaces`, `add_idp`, `create_oidc_app`, …).
2. **Curated** (`src/tools/curated.ts`) — multi-step orchestrators an
   agent would otherwise have to assemble itself:
   `setup_prysmid_workspace`, `enable_google_login`, `prysmid_setup_check`.
3. **Auto-generated** (`src/tools/generated/*.ts`) — one tool per
   remaining REST operation, emitted by `scripts/generate-tools.ts` from
   the live OpenAPI spec at `https://api.prysmid.com/openapi.json`.
   Hand-written names always win on collision; near-duplicates
   (handwritten `add_idp` vs generated `create_idp`) are resolved by an
   explicit alias map in `src/index.ts`.

Regenerate after the API schema changes:

```bash
npm run gen-tools
```

## Install

```bash
claude mcp add prysmid -- npx -y @prysmid/mcp
```

(or the equivalent for your agent — Cursor, Continue, etc.)

## Authentication

Three modes, resolved in this order on every startup:

1. **Static bearer** — set `PRYSMID_API_TOKEN`. Best for CI / service accounts:
   ```bash
   PRYSMID_API_TOKEN=ptkn_… npx -y @prysmid/mcp
   ```
2. **Cached device-flow token** — if a previous run completed device flow,
   the access token lives at:
   - Linux/macOS: `$XDG_CONFIG_HOME/prysmid-mcp/token.json` (default `~/.config/prysmid-mcp/token.json`)
   - Windows: `%APPDATA%\prysmid-mcp\token.json`

   It's reused until ~60s before expiry.
3. **Interactive device flow** — first run, no token, attached TTY: the
   server prints a code + verification URL to stderr, you confirm in a
   browser, the token is cached, and the server starts.

To clear the cached token (sign out):

```bash
npx -y @prysmid/mcp logout
```

### Alternative: install directly from GitHub

Useful for testing a branch or a specific commit:

```bash
claude mcp add prysmid -- npx -y github:PrysmID/mcp-server#v0.3.0
claude mcp add prysmid -- npx -y github:PrysmID/mcp-server          # tip of main
```

## Configuration

| Env var | Default | Notes |
|---|---|---|
| `PRYSMID_API_BASE` | `https://api.prysmid.com` | Override for self-hosted Prysmid |
| `PRYSMID_API_TOKEN` | — | Static bearer (skip device flow) |
| `PRYSMID_MCP_LOG_LEVEL` | `info` | `debug` for verbose tool tracing |
| `PRYSMID_FORCE_DEVICE_FLOW` | — | Set to any non-empty value to run device flow even when stderr is not a TTY |

## Status

🚧 Pre-1.0. APIs are stable but the tool surface evolves with the platform. Track the [changelog](CHANGELOG.md).

## License

Apache-2.0
