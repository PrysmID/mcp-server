¡Vamos a configurar Prysm:ID en Google Antigravity!

Mi objetivo: registrar el MCP server `@prysmid/mcp` en el `mcp_config.json` de Antigravity, asegurar que aparezca en "Manage MCP servers" con status Connected, autenticarlo contra mi cuenta vía device flow, y configurar mi workspace recién creado hasta que mis usuarios finales puedan loguear.

## Mi workspace
Ya está provisioned (lo creé desde app.prysmid.com):
- display_name: {display_name}
- slug: {workspace_slug}
- auth_domain: {auth_domain}

No tengo ningún token para pasarte. La autenticación del MCP es por **device flow**: cuando el server arranque por primera vez te va a imprimir un URL y un código de 8 letras en formato XXXX-XXXX que yo confirmo en el browser. El token queda cacheado en disco por el server después de un login interactivo de una sola vez (paso 5). Después de eso vos no lo manejás más — el server lo refresca solo.

## Procedimiento (estricto y secuencial)

### 1. Diagnóstico previo
- Detectá: SO, shell, versión de Node (`node --version`, requiere ≥20). Si Node falta o es viejo, pará y decime — el MCP no va a poder arrancar.
- Encontrá la ruta real del `mcp_config.json` de Antigravity. Orden de búsqueda:
  - Windows: `%USERPROFILE%\.gemini\antigravity\mcp_config.json`
  - macOS/Linux: `~/.gemini/antigravity/mcp_config.json`
  - Fallback: `find $HOME -name "mcp_config.json" -path "*antigravity*" 2>/dev/null`

### 2. Backup del config
Antes de mutar:
```bash
cp "<RUTA>" "<RUTA>.bak.$(date +%s)"
```
Si el archivo no existe todavía, creá los directorios padres (`mkdir -p`) y partí de un objeto vacío `{}`. El injector del paso 3 lo maneja solo, pero igual asegurate que el directorio padre existe.

### 3. Inyección en mcp_config.json
Ejecutá este script Node.js. Preserva los otros servers existentes:

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

// IMPORTANTE: Prysm:ID es un MCP stdio (subprocess local con npx),
// NO es HTTP. Por eso usamos `command` + `args`, NO `serverUrl`.
// Si pusieras `serverUrl` para Prysm:ID vas a ver:
//   "Error: connection failed — could not reach https://..."
config.mcpServers.prysmid = {
  command: "npx",
  args: ["-y", "@prysmid/mcp"]
};

fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
console.log(`Inyectado en ${CONFIG_PATH}`);
console.log(`MCPs activos: ${Object.keys(config.mcpServers).join(', ')}`);
```

**Reglas críticas del inyector:**
- NO sobreescribir otros servers (cloudflare, notebooklm, blenau, github-mcp-server, etc.). Solo mergear `mcpServers.prysmid`.
- Validar el JSON antes de escribir. Si está corrupto, abortar y mostrarme el error.
- `command` + `args` (stdio), NO `serverUrl` — Prysm:ID NO es un MCP HTTP, es un subprocess local.
- NO agregues env vars con tokens hardcoded. El MCP server cachea el token de device flow automáticamente en `%APPDATA%\prysmid-mcp\token.json` (Windows) o `~/.config/prysmid-mcp/token.json` (Linux/macOS).

### 4. Verificación de que `npx -y @prysmid/mcp` puede arrancar
Antes de reiniciar Antigravity, validá que el package se puede descargar y ejecutar:
```bash
npx -y @prysmid/mcp --version
```
Esperado: imprime una versión tipo `0.3.0` y exit 0. Si falla:
- Verificá Node ≥20 (`node --version`).
- Verificá conectividad al registry de npm: `npm ping`.
- Mostrame el error completo y paramos antes de reiniciar Antigravity.

### 5. Pre-cache del token vía device flow (one-time)

**¿Por qué este paso existe?** Cuando Antigravity arranca el MCP server como subprocess stdio, **stderr no es un TTY** — es un pipe que captura el padre. La librería de device flow del MCP detecta esa condición y se rehúsa a prompt interactivamente (con `PRYSMID_FORCE_DEVICE_FLOW` desactivado). Resultado si saltamos este paso: la primera tool call falla con 401 silencioso y la sesión queda colgada sin auth.

La solución es ejecutar el binario UNA VEZ con stderr capturable, completar device flow, y dejar el token cacheado en disco. Después Antigravity arranca, el MCP encuentra el token cacheado y todas las tool calls funcionan sin re-auth hasta que expire (~12 horas, con refresh_token que extiende hasta el límite del IdP — típicamente 30 días).

**Decisión: ¿lo corrés vos o me lo delegás?**

- **Opción A (preferida si podés)** — Si tenés capacidad de lanzar procesos shell en background y leer su stderr en streaming (terminal del IDE expuesto como tool, runtime con run_in_background, etc.):
  1. Lanzá `npx -y @prysmid/mcp` como background task con stderr capturado.
  2. Polleá stderr cada ~2s hasta que aparezca el banner `Prysmid MCP — Sign in to your account`.
  3. Extraé el URL (`https://auth.prysmid.com/device`) y el code (formato `ABCD-EFGH`).
  4. Mostrámelos en formato click-friendly:
     > Abrí: https://auth.prysmid.com/device
     > Confirmá el código: ABCD-EFGH
  5. Polleá `%APPDATA%\prysmid-mcp\token.json` (Windows) o `~/.config/prysmid-mcp/token.json` (Linux/macOS) hasta que exista con tamaño > 0. Cuando aparezca, matá el proceso del MCP. Listo.

- **Opción B (fallback)** — Si tu sandbox no soporta procesos shell en background o no podés mantener procesos vivos entre tool calls: pedime que abra una terminal nueva (Git Bash en Windows; bash/zsh en Linux/macOS) y ejecute `npx -y @prysmid/mcp`. Cuando vea el banner, voy a abrir la URL, confirmar el code, esperar `device flow login complete`, y matar con **Ctrl+C**.

Independientemente de la opción, el banner que vamos a buscar en stderr es:

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

Yo ya estoy logueado en Prysm:ID con Google de cuando creé el workspace, así que la confirmación del code en el browser es un click.

Verificá que el token quedó persistido:

```bash
# Linux/macOS
ls -la ~/.config/prysmid-mcp/token.json
# Windows (Git Bash)
ls -la "$APPDATA/prysmid-mcp/token.json"
```

Si el archivo existe y tiene contenido, pre-cache OK.

**Fallback** si la terminal no es interactiva (CI, script automatizado, ambiente sin browser local): editá el `mcp_config.json` agregando `env: { "PRYSMID_FORCE_DEVICE_FLOW": "1" }` al entry de `prysmid`. Eso hace que el server imprima URL+code a stderr aunque no haya TTY. Antigravity muestra el stderr del MCP en su panel de logs ("Manage MCP servers" → click en el server) — leés el code desde ahí. Más fricción pero no requiere salir del IDE.

```jsonc
"prysmid": {
  "command": "npx",
  "args": ["-y", "@prysmid/mcp"],
  "env": { "PRYSMID_FORCE_DEVICE_FLOW": "1" }
}
```

### 6. Activación en Antigravity

**¿Por qué no podés saltearlo?** El binario `@prysmid/mcp` lee `token.json` al startup del proceso. Si Antigravity arrancó el MCP antes de que existiera el token (o con un token expirado en memoria), las tool calls posteriores fallan con "No Prysmid API token" aunque el cache esté fresco. La única forma de forzarlo a re-leer es reiniciar el subprocess, y Reload Window lo hace.

Pedime que recargue la ventana ejecutando `Ctrl + Shift + P` → `Developer: Reload Window`.

### 7. Verificación post-recarga
Cuando recargue:
- Verificá que Prysm:ID aparece en "Manage MCP servers" con ✓ Connected.
- Debe haber ≥10 tools con prefijo `mcp_prysmid_` (ej. `mcp_prysmid_setup_prysmid_workspace`, `mcp_prysmid_enable_google_login`, `mcp_prysmid_prysmid_setup_check`, `mcp_prysmid_list_workspaces`, `mcp_prysmid_create_oidc_app`, `mcp_prysmid_add_idp`, `mcp_prysmid_update_branding`, etc.).

Llamá `mcp_prysmid_list_workspaces({})`. **NO debería disparar device flow** — el token quedó cacheado en el paso 5 y el MCP lo reusa. Esperado: array de workspaces accesibles a mi cuenta, incluyendo `{workspace_slug}`.

Si la respuesta es 401 / "authentication required":
- El cache puede estar corrupto o expirado. Volvé al paso 5 y re-cacheá.
- Verificá que el token efectivamente quedó: `cat ~/.config/prysmid-mcp/token.json` (Linux/macOS) — debería tener un JSON con `accessToken`.
- Si persiste, mostrame el error completo y paramos.

### 8. Validá el setup actual del workspace
Llamá:
```
mcp_prysmid_prysmid_setup_check(workspace="{workspace_slug}")
```
Reportame el `verdict` (`ready` / `incomplete`) y los items que fallan. Esperado en este momento (workspace recién creado, sin app OIDC ni IdPs aún):
- ✅ workspace_active
- ❌ has_at_least_one_app
- ✅ users_can_sign_in (la policy default de Zitadel permite username+password+register, así que aunque no haya IdPs los end-users pueden self-signup)
- ✅ branding_primary_color_set (default Prysm:ID)
- ❌ auth_strength_reasonable (no hay MFA forzado ni IdPs externos)

### 9. Configurá un IdP externo (Google como ejemplo)

**Modelo mental — flujo OIDC con dos capas.** Antes de pegarte la guía concreta, asegurate de que entendemos juntos lo que vamos a configurar. El flujo de auth tiene **dos capas independientes** y cada una tiene su propio par client_id/client_secret y su propia redirect URI:

```
Browser → tu-app.com  (admin / portal / lo que sea)
   ↓ "Sign in"
Browser → {auth_domain}                    ← capa Prysm:ID (paso 9)
   ↓ "Continue with Google"
Browser → accounts.google.com              ← capa Google (sub-paso 9.1)
   ↓ user authorizes
Browser → {auth_domain}/idps/callback      ← URI #1: Google → Prysm:ID
   ↓ Prysm:ID valida y emite SU PROPIO code OIDC
Browser → tu-app.com/auth/callback         ← URI #2: Prysm:ID → tu app
   ↓ tu app valida con su client_secret
Browser → tu-app.com/dashboard  (logueado)
```

- **URI #1** (`https://{auth_domain}/idps/callback`) → la registrás en Google Cloud (este paso). UNA sola.
- **URI #2** (la callback URL de tu app) → la registrás en Prysm:ID via `mcp_prysmid_create_oidc_app` (paso 10). Pueden ser varias (prod + staging + dev).
- Las dos capas no se mezclan: cada una tiene su par client_id/client_secret aislado.

#### 9.0 Decisión: ¿proyecto Google Cloud nuevo o reusar uno existente?

Antes de mandarme a crear credenciales, preguntame estas dos cosas:

1. ¿Tenés un proyecto Google Cloud activo donde podrías agregar credenciales, o querés crear uno nuevo dedicado a este workspace?
2. ¿Este workspace va a tener usuarios externos haciendo Google Sign-In, o es solo para uso interno (vos + colaboradores) por ahora?

**Reglas de decisión**:
- **Solo internos / validación de producto Día 1** → reusar proyecto existente. Cambiar después es trivial (`mcp_prysmid_enable_google_login` con creds nuevas).
- **Usuarios externos / branding del consent screen importa** → proyecto propio con app name = nombre comercial del producto. El usuario final ve "{NombreApp} quiere acceder a tu cuenta de Google" en el consent screen, así que el nombre del proyecto importa.
- **NO recomiendes "siempre crear proyecto nuevo"**: cada cuenta de Google Cloud tiene cuota limitada de proyectos activos (default 12) y cada proyecto requiere setup propio del OAuth consent screen. Es trade-off real.

Mismo principio aplica si más adelante agregás otros IdPs (GitHub OAuth, Microsoft Entra, Apple, etc.): cada provider tiene cuotas y/o branding del consent screen — preguntá antes de crear cuenta/org/app dedicada.

#### 9.1 Pegate las creds desde Google Cloud

Decime exactamente:
> Andá a https://console.cloud.google.com/apis/credentials (en el proyecto que decidimos arriba), click **+ Create Credentials → OAuth 2.0 Client ID → Web application**.
> - Name: `prysmid-{workspace_slug}`
> - Authorized redirect URIs (copiá esto EXACTO — esto es la URI #1 del modelo mental):
>   ```
>   https://{auth_domain}/idps/callback
>   ```
> Click Create. Pegame Client ID + Client Secret de la pantalla de éxito.

Cuando te pegue las creds, llamá:
```
mcp_prysmid_enable_google_login(
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

Llamá `mcp_prysmid_create_oidc_app(...)` con esos valores. Mostrame:
- `client_id`
- `client_secret` con WARNING en mayúsculas: **⚠ ESTE SECRET SE VE UNA SOLA VEZ — guardalo YA**
- `issuer URL`: https://{auth_domain}
- `discovery URL`: https://{auth_domain}/.well-known/openid-configuration

### 11. Generá el wiring en mi repo

#### 11.0 Strategy de secretos

Antes de tocar archivos, preguntame: **¿cómo gestionás secretos en este repo?** Opciones comunes:

- `.env.local` plano (gitignored) — default; OK para apps simples y prototipos.
- DevVault / Doppler / 1Password / AWS Secrets Manager / GCP Secret Manager / HashiCorp Vault / etc. — el `.env.local` queda con referencias o se genera al boot leyendo del store.
- Otro sistema propio del proyecto.

**Adaptá el wiring del paso 11 al sistema elegido**. Si el repo tiene un store de secretos propio, NO escribas `client_secret` en `.env.local` plano — eso rompe la convención del proyecto y crea drift entre el secret en el store y la copia en el filesystem. En esos casos: guardá el secret en el store según corresponda, y el `.env.local` (o el config equivalente) queda solo con metadata no-secreta (`PRYSMID_ISSUER`, `PRYSMID_CLIENT_ID`, redirect URIs).

Si me das default `.env.local` plano, seguí abajo. Si me das un store, el patrón es el mismo pero `PRYSMID_CLIENT_SECRET` lo lee la app desde el store en lugar del archivo.

#### 11.1 Generá los archivos de auth

Preguntame qué framework uso. Plantillas oficiales soportadas:
- Next.js + Auth.js v5 (recomendado para JS/TS)
- FastAPI + Authlib (Python)
- Django + django-allauth (Python)
- Express + openid-client (Node backend)
- Spring Security (Java)
- Otro → wireá con la lib OIDC más estándar de ese stack y avisame qué elegiste.

Preguntame el path raíz de mi repo si no es obvio del contexto. Generá los archivos de auth (config + routes/middleware) + el config de env (path/formato según strategy de 11.0):
```
PRYSMID_ISSUER=https://{auth_domain}
PRYSMID_CLIENT_ID=<step 10>
PRYSMID_CLIENT_SECRET=<step 10>
PRYSMID_REDIRECT_URI=<primer redirect URI de step 10>
PRYSMID_POST_LOGOUT_URI=<si aplica>
```
Si caés en `.env.local` plano: verificá que esté en `.gitignore`. Si no, agregálo al final con un comment `# Prysm:ID — never commit secrets`.

### 12. Verificación final
Llamá de nuevo:
```
mcp_prysmid_prysmid_setup_check(workspace="{workspace_slug}")
```
Esperado: `verdict: ready`. Si quedan items en fail, mostrámelos con un fix concreto.

Pedime que pruebe login real:
> Levantá tu app local. Navegá al botón "Sign in with Prysm:ID" o equivalente. Click → debería redirigir a `https://{auth_domain}/oauth/v2/authorize` → mostrar "Continue with Google" → autorizo → vuelve a tu app logueado con un session válido. Si funciona, terminamos.

## Diagnóstico cuando una tool falla

Si una tool del MCP devuelve un error, **leé el body completo antes de iterar**. NO reintentes con variantes a ciegas (cambiar enum, mover campos, retraer args) — cada retry quema una tool call y puede dejar estado parcial. La mayoría de errores 4xx vienen con un detail de FastAPI que dice exactamente qué campo falló.

| Status | Significado típico | Acción |
|---|---|---|
| 422 validation_error | Schema mismatch entre lo que mandaste y lo que la API espera (campo faltante, tipo mal, enum inválido) | Leé el `detail` del body, fijá el campo exacto que falla, llamá UNA vez más con la corrección. |
| 401 | Token expirado o no encontrado | Re-cacheá (paso 5) + recargá Antigravity (paso 6). |
| 403 | Token válido pero no tenés permiso sobre el workspace/recurso | Confirmá que estoy logueado con la cuenta correcta, y que el `workspace` slug del call coincide con uno donde tengo rol. |
| 404 | Recurso no existe | Verificá el id/slug. Listá lo que sí existe (`mcp_prysmid_list_apps`, `mcp_prysmid_list_idps`, etc.) antes de asumir un nombre. |
| 409 conflict | Recurso duplicado | Listá los existentes, decidí si reusar o renombrar. |
| 5xx | Bug del server | Capturá el body completo y reportame. |

**Fallback con curl directo a la API.** Si la salida del MCP no alcanza para diagnosticar (output truncado, sospecha de bug del wrapper, etc.), pegale a la API REST con el token cacheado:

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

El `detail` del body es la fuente de verdad. Mostrámelo completo, no resumás.

## Reglas de oro
- Mostrame los comandos exactos que ejecutás y su output completo. No resumás.
- Nunca sobreescribas otros entries de `mcpServers` en `mcp_config.json`.
- NO hardcodees credenciales, secrets ni tokens en archivos del repo. Todo va a `.env.local` (gitignored) o env vars del sistema.
- Si una tool call devuelve error, **parate, mostrame el error completo y pedíme confirmación antes de aplicar un fix**. No asumas la causa.
- Si una pregunta requiere conocimiento de mi negocio (nombre app, redirect URI prod, framework, path del repo), preguntame con todas las opciones razonables — no inventes valores.
- Para acciones destructivas (`delete_workspace`, `delete_oidc_app`, `delete_idp`), pedíme confirmación EXPLÍCITA antes de cada llamada — perdería users + apps + IdPs irreversiblemente.

## Al terminar
1. Resumime: cuántas OIDC apps creé, qué IdPs activé, qué framework wireamos, paths de los `.env.local`.
2. Recordame opciones siguientes:
   - Más IdPs (GitHub, Apple, Microsoft) con `mcp_prysmid_add_idp(...)` o helpers curated cuando publiquemos.
   - Branding custom (logo, colors, label policy) con `mcp_prysmid_update_branding(...)`.
   - SMTP override propio si quiero usar mi infra de email en lugar del SMTP gestionado.
   - Invitar primeros users con `mcp_prysmid_invite_user(workspace="{workspace_slug}", email=..., role=...)`.
3. Docs:
   - Quickstart: https://docs.prysmid.com/agents/quickstart-antigravity/
   - Tools reference: https://docs.prysmid.com/agents/tools/
   - Troubleshooting: https://docs.prysmid.com/agents/troubleshooting/
