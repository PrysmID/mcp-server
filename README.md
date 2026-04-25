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
claude mcp add prysmid npx -y @prysmid/mcp
```

(or the equivalent for your agent)

The first call prompts an OAuth device flow against `auth.prysmid.com`. Tokens are cached at:

- Linux/Mac: `~/.config/prysmid-mcp/token.json`
- Windows: `%APPDATA%/prysmid-mcp/token.json`

For CI/automation use a personal access token via env var:

```bash
PRYSMID_API_TOKEN=ptkn_… npx @prysmid/mcp
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
