¡Vamos a configurar Prysm:ID en Claude Code!

Mi objetivo: dejar el MCP server `@prysmid/mcp` registrado a nivel user en Claude Code, autenticarlo contra mi cuenta vía device flow, y configurar mi workspace recién creado hasta que mis usuarios finales puedan loguear.

## Mi workspace
Ya está provisioned (lo creé desde app.prysmid.com):
- display_name: {display_name}
- slug: {workspace_slug}
- auth_domain: {auth_domain}

No tengo ningún token para pasarte. La autenticación del MCP es por **device flow**: cuando el server arranque por primera vez te va a imprimir un URL y un código de 8 letras en formato XXXX-XXXX que yo confirmo en el browser. El token queda cacheado en disco por el server después de un login interactivo de una sola vez (paso 5). Después de eso vos no lo manejás más — el server lo refresca solo.

## Procedimiento (estricto y secuencial)

### 1. Diagnóstico previo
- Detectá: SO, shell, versión de Node (`node --version`, requiere ≥20). Si Node falta o es viejo, pará y decime — el MCP no va a poder arrancar.
- Verificá que el CLI `claude` está disponible: `claude --version`
- El config de Claude Code vive en:
  - Linux/macOS: `~/.claude.json`
  - Windows: `C:\Users\<user>\.claude.json`
- Listá los MCPs actuales: `claude mcp list` (para comparar después).

### 2. Backup del config
```bash
cp ~/.claude.json ~/.claude.json.bak.$(date +%s)
# Windows (Git Bash):
cp "$HOME/.claude.json" "$HOME/.claude.json.bak.$(date +%s)"
```
Si `~/.claude.json` no existe todavía, está bien — lo va a crear `claude mcp add` en el siguiente paso.

### 3. Registro del MCP en scope user
Ejecutá EXACTAMENTE:
```bash
claude mcp add --scope user prysmid -- npx -y @prysmid/mcp
```

**Reglas críticas:**
- Usar `--scope user` (NO `project` — en Windows el path del proyecto puede no resolverse bien y el token cacheado debe vivir a nivel usuario, no por proyecto).
- Transport stdio implícito (no es HTTP — el MCP corre como subprocess local). NO agregues `--transport http` ni `serverUrl`.
- `npx -y` para que descargue `@prysmid/mcp` sin prompt interactivo.
- NO agregues env vars con tokens hardcoded. El server cachea el token de device flow automáticamente en `%APPDATA%\prysmid-mcp\token.json` (Windows) o `~/.config/prysmid-mcp/token.json` (Linux/macOS).

### 4. Verificación de registro
```bash
claude mcp list | grep -i prysmid
```
Esperado: una línea con `prysmid: npx -y @prysmid/mcp - ✓` (el ✓ puede tardar unos segundos la primera vez mientras `npx` descarga el package).

Si aparece `✗ Failed`:
- Verificá que Node ≥20 está en PATH.
- Verificá que `npx` puede alcanzar el registry de npm: `npm ping`.
- Si el problema persiste, mostrame el error exacto de `claude mcp list` y paramos.

### 5. Pre-cache del token vía device flow (one-time, en terminal)

**¿Por qué este paso existe?** Cuando Claude Code arranca el MCP server como subprocess stdio, **stderr no es un TTY** — es un pipe que captura el padre. La librería de device flow del MCP detecta esa condición y se rehúsa a prompt interactivamente (con `PRYSMID_FORCE_DEVICE_FLOW` desactivado). Resultado si saltamos este paso: la primera tool call falla con 401 silencioso y la sesión queda colgada sin auth.

La solución es ejecutar el binario UNA VEZ en una terminal real (TTY presente), completar device flow, y dejar el token cacheado en disco. Después Claude Code arranca, el MCP encuentra el token cacheado y todas las tool calls funcionan sin re-auth hasta que expire (~12 horas, con refresh_token que extiende hasta el límite del IdP — típicamente 30 días).

Pedime que abra una terminal nueva (Git Bash en Windows; bash/zsh en Linux/macOS) y ejecute:

```bash
npx -y @prysmid/mcp
```

Esperado en stderr (visible en la terminal):

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

Pedime que abra la URL en el browser, confirme el code (ya estoy logueado en Prysm:ID con Google de cuando creé el workspace), y espere a que la terminal reporte `device flow login complete`. Después que mate el proceso con **Ctrl+C** — el token ya está cacheado.

Verificá que el token quedó persistido:

```bash
# Linux/macOS
ls -la ~/.config/prysmid-mcp/token.json
# Windows (Git Bash)
ls -la "$APPDATA/prysmid-mcp/token.json"
```

Si el archivo existe y tiene contenido, pre-cache OK.

**Fallback** si la terminal no es interactiva (CI, script automatizado, ambiente sin browser local): editá el config de Claude Code agregando `PRYSMID_FORCE_DEVICE_FLOW=1` como env var del MCP. Eso hace que el server imprima URL+code a stderr aunque no haya TTY. Claude Code muestra el stderr del MCP en su panel de logs — leés el code desde ahí. Es más fricción (hay que encontrar el panel), pero no requiere salir del IDE.

```jsonc
// ~/.claude.json -> mcpServers.prysmid
{
  "command": "npx",
  "args": ["-y", "@prysmid/mcp"],
  "env": { "PRYSMID_FORCE_DEVICE_FLOW": "1" }
}
```

### 6. Reinicio de Claude Code
Pedime que **cierre completamente Claude Code** (no `/clear`, no Ctrl+C dentro de la app — close completo de la app/CLI) y lo abra de nuevo. Los MCPs se cargan al iniciar.

### 7. Validación post-reinicio
Cuando reinicie, usá ToolSearch (o el equivalente en tu versión de Claude Code) con query "prysmid" para confirmar que aparezcan ≥10 tools (ej. `setup_prysmid_workspace`, `enable_google_login`, `prysmid_setup_check`, `list_workspaces`, `create_oidc_app`, `add_idp`, `update_branding`, etc.).

Llamá `list_workspaces({})`. **NO debería disparar device flow** — el token quedó cacheado en el paso 5 y el MCP lo reusa. Esperado: array de workspaces accesibles a mi cuenta, incluyendo `{workspace_slug}`.

Si la respuesta es 401 / "authentication required":
- El cache puede estar corrupto o expirado. Volvé al paso 5 y re-cacheá.
- Verificá que el token efectivamente quedó: `cat ~/.config/prysmid-mcp/token.json` (Linux/macOS) — debería tener un JSON con `accessToken`.
- Si persiste, mostrame el error completo y paramos.

### 8. Validá el setup actual del workspace
Llamá:
```
prysmid_setup_check(workspace="{workspace_slug}")
```
Reportame el `verdict` (`ready` / `incomplete`) y los items que fallan. Esperado en este momento (workspace recién creado, sin app OIDC ni IdPs aún):
- ✅ workspace_active
- ❌ has_at_least_one_app
- ✅ users_can_sign_in (la policy default de Zitadel permite username+password+register, así que aunque no haya IdPs los end-users pueden self-signup)
- ✅ branding_primary_color_set (default Prysm:ID)
- ❌ auth_strength_reasonable (no hay MFA forzado ni IdPs externos)

### 9. Configurá Google login
Decime exactamente:
> Andá a https://console.cloud.google.com/apis/credentials, click **+ Create Credentials → OAuth 2.0 Client ID → Web application**.
> - Name: `prysmid-{workspace_slug}`
> - Authorized redirect URIs (copiá esto EXACTO):
>   ```
>   https://{auth_domain}/idps/callback
>   ```
> Click Create. Pegame Client ID + Client Secret de la pantalla de éxito.

Cuando te pegue las creds, llamá:
```
enable_google_login(
  workspace="{workspace_slug}",
  google_client_id="<lo que pegué>",
  google_client_secret="<lo que pegué>"
)
```
Mostrame la respuesta. Esperado: `idp.id` + `login_policy="allow_external_idp=true"`.

### 10. Creá la OIDC app de mi producto
Preguntame uno por uno:
- **Nombre de la app** (ej. "Acme Web", "Acme Mobile"). Es etiqueta interna; no se expone a end-users.
- **Redirect URI(s)** — URL(s) exacta(s) del callback OIDC de mi app. Ejemplos:
  - prod: `https://app.acme.com/auth/callback`
  - dev local: `http://localhost:3000/auth/callback/prysmid`
  - Si paso `http://localhost`, agregá `dev_mode=true` al call.
- **Post-logout redirect URI** (opcional, default: home de la app).
- **App type**: `web` (server-rendered, confidential) por default; `spa` o `native` si yo lo digo (entonces usa PKCE en lugar de client_secret).

Llamá `create_oidc_app(...)` con esos valores. Mostrame:
- `client_id`
- `client_secret` con WARNING en mayúsculas: **⚠ ESTE SECRET SE VE UNA SOLA VEZ — guardalo YA**
- `issuer URL`: https://{auth_domain}
- `discovery URL`: https://{auth_domain}/.well-known/openid-configuration

### 11. Generá el wiring en mi repo
Preguntame qué framework uso. Plantillas oficiales soportadas:
- Next.js + Auth.js v5 (recomendado para JS/TS)
- FastAPI + Authlib (Python)
- Django + django-allauth (Python)
- Express + openid-client (Node backend)
- Spring Security (Java)
- Otro → wireá con la lib OIDC más estándar de ese stack y avisame qué elegiste.

Preguntame el path raíz de mi repo si no es obvio del contexto. Generá los archivos de auth (config + routes/middleware) + un `.env.local` con:
```
PRYSMID_ISSUER=https://{auth_domain}
PRYSMID_CLIENT_ID=<step 10>
PRYSMID_CLIENT_SECRET=<step 10>
PRYSMID_REDIRECT_URI=<primer redirect URI de step 10>
PRYSMID_POST_LOGOUT_URI=<si aplica>
```
Verificá que `.env.local` esté en `.gitignore`. Si no, agregálo al final con un comment `# Prysm:ID — never commit secrets`.

### 12. Verificación final
Llamá de nuevo:
```
prysmid_setup_check(workspace="{workspace_slug}")
```
Esperado: `verdict: ready`. Si quedan items en fail, mostrámelos con un fix concreto.

Pedime que pruebe login real:
> Levantá tu app local. Navegá al botón "Sign in with Prysm:ID" o equivalente. Click → debería redirigir a `https://{auth_domain}/oauth/v2/authorize` → mostrar "Continue with Google" → autorizo → vuelve a tu app logueado con un session válido. Si funciona, terminamos.

## Reglas de oro
- Mostrame los comandos exactos que ejecutás y su output completo. No resumás.
- NO hardcodees credenciales, secrets ni tokens en archivos del repo. Todo va a `.env.local` (gitignored) o env vars del sistema.
- Si una tool call devuelve error, **parate, mostrame el error completo y pedíme confirmación antes de aplicar un fix**. No asumas la causa.
- Si una pregunta requiere conocimiento de mi negocio (nombre app, redirect URI prod, framework, path del repo), preguntame con todas las opciones razonables — no inventes valores.
- Para acciones destructivas (`delete_workspace`, `delete_oidc_app`, `delete_idp`), pedíme confirmación EXPLÍCITA antes de cada llamada — perdería users + apps + IdPs irreversiblemente.

## Al terminar
1. Resumime: cuántas OIDC apps creé, qué IdPs activé, qué framework wireamos, paths de los `.env.local`.
2. Recordame opciones siguientes:
   - Más IdPs (GitHub, Apple, Microsoft) con `add_idp(...)` o helpers curated cuando publiquemos.
   - Branding custom (logo, colors, label policy) con `update_branding(...)`.
   - SMTP override propio si quiero usar mi infra de email en lugar del SMTP gestionado.
   - Invitar primeros users con `invite_user(workspace="{workspace_slug}", email=..., role=...)`.
3. Docs:
   - Quickstart: https://docs.prysmid.com/agents/quickstart-claude/
   - Tools reference: https://docs.prysmid.com/agents/tools/
   - Troubleshooting: https://docs.prysmid.com/agents/troubleshooting/
