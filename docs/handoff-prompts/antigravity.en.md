Let's set up Prysm:ID in Google Antigravity!

My goal: register the `@prysmid/mcp` MCP server in Antigravity's `mcp_config.json`, make sure it shows up in "Manage MCP servers" with status Connected, authenticate it against my account via device flow, and configure my freshly-created workspace until my end-users can sign in.

## My workspace
Already provisioned (I created it from app.prysmid.com):
- display_name: {display_name}
- slug: {workspace_slug}
- auth_domain: {auth_domain}

I have no token to hand you. The MCP authenticates via **device flow**: when the server starts for the first time it prints a URL and a 6-letter code that I confirm in the browser. The token is cached by the server — you never handle it.

## Procedure (strict, sequential)

### 1. Pre-flight diagnostics
- Detect: OS, shell, Node version (`node --version`, requires ≥20). If Node is missing or too old, stop and tell me — the MCP cannot start.
- Locate Antigravity's `mcp_config.json`. Search order:
  - Windows: `%USERPROFILE%\.gemini\antigravity\mcp_config.json`
  - macOS/Linux: `~/.gemini/antigravity/mcp_config.json`
  - Fallback: `find $HOME -name "mcp_config.json" -path "*antigravity*" 2>/dev/null`

### 2. Backup the config
Before mutating:
```bash
cp "<PATH>" "<PATH>.bak.$(date +%s)"
```
If the file doesn't exist yet, create the parent directories (`mkdir -p`) and start from an empty `{}`. The injector in step 3 handles this on its own, but ensure the parent directory exists first.

### 3. Inject into mcp_config.json
Run this Node.js script. It preserves any existing servers:

```javascript
const fs = require('fs');
const path = require('path');
const os = require('os');

const candidates = [
  path.join(os.homedir(), '.gemini/antigravity/mcp_config.json'),
  path.join(os.homedir(), '.config/gemini/antigravity/mcp_config.json'),
  path.join(os.homedir(), 'AppData/Roaming/gemini/antigravity/mcp_config.json'),
];
const CONFIG_PATH = candidates.find(p => fs.existsSync(p)) || candidates[0];

fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
let config = {};
if (fs.existsSync(CONFIG_PATH)) {
  const raw = fs.readFileSync(CONFIG_PATH, 'utf-8').trim();
  config = raw ? JSON.parse(raw) : {};
  fs.copyFileSync(CONFIG_PATH, `${CONFIG_PATH}.bak.${Date.now()}`);
}
if (!config.mcpServers) config.mcpServers = {};

// IMPORTANT: Prysm:ID is a stdio MCP (local subprocess via npx),
// NOT HTTP. Use `command` + `args`, NOT `serverUrl`.
// If you set `serverUrl` for Prysm:ID you'll see:
//   "Error: connection failed — could not reach https://..."
config.mcpServers.prysmid = {
  command: "npx",
  args: ["-y", "@prysmid/mcp"]
};

fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
console.log(`Injected into ${CONFIG_PATH}`);
console.log(`Active MCPs: ${Object.keys(config.mcpServers).join(', ')}`);
```

**Critical injector rules:**
- Do NOT overwrite other servers (cloudflare, notebooklm, blenau, github-mcp-server, etc.). Only merge `mcpServers.prysmid`.
- Validate the JSON before writing. If it's corrupted, abort and show me the error.
- `command` + `args` (stdio), NOT `serverUrl` — Prysm:ID is NOT an HTTP MCP, it's a local subprocess.
- Do NOT add env vars with hardcoded tokens. The MCP server caches the device flow token automatically at `%APPDATA%\prysmid-mcp\token.json` (Windows) or `~/.config/prysmid-mcp/token.json` (Linux/macOS).

### 4. Verify `npx -y @prysmid/mcp` can start
Before reloading Antigravity, validate the package can download and execute:
```bash
npx -y @prysmid/mcp --version
```
Expected: prints a version like `0.3.0` and exits 0. If it fails:
- Check Node ≥20 (`node --version`).
- Check connectivity to the npm registry: `npm ping`.
- Show me the full error and we stop before reloading Antigravity.

### 5. Pre-cache the auth token via device flow (one-time, in a real terminal)

**Why this step exists.** When Antigravity launches the MCP server as a stdio subprocess, **stderr is NOT a TTY** — it's a pipe captured by the parent process. The bundled device flow library detects that condition and refuses to prompt interactively (without `PRYSMID_FORCE_DEVICE_FLOW`). Skipping this step means the first tool call fails with a silent 401 and the session hangs unauthenticated.

The fix: run the binary ONCE in a real terminal (TTY present), complete the device flow, and let the token persist on disk. After that, when Antigravity starts the MCP, the cached token is reused and every tool call succeeds without re-auth until the token expires (~1 hour).

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

**Fallback** if the terminal isn't interactive (CI, automated script, no local browser): edit `mcp_config.json` to add `env: { "PRYSMID_FORCE_DEVICE_FLOW": "1" }` to the `prysmid` entry. That makes the server emit URL+code to stderr even without a TTY. Antigravity shows MCP stderr in its log panel ("Manage MCP servers" → click the server) — read the code from there. More friction but doesn't require leaving the IDE.

```jsonc
"prysmid": {
  "command": "npx",
  "args": ["-y", "@prysmid/mcp"],
  "env": { "PRYSMID_FORCE_DEVICE_FLOW": "1" }
}
```

### 6. Activate in Antigravity
Ask me to reload the window via `Ctrl + Shift + P` → `Developer: Reload Window`.

### 7. Post-reload verification
After reload:
- Confirm Prysm:ID appears in "Manage MCP servers" with ✓ Connected.
- There must be ≥10 tools with prefix `mcp_prysmid_` (e.g. `mcp_prysmid_setup_prysmid_workspace`, `mcp_prysmid_enable_google_login`, `mcp_prysmid_prysmid_setup_check`, `mcp_prysmid_list_workspaces`, `mcp_prysmid_create_oidc_app`, `mcp_prysmid_add_idp`, `mcp_prysmid_update_branding`, etc.).

Call `mcp_prysmid_list_workspaces({})`. **It should NOT trigger device flow** — the token was cached in step 5 and the MCP reuses it. Expected: an array of workspaces accessible to my account, including `{workspace_slug}`.

If the response is 401 / "authentication required":
- The cache might be corrupted or expired. Go back to step 5 and re-cache.
- Verify the token actually persisted: `cat ~/.config/prysmid-mcp/token.json` (Linux/macOS) — should contain JSON with an `accessToken`.
- If it persists, show me the full error and we stop.

### 8. Validate the current workspace setup
Call:
```
mcp_prysmid_prysmid_setup_check(workspace="{workspace_slug}")
```
Report the `verdict` (`ready` / `incomplete`) and the failing items. Expected at this moment (freshly-created workspace, no OIDC app or IdPs yet):
- ✅ workspace_active
- ❌ has_at_least_one_app
- ✅ users_can_sign_in (Zitadel's default policy allows username+password+register, so even without IdPs, end-users can self-signup)
- ✅ branding_primary_color_set (Prysm:ID default)
- ❌ auth_strength_reasonable (no enforced MFA, no external IdPs)

**Known quirk in `@prysmid/mcp@0.3.0`** (to be fixed in v0.4): even after you create an OIDC app in the workspace, this check may report `has_at_least_one_app: false  details: "undefined apps"`. Not blocking — cross-check with `mcp_prysmid_list_apps(workspace="{workspace_slug}")`.

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
mcp_prysmid_enable_google_login(
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

Call `mcp_prysmid_create_oidc_app(...)` with those values. Show me:
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
mcp_prysmid_prysmid_setup_check(workspace="{workspace_slug}")
```
Expected: `verdict: ready`. If items are still failing, show them with a concrete fix.

Ask me to test a real login:
> Start your app locally. Navigate to the "Sign in with Prysm:ID" button or equivalent. Click → it should redirect to `https://{auth_domain}/oauth/v2/authorize` → show "Continue with Google" → I authorize → it returns to your app signed in with a valid session. If it works, we're done.

## Golden rules
- Show me the exact commands you run and their full output. Don't summarize.
- Never overwrite other entries in `mcpServers` of `mcp_config.json`.
- Do NOT hardcode credentials, secrets, or tokens in repo files. Everything goes to `.env.local` (gitignored) or system env vars.
- If a tool call returns an error, **stop, show me the full error, and ask for confirmation before applying a fix**. Don't assume the cause.
- If a question requires knowledge of my business (app name, prod redirect URI, framework, repo path), ask me with all reasonable options — don't make up values.
- For destructive actions (`delete_workspace`, `delete_oidc_app`, `delete_idp`), ask EXPLICIT confirmation before each call — I'd lose users + apps + IdPs irreversibly.

## When you're done
1. Summarize: how many OIDC apps I created, which IdPs are active, what framework we wired, paths of the `.env.local` files.
2. Remind me of next options:
   - More IdPs (GitHub, Apple, Microsoft) via `mcp_prysmid_add_idp(...)` or curated helpers when we publish them.
   - Custom branding (logo, colors, label policy) via `mcp_prysmid_update_branding(...)`.
   - Custom SMTP override if I want to use my own email infra instead of the managed SMTP.
   - Invite first users with `mcp_prysmid_invite_user(workspace="{workspace_slug}", email=..., role=...)`.
3. Docs:
   - Quickstart: https://docs.prysmid.com/en/agents/quickstart-antigravity/
   - Tools reference: https://docs.prysmid.com/en/agents/tools/
   - Troubleshooting: https://docs.prysmid.com/en/agents/troubleshooting/
