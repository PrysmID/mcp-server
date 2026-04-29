Let's set up Prysm:ID in Claude Code!

My goal: register the `@prysmid/mcp` MCP server at user scope in Claude Code, authenticate it against my account via device flow, and configure my freshly-created workspace until my end-users can sign in.

## My workspace
Already provisioned (I created it from app.prysmid.com):
- display_name: {display_name}
- slug: {workspace_slug}
- auth_domain: {auth_domain}

I have no token to hand you. The MCP authenticates via **device flow**: when the server starts for the first time it prints a URL and an 8-letter code in `XXXX-XXXX` format that I confirm in the browser. The token is cached on disk by the server after a one-time interactive login (step 5). After that, you never handle it — the server refreshes it on its own.

## Procedure (strict, sequential)

### 1. Pre-flight diagnostics
- Detect: OS, shell, Node version (`node --version`, requires ≥20). If Node is missing or too old, stop and tell me — the MCP cannot start.
- Verify the `claude` CLI is available: `claude --version`
- Claude Code's config lives at:
  - Linux/macOS: `~/.claude.json`
  - Windows: `C:\Users\<user>\.claude.json`
- List current MCPs: `claude mcp list` (so we can compare afterward).

### 2. Backup the config
```bash
cp ~/.claude.json ~/.claude.json.bak.$(date +%s)
# Windows (Git Bash):
cp "$HOME/.claude.json" "$HOME/.claude.json.bak.$(date +%s)"
```
If `~/.claude.json` doesn't exist yet, that's fine — `claude mcp add` will create it in the next step.

### 3. Register the MCP at user scope
Run EXACTLY:
```bash
claude mcp add --scope user prysmid -- npx -y @prysmid/mcp
```

**Critical rules:**
- Use `--scope user` (NOT `project` — on Windows the project path can fail to resolve, and the cached token must live at the user level, not per-project).
- Stdio transport is implicit (this is NOT HTTP — the MCP runs as a local subprocess). Do NOT add `--transport http` or `serverUrl`.
- `npx -y` so the package downloads without an interactive confirmation prompt.
- Do NOT add env vars with hardcoded tokens. The server caches the device flow token automatically at `%APPDATA%\prysmid-mcp\token.json` (Windows) or `~/.config/prysmid-mcp/token.json` (Linux/macOS).

### 4. Verify registration
```bash
claude mcp list | grep -i prysmid
```
Expected: a line `prysmid: npx -y @prysmid/mcp - ✓` (the ✓ may take a few seconds the first time while `npx` downloads the package).

If it shows `✗ Failed`:
- Check Node ≥20 is on PATH.
- Check `npx` can reach the npm registry: `npm ping`.
- If the issue persists, show me the exact error from `claude mcp list` and we stop.

### 5. Pre-cache the auth token via device flow (one-time, in a real terminal)

**Why this step exists.** When Claude Code launches the MCP server as a stdio subprocess, **stderr is NOT a TTY** — it's a pipe captured by the parent process. The bundled device flow library detects that condition and refuses to prompt interactively (without `PRYSMID_FORCE_DEVICE_FLOW`). Skipping this step means the first tool call fails with a silent 401 and the session hangs unauthenticated.

The fix: run the binary ONCE in a real terminal (TTY present), complete the device flow, and let the token persist on disk. After that, when Claude Code starts the MCP, the cached token is reused and every tool call succeeds without re-auth until the token expires (~12 hours, with a refresh_token that extends it up to the IdP's limit — typically 30 days).

Ask me to open a fresh terminal (Git Bash on Windows; bash/zsh on Linux/macOS) and run:

```bash
npx -y @prysmid/mcp
```

Expected on stderr (visible in the terminal):

```
─────────────────────────────────────────────────────────
 Prysmid MCP — Sign in to your account
─────────────────────────────────────────────────────────

  1. Open this URL in your browser:
       https://auth.prysmid.com/device

  2. Confirm the code:
       ABCD-EFGH

  Waiting for confirmation (expires in 600s)…
```

Ask me to open the URL in the browser, confirm the code (already signed in to Prysm:ID with Google from when I created the workspace), and wait for the terminal to report `device flow login complete`. Then have me kill the process with **Ctrl+C** — the token is now cached.

Verify the token persisted:

```bash
# Linux/macOS
ls -la ~/.config/prysmid-mcp/token.json
# Windows (Git Bash)
ls -la "$APPDATA/prysmid-mcp/token.json"
```

If the file exists and has content, pre-cache OK.

**Fallback** if the terminal isn't interactive (CI, automated script, no local browser): edit Claude Code's config and add `PRYSMID_FORCE_DEVICE_FLOW=1` as an env var on the MCP entry. That makes the server emit URL+code to stderr even without a TTY. Claude Code shows MCP stderr in its log panel — read the code from there. More friction (you have to find the panel), but doesn't require leaving the IDE.

```jsonc
// ~/.claude.json -> mcpServers.prysmid
{
  "command": "npx",
  "args": ["-y", "@prysmid/mcp"],
  "env": { "PRYSMID_FORCE_DEVICE_FLOW": "1" }
}
```

### 6. Restart Claude Code
Ask me to **fully close Claude Code** (not `/clear`, not Ctrl+C inside the app — full app/CLI close) and reopen it. MCPs load at startup.

### 7. Post-restart validation
After restart, use ToolSearch (or your Claude Code version's equivalent) with query "prysmid" to confirm ≥10 tools appear (e.g. `setup_prysmid_workspace`, `enable_google_login`, `prysmid_setup_check`, `list_workspaces`, `create_oidc_app`, `add_idp`, `update_branding`, etc.).

Call `list_workspaces({})`. **It should NOT trigger device flow** — the token was cached in step 5 and the MCP reuses it. Expected: an array of workspaces accessible to my account, including `{workspace_slug}`.

If the response is 401 / "authentication required":
- The cache might be corrupted or expired. Go back to step 5 and re-cache.
- Verify the token actually persisted: `cat ~/.config/prysmid-mcp/token.json` (Linux/macOS) — should contain JSON with an `accessToken`.
- If it persists, show me the full error and we stop.

### 8. Validate the current workspace setup
Call:
```
prysmid_setup_check(workspace="{workspace_slug}")
```
Report the `verdict` (`ready` / `incomplete`) and the failing items. Expected at this moment (freshly-created workspace, no OIDC app or IdPs yet):
- ✅ workspace_active
- ❌ has_at_least_one_app
- ✅ users_can_sign_in (Zitadel's default policy allows username+password+register, so even without IdPs, end-users can self-signup)
- ✅ branding_primary_color_set (Prysm:ID default)
- ❌ auth_strength_reasonable (no enforced MFA, no external IdPs)

### 9. Configure Google login
Tell me exactly:
> Go to https://console.cloud.google.com/apis/credentials, click **+ Create Credentials → OAuth 2.0 Client ID → Web application**.
> - Name: `prysmid-{workspace_slug}`
> - Authorized redirect URIs (copy this EXACTLY):
>   ```
>   https://{auth_domain}/idps/callback
>   ```
> Click Create. Paste me the Client ID + Client Secret from the success screen.

When I paste the creds, call:
```
enable_google_login(
  workspace="{workspace_slug}",
  google_client_id="<what I pasted>",
  google_client_secret="<what I pasted>"
)
```
Show me the response. Expected: `idp.id` + `login_policy="allow_external_idp=true"`.

### 10. Create the OIDC app for my product
Ask me one at a time:
- **App name** (e.g. "Acme Web", "Acme Mobile"). Internal label; not exposed to end-users.
- **Redirect URI(s)** — exact URL(s) of my app's OIDC callback. Examples:
  - prod: `https://app.acme.com/auth/callback`
  - local dev: `http://localhost:3000/auth/callback/prysmid`
  - If I pass `http://localhost`, add `dev_mode=true` to the call.
- **Post-logout redirect URI** (optional, default: app home).
- **App type**: `web` (server-rendered, confidential) by default; `spa` or `native` if I say so (then it uses PKCE instead of client_secret).

Call `create_oidc_app(...)` with those values. Show me:
- `client_id`
- `client_secret` with UPPERCASE WARNING: **⚠ THIS SECRET IS SHOWN ONCE — save it NOW**
- `issuer URL`: https://{auth_domain}
- `discovery URL`: https://{auth_domain}/.well-known/openid-configuration

### 11. Wire the app in my repo
Ask me what framework I use. Officially-supported templates:
- Next.js + Auth.js v5 (recommended for JS/TS)
- FastAPI + Authlib (Python)
- Django + django-allauth (Python)
- Express + openid-client (Node backend)
- Spring Security (Java)
- Other → wire it with the most standard OIDC lib for that stack and tell me what you picked.

Ask me the repo's root path if it isn't obvious from context. Generate the auth files (config + routes/middleware) + a `.env.local` with:
```
PRYSMID_ISSUER=https://{auth_domain}
PRYSMID_CLIENT_ID=<step 10>
PRYSMID_CLIENT_SECRET=<step 10>
PRYSMID_REDIRECT_URI=<first redirect URI from step 10>
PRYSMID_POST_LOGOUT_URI=<if applicable>
```
Verify `.env.local` is in `.gitignore`. If not, append it with a comment `# Prysm:ID — never commit secrets`.

### 12. Final validation
Call again:
```
prysmid_setup_check(workspace="{workspace_slug}")
```
Expected: `verdict: ready`. If items are still failing, show them with a concrete fix.

Ask me to test a real login:
> Start your app locally. Navigate to the "Sign in with Prysm:ID" button or equivalent. Click → it should redirect to `https://{auth_domain}/oauth/v2/authorize` → show "Continue with Google" → I authorize → it returns to your app signed in with a valid session. If it works, we're done.

## Golden rules
- Show me the exact commands you run and their full output. Don't summarize.
- Do NOT hardcode credentials, secrets, or tokens in repo files. Everything goes to `.env.local` (gitignored) or system env vars.
- If a tool call returns an error, **stop, show me the full error, and ask for confirmation before applying a fix**. Don't assume the cause.
- If a question requires knowledge of my business (app name, prod redirect URI, framework, repo path), ask me with all reasonable options — don't make up values.
- For destructive actions (`delete_workspace`, `delete_oidc_app`, `delete_idp`), ask EXPLICIT confirmation before each call — I'd lose users + apps + IdPs irreversibly.

## When you're done
1. Summarize: how many OIDC apps I created, which IdPs are active, what framework we wired, paths of the `.env.local` files.
2. Remind me of next options:
   - More IdPs (GitHub, Apple, Microsoft) via `add_idp(...)` or curated helpers when we publish them.
   - Custom branding (logo, colors, label policy) via `update_branding(...)`.
   - Custom SMTP override if I want to use my own email infra instead of the managed SMTP.
   - Invite first users with `invite_user(workspace="{workspace_slug}", email=..., role=...)`.
3. Docs:
   - Quickstart: https://docs.prysmid.com/en/agents/quickstart-claude/
   - Tools reference: https://docs.prysmid.com/en/agents/tools/
   - Troubleshooting: https://docs.prysmid.com/en/agents/troubleshooting/
