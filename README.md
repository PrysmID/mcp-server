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

For now, auth is bearer-token-only via env var:

```bash
PRYSMID_API_TOKEN=ptkn_… npx -y @prysmid/mcp
```

OAuth device flow with token caching at `~/.config/prysmid-mcp/token.json` (Unix) or `%APPDATA%/prysmid-mcp/token.json` (Windows) is queued for a follow-up release.

### Alternative: install directly from GitHub

Useful for testing a branch or a specific commit:

```bash
claude mcp add prysmid -- npx -y github:PrysmID/mcp-server#v0.2.0
claude mcp add prysmid -- npx -y github:PrysmID/mcp-server          # tip of main
```

## Configuration

| Env var | Default | Notes |
|---|---|---|
| `PRYSMID_API_BASE` | `https://api.prysmid.com` | Override for self-hosted Prysmid |
| `PRYSMID_API_TOKEN` | — | Static bearer (skip device flow) |
| `PRYSMID_MCP_LOG_LEVEL` | `info` | `debug` for verbose tool tracing |

## Status

🚧 Pre-1.0. APIs are stable but the tool surface evolves with the platform. Track the [changelog](CHANGELOG.md).

## License

Apache-2.0
