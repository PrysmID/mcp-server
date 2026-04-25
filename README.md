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
claude mcp add prysmid -- npx -y github:PrysmID/mcp-server#v0.1.1
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
