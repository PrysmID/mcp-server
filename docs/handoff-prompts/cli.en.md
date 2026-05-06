Let's set up Prysm:ID end-to-end using the CLI!

My goal: get my freshly-created workspace fully operational (external IdP, OIDC app, wiring inside my repo) using the `@prysmid/cli` command-line tool. We won't touch MCP config, your editor's files, or any host-specific JSON — just terminal and code.

## My workspace
Already provisioned (I created it from app.prysmid.com):
- display_name: {display_name}
- slug: {workspace_slug}
- auth_domain: {auth_domain}

I have no token to hand you. The CLI authenticates via **device flow**: when you run `prysmid login` for the first time it prints a URL and an 8-letter code in `XXXX-XXXX` format that I confirm in the browser. The token is cached on disk after login and the CLI reuses it on every command until it expires.

## Why CLI instead of MCP

The CLI works in any editor or agent that can run shell commands. No per-host configuration (no `mcp_config.json`, no `~/.claude.json`, no "Add MCP server" UI). If you later want native MCP integration, that's a separate setup — but everything we do here is fully covered by the CLI.

You (the agent) call `prysmid` like any other shell command. Output is JSON when piped (`prysmid <cmd> --json` or `-o json`), perfect for you to parse and decide on. Errors include `hint:` lines with concrete remediation.

## Rule #0 — you run the commands, I don't open terminals

**You are the one who runs the commands.** You have a shell tool (Bash, PowerShell, exposed terminal, whatever) — use it. **Do NOT** ask me "run `prysmid login` in your terminal and paste me the output". That defeats the purpose of having an agent with shell access.

The only things I do manually:
1. Confirm the device-flow code in the browser (one click — I'm already signed into Google).
2. Paste credentials that come from external UIs (Google Cloud Console, etc.) you can't see.
3. Product decisions that need my input (app name, redirect URIs, framework).

Everything else — `prysmid login` included — you run yourself.

## Procedure (strict, sequential)

### 1. Pre-flight diagnostics
- Detect: OS, shell, Node version (`node --version`, requires ≥20). If Node is missing or too old, stop and tell me — the CLI cannot start.
- Verify `npx` is available: `npx --version`.
- Decide how to invoke the CLI:
  - **Persistent mode**: `npm install -g @prysmid/cli` then `prysmid <cmd>`.
  - **Ad-hoc mode**: `npx -y @prysmid/cli@latest <cmd>` on every call.

  If I (the user) have no preference, install globally. If the environment is CI / ephemeral, use `npx`.

### 2. Auto-discovery
Before anything else, ask the CLI to describe itself:
```bash
prysmid --version
prysmid describe-tools --json
```
`describe-tools` returns a JSON manifest of every command with its summary, full help, and flags. **Cache that manifest** and consult it whenever you're unsure about a flag — do not invent flags.

Quick human-friendly listing: `prysmid --help`.

### 3. Login (one-time device flow)
```bash
prysmid login
```
The CLI prints a banner to stderr like:

```
─────────────────────────────────────────────────────────
 Prysmid CLI — Sign in to your account
─────────────────────────────────────────────────────────

  1. Open this URL in your browser:
       https://auth.prysmid.com/device

  2. Confirm the code:
       ABCD-EFGH

  Waiting for confirmation (expires in 600s)…
```

**How to handle it (default — this is what you do):**

1. Launch `prysmid login` **in background** from your shell tool (Bash with `run_in_background: true`, or equivalent). Do NOT run it in foreground — it blocks for up to 600s.
2. Poll the output (stdout/stderr) until the banner with the `XXXX-XXXX` code appears. Usually 1–3s.
3. Show me click-friendly (once):
   > Open: https://auth.prysmid.com/device
   > Confirm code: **ABCD-EFGH**
4. Keep polling the process. When it exits 0, login is done — move on to step 4 without waiting for me to confirm anything (exit 0 already means I confirmed).

**If your sandbox does NOT support background processes** (very rare — Claude Code, Codex, and Antigravity all do): say so explicitly with that phrase ("my sandbox doesn't support background processes"), and only then ask me to run `prysmid login` myself in a terminal. This is a last resort, not the default.

I'm already signed into Prysm:ID with Google from when I created the workspace, so the code confirmation in the browser is one click.

### 4. Auth + connectivity sanity
```bash
prysmid doctor --json
```
Expected: `ok: true` with all checks green. If a check fails, the JSON has a `detail` with the exact cause. Common errors:
- `credentials.present: false` → step 3 didn't cache the token. Check it exited cleanly.
- `api.reachable: false` → network blocked. Ask me to verify connectivity.
- `api.authorized: false` → token rejected. Re-run login.

```bash
prysmid whoami --json
```
Confirms identity and active profile. Expected: my email shows up in the `user` field.

### 5. Current workspace state
```bash
prysmid setup-check --workspace {workspace_slug} --json
```
Report me the `verdict` and any failing items. Expected at this point (workspace just created, no app or IdPs yet):
- ✅ workspace_active
- ❌ has_at_least_one_app
- ✅ users_can_sign_in (Zitadel's default policy allows username+password+register)
- ✅ branding_primary_color_set (Prysm:ID default)
- ❌ auth_strength_reasonable (no forced MFA, no external IdPs yet)

We'll close those two `❌` in the next steps.

### 6. Configure an external IdP (Google as the example)

**Mental model — two-layer OIDC.** The auth flow has two independent layers and each has its own client_id/client_secret pair and its own redirect URI:

```
Browser → your-app.com  (admin / portal / whatever)
   ↓ "Sign in"
Browser → {auth_domain}                    ← Prysm:ID layer (step 6)
   ↓ "Continue with Google"
Browser → accounts.google.com              ← Google layer (sub-step 6.1)
   ↓ user authorizes
Browser → {auth_domain}/idps/callback      ← URI #1: Google → Prysm:ID
   ↓ Prysm:ID validates and issues ITS OWN OIDC code
Browser → your-app.com/auth/callback       ← URI #2: Prysm:ID → your app
   ↓ your app validates with its client_secret
Browser → your-app.com/dashboard  (signed in)
```

- **URI #1** (`https://{auth_domain}/idps/callback`) → registered in Google Cloud (this step). ONE only.
- **URI #2** (your app's callback) → registered in Prysm:ID via `prysmid app create` (step 7). Can be many (prod + staging + dev).
- The two layers don't mix: each has its own isolated client_id/client_secret pair.

#### 6.0 Decision: new Google Cloud project or reuse an existing one?

Before sending me to create credentials, ask me:

1. Do you have an active Google Cloud project where you could add credentials, or do you want a new one dedicated to this workspace?
2. Will this workspace have external users doing Google Sign-In, or is it for internal use (you + collaborators) for now?

**Decision rules**:
- **Internal only / day-1 product validation** → reuse an existing project. Switching later is trivial.
- **External users / consent-screen branding matters** → dedicated project with app name = product's commercial name. End users see "{AppName} wants to access your Google Account" on the consent screen.
- **Don't recommend "always create a new project"**: each Google Cloud account has a project quota (default 12 active) and each project needs its own OAuth consent screen setup.

#### 6.1 Paste the creds from Google Cloud

Tell me exactly:
> Go to https://console.cloud.google.com/apis/credentials (in the project we just decided on), click **+ Create Credentials → OAuth 2.0 Client ID → Web application**.
> - Name: `prysmid-{workspace_slug}`
> - Authorized redirect URIs (copy this EXACTLY — this is URI #1 from the mental model):
>   ```
>   https://{auth_domain}/idps/callback
>   ```
> Click Create. Paste me Client ID + Client Secret from the success screen.

When I paste the creds, run:
```bash
prysmid idp enable-google \
  --workspace {workspace_slug} \
  --client-id "<paste>" \
  --client-secret "<paste>" \
  --json
```
This adds Google as an IdP **and** flips `allow_external_idp=true` in the login policy. Show me the response. Expected: an object with `ok: true` and the freshly-created `idp.id`.

### 7. Before creating the app — secrets strategy

**Critical — order matters.** The `client_secret` is shown ONCE in the `app create` response. If you create the app before knowing where the secret goes, you'll end up echoing it to chat to "show it to me" and it'll live in the transcript as a compromised secret. Decide the destination FIRST; create the app SECOND, and write the secret straight into the chosen store without routing it through chat.

Ask me: **how do you manage secrets in this repo?** Common options:

- Plain `.env.local` (gitignored) — sane default for simple apps and prototypes.
- DevVault / Doppler / 1Password / AWS Secrets Manager / GCP Secret Manager / HashiCorp Vault — `.env.local` holds references or is generated at boot from the store.
- Project-specific custom system.

**Adapt the wiring to the chosen system.** If the repo has its own secret store, do NOT write `client_secret` to a plain `.env.local` — that breaks the project's convention and creates drift between the store and the on-disk copy.

Heuristics to skip the question: if you see `devvault.yml` at the root → DevVault. `.doppler.yaml` → Doppler. `op.config.yaml` or `op://...` references → 1Password. In those cases confirm with one line ("I detected DevVault — using that, OK?") instead of listing the full menu.

### 8. Create the OIDC app for my product

Ask me one by one (skip what you can already infer from context):
- **App name** (e.g. "Acme Web", "Acme Mobile"). Internal label; not shown to end users.
- **Redirect URI(s)** — exact callback URL(s) of my app. Examples:
  - prod: `https://app.acme.com/auth/callback`
  - dev local: `http://localhost:3000/auth/callback/prysmid`
- **App type**: `web` (server-rendered, confidential) by default; `native` or `user-agent` if I ask for it.
- **Auth method**: `basic` (default) unless I say otherwise.

Run (in v0.1 the CLI accepts multiple redirect URIs comma-separated):
```bash
prysmid app create \
  --workspace {workspace_slug} \
  --name "<name>" \
  --redirect-uri "<uri1>,<uri2>" \
  --app-type web \
  --auth-method basic \
  --json
```

**Handling the response — do NOT echo the secret to chat.** Parse the JSON internally. Write `client_secret` directly into the store you chose in step 7 (file write with `chmod 600` for `.env.local`; `doppler secrets set`, `op item create`, etc. for stores). In your message to chat, show ONLY:

- `client_id` (not a secret — it travels in the auth URL anyway)
- `issuer`: `https://{auth_domain}`
- `discovery_url`: `https://{auth_domain}/.well-known/openid-configuration`
- `client_secret`: **`<written to {path or store reference}>`** — without the value. If you want to show evidence, the last 4 chars: `…wXyZ`.
- A note: "the secret has been persisted; I will not print it again. To rotate: `prysmid app rotate-secret …`".

If the user explicitly asks to see the full secret (e.g. to paste it into another UI by hand), only then print it, with a warning: "this lands in the chat transcript — consider rotating after if the chat persists".

### 9. Wire it into my repo

Ask me what framework I use. Officially supported templates:
- Next.js + Auth.js v5 (recommended for JS/TS)
- FastAPI + Authlib (Python)
- Django + django-allauth (Python)
- Express + openid-client (Node backend)
- Spring Security (Java)
- Other → wire it with the most idiomatic OIDC library for that stack and tell me which one you picked.

Generate the auth files (config + routes/middleware) plus the env config. The `client_id` comes from step 8 (public); the `client_secret` is already in the store from step 8 — reference it from there, don't put it back in plain text if the repo uses a secret store:

```
PRYSMID_ISSUER=https://{auth_domain}
PRYSMID_CLIENT_ID=<step 8>
PRYSMID_CLIENT_SECRET=<read from the step-7 store — reference or env var, per convention>
PRYSMID_REDIRECT_URI=<first redirect URI from step 8>
PRYSMID_POST_LOGOUT_URI=<if applicable>
```
If you're falling back to plain `.env.local`: verify it's in `.gitignore`. If not, append it with a `# Prysm:ID — never commit secrets` comment.

### 10. Final verification
```bash
prysmid setup-check --workspace {workspace_slug} --json
```
Expected: `verdict: ready`. If items still fail, show them to me with a concrete fix.

Ask me to test a real login:
> Start your local app. Click the "Sign in with Prysm:ID" button or equivalent. It should redirect to `https://{auth_domain}/oauth/v2/authorize` → show "Continue with Google" → I authorize → bounce back to your app signed in with a valid session. If that works, we're done.

## Diagnostics when a command fails

Any CLI command can fail with an HTTP API error. Format:

```
prysmid: API error <STATUS> — <METHOD> <PATH> → <STATUS>
{"error":"...","message":"...","details":...}
hint: <remediation>
```

**Status → action**:
- `401` → token expired or invalid. Re-run `prysmid login`.
- `403` → no permission on that resource. Do NOT loop; ask me for context.
- `404` → wrong slug/id. List first (`prysmid workspace list --json`) and retry.
- `409` → resource already exists or is in a conflicting state. Show me the detail.
- `422` → validation error. The JSON body has the bad fields.
- `5xx` → transient API error. Retry once. If it persists, run `prysmid doctor --json`.

If the error isn't from the API (parsing, missing flag, network), the message is direct and usually says exactly what's missing.

## Hard rules
- **Don't invent flags.** If unsure, consult `prysmid <cmd> --help` or the `describe-tools` manifest.
- **Don't hardcode `PRYSMID_API_TOKEN` in repo files.** The cached login token is filesystem-protected; use the env var only for CI with a real secret store.
- **Don't run `prysmid workspace delete` without my explicit confirmation.** The command already requires `--yes` but ask me first.
- **Don't mix languages in the same flow.** If I write in English, respond in English; keep command names in English (they're literals).
- **Always show me the command you're about to run before executing it for state-mutating ops** (`create`, `update`, `delete`, `enable-google`, `setup`). Reads (`list`, `get`, `describe-tools`, `doctor`, `whoami`, `setup-check`) you can run directly.

## When something breaks
- Run `prysmid doctor --json` and show me the literal output.
- Show me the exact failing command and its full output.
- Don't assume; ask me before manually rolling back steps.

OK. Start with step 1.
