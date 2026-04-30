Let's set up Prysm:ID in Google Antigravity!

My goal: register the `@prysmid/mcp` MCP server in Antigravity's `mcp_config.json`, make sure it shows up in "Manage MCP servers" with status Connected, authenticate it against my account via device flow, and configure my freshly-created workspace until my end-users can sign in.

## My workspace
Already provisioned (I created it from app.prysmid.com):
- display_name: {display_name}
- slug: {workspace_slug}
- auth_domain: {auth_domain}

I have no token to hand you. The MCP authenticates via **device flow**: when the server starts for the first time it prints a URL and an 8-letter code in `XXXX-XXXX` format that I confirm in the browser. The token is cached on disk by the server after a one-time interactive login (step 5). After that, you never handle it — the server refreshes it on its own.

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

### 5. Pre-cache the auth token via device flow (one-time)

**Why this step exists.** When Antigravity launches the MCP server as a stdio subprocess, **stderr is NOT a TTY** — it's a pipe captured by the parent process. The bundled device flow library detects that condition and refuses to prompt interactively (without `PRYSMID_FORCE_DEVICE_FLOW`). Skipping this step means the first tool call fails with a silent 401 and the session hangs unauthenticated.

The fix: run the binary ONCE with capturable stderr, complete the device flow, and let the token persist on disk. After that, when Antigravity starts the MCP, the cached token is reused and every tool call succeeds without re-auth until the token expires (~12 hours, with a refresh_token that extends it up to the IdP's limit — typically 30 days).

**Decision: do you run it yourself, or delegate to me?**

- **Option A (preferred if you can)** — If you can launch shell processes in the background and read their stderr in streaming mode (IDE terminal exposed as a tool, runtime with run_in_background, etc.):
  1. Launch `npx -y @prysmid/mcp` as a background task with stderr captured.
  2. Poll stderr every ~2s until the `Prysmid MCP — Sign in to your account` banner appears.
  3. Extract the URL (`https://auth.prysmid.com/device`) and the code (format `ABCD-EFGH`).
  4. Show them to me in click-friendly format:
     > Open: https://auth.prysmid.com/device
     > Confirm the code: ABCD-EFGH
  5. Poll `%APPDATA%\prysmid-mcp\token.json` (Windows) or `~/.config/prysmid-mcp/token.json` (Linux/macOS) until it exists with size > 0. Once it appears, kill the MCP process. Done.

- **Option B (fallback)** — If your sandbox doesn't support background shell processes or can't keep processes alive across tool calls: ask me to open a fresh terminal (Git Bash on Windows; bash/zsh on Linux/macOS) and run `npx -y @prysmid/mcp`. When I see the banner, I'll open the URL, confirm the code, wait for `device flow login complete`, and kill with **Ctrl+C**.

Either way, the banner we're looking for in stderr is:

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

I'm already signed in to Prysm:ID with Google from when I created the workspace, so confirming the code in the browser is a single click.

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

**Why you can't skip this.** The `@prysmid/mcp` binary reads `token.json` at process startup. If Antigravity launched the MCP before the token existed (or with an expired token in memory), subsequent tool calls fail with "No Prysmid API token" even though the cache is fresh. The only way to force a re-read is to restart the subprocess, and Reload Window does it.

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

### 9. Configure an external IdP (Google as the example)

**Mental model — OIDC flow with two layers.** Before I paste you the concrete steps, make sure we're aligned on what we're configuring. The auth flow has **two independent layers** and each one has its own client_id/client_secret pair and its own redirect URI:

```
Browser → your-app.com  (admin / portal / whatever)
   ↓ "Sign in"
Browser → {auth_domain}                    ← Prysm:ID layer (step 9)
   ↓ "Continue with Google"
Browser → accounts.google.com              ← Google layer (sub-step 9.1)
   ↓ user authorizes
Browser → {auth_domain}/idps/callback      ← URI #1: Google → Prysm:ID
   ↓ Prysm:ID validates and issues ITS OWN OIDC code
Browser → your-app.com/auth/callback       ← URI #2: Prysm:ID → your app
   ↓ your app validates with its client_secret
Browser → your-app.com/dashboard  (signed in)
```

- **URI #1** (`https://{auth_domain}/idps/callback`) → registered in Google Cloud (this step). ONE only.
- **URI #2** (your app's callback URL) → registered in Prysm:ID via `mcp_prysmid_create_oidc_app` (step 10). Can be several (prod + staging + dev).
- The two layers don't mix: each one has its own isolated client_id/client_secret pair.

#### 9.0 Decision: new Google Cloud project, or reuse an existing one?

Before sending me to create credentials, ask me these two things:

1. Do you have an active Google Cloud project where you could add credentials, or do you want to create a new one dedicated to this workspace?
2. Will this workspace have external users signing in with Google, or is it internal-only (you + collaborators) for now?

**Decision rules**:
- **Internal-only / Day 1 product validation** → reuse existing project. Switching later is trivial (`mcp_prysmid_enable_google_login` with new creds).
- **External users / consent screen branding matters** → dedicated project with app name = product's commercial name. End-users see "{AppName} wants to access your Google account" on the consent screen, so the project name matters.
- **Don't recommend "always create a new project"**: every Google Cloud account has a limited quota of active projects (default 12), and each project requires its own OAuth consent screen setup. Real trade-off.

Same principle applies if you later add other IdPs (GitHub OAuth, Microsoft Entra, Apple, etc.): every provider has quotas and/or consent screen branding — ask before creating a dedicated account/org/app.

#### 9.1 Paste me the creds from Google Cloud

Tell me exactly:
> Go to https://console.cloud.google.com/apis/credentials (in the project we decided above), click **+ Create Credentials → OAuth 2.0 Client ID → Web application**.
> - Name: `prysmid-{workspace_slug}`
> - Authorized redirect URIs (copy this EXACTLY — this is URI #1 from the mental model):
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

#### 11.0 Secrets strategy

Before touching files, ask me: **how do you manage secrets in this repo?** Common options:

- Plain `.env.local` (gitignored) — default; OK for simple apps and prototypes.
- DevVault / Doppler / 1Password / AWS Secrets Manager / GCP Secret Manager / HashiCorp Vault / etc. — `.env.local` ends up with references, or it's generated at boot by reading the store.
- Other project-specific system.

**Adapt the wiring in step 11 to the chosen system**. If the repo has its own secret store, do NOT write `client_secret` to a plain `.env.local` — that breaks the project's convention and creates drift between the secret in the store and the copy in the filesystem. In those cases: store the secret in the appropriate system, and `.env.local` (or the equivalent config) holds only non-secret metadata (`PRYSMID_ISSUER`, `PRYSMID_CLIENT_ID`, redirect URIs).

If I tell you to default to plain `.env.local`, follow below. If I give you a store, the pattern is the same but `PRYSMID_CLIENT_SECRET` is read by the app from the store instead of from the file.

#### 11.1 Generate the auth files

Ask me what framework I use. Officially-supported templates:
- Next.js + Auth.js v5 (recommended for JS/TS)
- FastAPI + Authlib (Python)
- Django + django-allauth (Python)
- Express + openid-client (Node backend)
- Spring Security (Java)
- Other → wire it with the most standard OIDC lib for that stack and tell me what you picked.

Ask me the repo's root path if it isn't obvious from context. Generate the auth files (config + routes/middleware) + the env config (path/format depending on 11.0 strategy):
```
PRYSMID_ISSUER=https://{auth_domain}
PRYSMID_CLIENT_ID=<step 10>
PRYSMID_CLIENT_SECRET=<step 10>
PRYSMID_REDIRECT_URI=<first redirect URI from step 10>
PRYSMID_POST_LOGOUT_URI=<if applicable>
```
If you fall back to plain `.env.local`: verify it's in `.gitignore`. If not, append it with a comment `# Prysm:ID — never commit secrets`.

### 12. Final validation
Call again:
```
mcp_prysmid_prysmid_setup_check(workspace="{workspace_slug}")
```
Expected: `verdict: ready`. If items are still failing, show them with a concrete fix.

Ask me to test a real login:
> Start your app locally. Navigate to the "Sign in with Prysm:ID" button or equivalent. Click → it should redirect to `https://{auth_domain}/oauth/v2/authorize` → show "Continue with Google" → I authorize → it returns to your app signed in with a valid session. If it works, we're done.

## Diagnosing a tool failure

If an MCP tool returns an error, **read the full body before iterating**. Do NOT retry blindly with variants (changing enum values, moving fields, dropping args) — every retry burns a tool call and may leave partial state. Most 4xx errors include a FastAPI `detail` field that tells you exactly what failed.

| Status | Typical meaning | Action |
|---|---|---|
| 422 validation_error | Schema mismatch between what you sent and what the API expects (missing field, wrong type, invalid enum) | Read the `detail` from the body, fix the exact failing field, retry ONCE with the correction. |
| 401 | Token expired or not found | Re-cache (step 5) + reload Antigravity (step 6). |
| 403 | Token valid but no permission on the workspace/resource | Confirm I'm logged in with the right account, and that the `workspace` slug in the call matches one I have a role on. |
| 404 | Resource doesn't exist | Verify the id/slug. List what does exist (`mcp_prysmid_list_apps`, `mcp_prysmid_list_idps`, etc.) before assuming a name. |
| 409 conflict | Duplicate resource | List existing ones, decide whether to reuse or rename. |
| 5xx | Server-side bug | Capture the full body and report to me. |

**Fallback: hit the API directly with curl.** If the MCP output isn't enough to diagnose (truncated, suspected wrapper bug, etc.), call the REST API with the cached token:

```bash
# Linux/macOS
TOKEN=$(jq -r .accessToken "$HOME/.config/prysmid-mcp/token.json")
# Windows (Git Bash)
TOKEN=$(jq -r .accessToken "$APPDATA/prysmid-mcp/token.json")

curl -sS -X <METHOD> "https://api.prysmid.com<PATH>" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '<BODY_JSON>'
```

The body's `detail` is the source of truth. Show it to me in full — don't summarize.

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
