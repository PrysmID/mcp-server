¡Vamos a configurar Prysm:ID end-to-end usando el CLI!

Mi objetivo: dejar mi workspace recién creado completamente operativo (IdP externo, app OIDC, wiring en mi repo) usando la herramienta de línea de comandos `@prysmid/cli`. No vamos a tocar config de MCP, ni archivos de tu editor, ni JSON específico de ningún host — solo terminal y código.

## Mi workspace
Ya está provisioned (lo creé desde app.prysmid.com):
- display_name: {display_name}
- slug: {workspace_slug}
- auth_domain: {auth_domain}

No tengo ningún token para pasarte. La autenticación del CLI es por **device flow**: cuando ejecutes `prysmid login` por primera vez te va a imprimir un URL y un código de 8 letras en formato `XXXX-XXXX` que yo confirmo en el browser. El token queda cacheado en disco después del login y el CLI lo reusa en cada comando hasta que expire.

## Por qué CLI y no MCP

El CLI funciona en cualquier editor o agente que pueda ejecutar comandos en una terminal. No requiere configuración por host (no `mcp_config.json`, no `~/.claude.json`, no UI de "Add MCP server"). Si después querés tener integración nativa MCP, eso es un setup separado — pero todo lo que hacemos acá lo cubre el CLI.

Vos mismo (el agente) podés llamar a `prysmid` como cualquier otro comando shell; el output es JSON cuando se pipea (`prysmid <cmd> --json` o `-o json`), perfecto para que lo parsees y tomes decisiones. Los errores incluyen líneas `hint:` con remediation concreto.

## Procedimiento (estricto y secuencial)

### 1. Diagnóstico previo
- Detectá: SO, shell, versión de Node (`node --version`, requiere ≥20). Si Node falta o es viejo, pará y decime — el CLI no va a poder arrancar.
- Verificá que `npx` está disponible: `npx --version`.
- Decidí cómo invocar el CLI:
  - **Modo persistente**: `npm install -g @prysmid/cli` y luego `prysmid <cmd>`.
  - **Modo ad-hoc**: `npx -y @prysmid/cli@latest <cmd>` en cada llamada.

  Si yo (el usuario) no tengo opinión, instalá global. Si el ambiente es CI/efímero, usá `npx`.

### 2. Auto-descubrimiento del CLI
Antes de cualquier otra cosa, pedile al CLI que se describa solo:
```bash
prysmid --version
prysmid describe-tools --json
```
`describe-tools` devuelve un manifest JSON con cada comando, su summary, su help completo y sus flags. **Cacheá ese manifest** y consultalo cuando dudes qué flag tiene un comando — no inventes flags.

Lectura rápida humana: `prysmid --help`.

### 3. Login (device flow, una sola vez)
```bash
prysmid login
```
El CLI imprime en stderr un banner con la forma:

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

**Cómo manejarlo:**

- **Opción A** — si tu sandbox soporta procesos en background con stderr en streaming (Bash tool con `run_in_background`, terminal expuesta como tool, etc.):
  1. Lanzá `prysmid login` como background task.
  2. Polleá stderr hasta que aparezca el banner.
  3. Mostrámelo en formato click-friendly:
     > Abrí: https://auth.prysmid.com/device
     > Confirmá el código: ABCD-EFGH
  4. Cuando el proceso termine con exit 0, login OK.

- **Opción B** — si no podés mantener procesos vivos entre tool calls: pedime que abra una terminal y ejecute `prysmid login`, y que me avise cuando vea `expires in 600s`. Yo abro la URL, confirmo el code, y el comando termina solo.

Yo ya estoy logueado en Prysm:ID con Google de cuando creé el workspace, así que la confirmación del code en el browser es un click.

### 4. Validación de auth y conectividad
```bash
prysmid doctor --json
```
Esperado: `ok: true` con todos los checks en verde. Si algún check falla, el JSON tiene `detail` con la causa exacta. Errores comunes:
- `credentials.present: false` → el login del paso 3 no quedó cacheado. Revisá si terminó OK.
- `api.reachable: false` → red bloqueada. Pedime que verifique conectividad.
- `api.authorized: false` → token rechazado. Volvé a hacer login.

```bash
prysmid whoami --json
```
Te confirma identidad y profile activo. Esperado: que mi email aparezca en el campo `user`.

### 5. Estado actual del workspace
```bash
prysmid setup-check --workspace {workspace_slug} --json
```
Reportame el `verdict` y los items que fallan. Esperado en este momento (workspace recién creado, sin app OIDC ni IdPs aún):
- ✅ workspace_active
- ❌ has_at_least_one_app
- ✅ users_can_sign_in (la policy default de Zitadel permite username+password+register)
- ✅ branding_primary_color_set (default Prysm:ID)
- ❌ auth_strength_reasonable (no hay MFA forzado ni IdPs externos todavía)

Esos dos `❌` los vamos a cerrar en los próximos pasos.

### 6. Configurá un IdP externo (Google como ejemplo)

**Modelo mental — flujo OIDC con dos capas.** El flujo de auth tiene dos capas independientes y cada una tiene su propio par client_id/client_secret y su propia redirect URI:

```
Browser → tu-app.com  (admin / portal / lo que sea)
   ↓ "Sign in"
Browser → {auth_domain}                    ← capa Prysm:ID (paso 6)
   ↓ "Continue with Google"
Browser → accounts.google.com              ← capa Google (sub-paso 6.1)
   ↓ user authorizes
Browser → {auth_domain}/idps/callback      ← URI #1: Google → Prysm:ID
   ↓ Prysm:ID valida y emite SU PROPIO code OIDC
Browser → tu-app.com/auth/callback         ← URI #2: Prysm:ID → tu app
   ↓ tu app valida con su client_secret
Browser → tu-app.com/dashboard  (logueado)
```

- **URI #1** (`https://{auth_domain}/idps/callback`) → la registrás en Google Cloud (este paso). UNA sola.
- **URI #2** (la callback URL de tu app) → la registrás en Prysm:ID via `prysmid app create` (paso 7). Pueden ser varias (prod + staging + dev).
- Las dos capas no se mezclan: cada una tiene su par client_id/client_secret aislado.

#### 6.0 Decisión: ¿proyecto Google Cloud nuevo o reusar uno existente?

Antes de mandarme a crear credenciales, preguntame:

1. ¿Tenés un proyecto Google Cloud activo donde podrías agregar credenciales, o querés crear uno nuevo dedicado a este workspace?
2. ¿Este workspace va a tener usuarios externos haciendo Google Sign-In, o es solo para uso interno (vos + colaboradores) por ahora?

**Reglas de decisión**:
- **Solo internos / validación de producto Día 1** → reusar proyecto existente. Cambiar después es trivial.
- **Usuarios externos / branding del consent screen importa** → proyecto propio con app name = nombre comercial del producto. El usuario final ve "{NombreApp} quiere acceder a tu cuenta de Google" en el consent screen.
- **NO recomiendes "siempre crear proyecto nuevo"**: cada cuenta de Google Cloud tiene cuota limitada de proyectos activos (default 12) y cada proyecto requiere setup propio del OAuth consent screen.

#### 6.1 Pegate las creds desde Google Cloud

Decime exactamente:
> Andá a https://console.cloud.google.com/apis/credentials (en el proyecto que decidimos arriba), click **+ Create Credentials → OAuth 2.0 Client ID → Web application**.
> - Name: `prysmid-{workspace_slug}`
> - Authorized redirect URIs (copiá esto EXACTO — esto es la URI #1 del modelo mental):
>   ```
>   https://{auth_domain}/idps/callback
>   ```
> Click Create. Pegame Client ID + Client Secret de la pantalla de éxito.

Cuando te pegue las creds, ejecutá:
```bash
prysmid idp enable-google \
  --workspace {workspace_slug} \
  --client-id "<lo que pegué>" \
  --client-secret "<lo que pegué>" \
  --json
```
Esto agrega Google como IdP **y** flipea `allow_external_idp=true` en la login policy. Mostrame la respuesta. Esperado: un objeto con `ok: true` y el `idp.id` recién creado.

### 7. Creá la OIDC app de mi producto
Preguntame uno por uno:
- **Nombre de la app** (ej. "Acme Web", "Acme Mobile"). Es etiqueta interna; no se expone a end-users.
- **Redirect URI(s)** — URL(s) exacta(s) del callback OIDC de mi app. Ejemplos:
  - prod: `https://app.acme.com/auth/callback`
  - dev local: `http://localhost:3000/auth/callback/prysmid`
- **App type**: `web` (server-rendered, confidential) por default; `native` o `user-agent` si yo lo digo.
- **Auth method**: `basic` (default) salvo que pida otra cosa.

Ejecutá (en v0.1 el CLI acepta múltiples redirect URIs separados por coma):
```bash
prysmid app create \
  --workspace {workspace_slug} \
  --name "<nombre>" \
  --redirect-uri "<uri1>,<uri2>" \
  --app-type web \
  --auth-method basic \
  --json
```

Mostrame:
- `client_id`
- `client_secret` con WARNING en mayúsculas: **⚠ ESTE SECRET SE VE UNA SOLA VEZ — guardalo YA**
- `issuer URL`: `https://{auth_domain}`
- `discovery URL`: `https://{auth_domain}/.well-known/openid-configuration`

### 8. Generá el wiring en mi repo

#### 8.0 Strategy de secretos

Antes de tocar archivos, preguntame: **¿cómo gestionás secretos en este repo?** Opciones comunes:

- `.env.local` plano (gitignored) — default; OK para apps simples y prototipos.
- DevVault / Doppler / 1Password / AWS Secrets Manager / GCP Secret Manager / HashiCorp Vault — el `.env.local` queda con referencias o se genera al boot leyendo del store.
- Otro sistema propio del proyecto.

**Adaptá el wiring al sistema elegido**. Si el repo tiene un store de secretos propio, NO escribas `client_secret` en `.env.local` plano — eso rompe la convención del proyecto y crea drift entre el store y la copia en el filesystem.

#### 8.1 Generá los archivos de auth

Preguntame qué framework uso. Plantillas oficiales soportadas:
- Next.js + Auth.js v5 (recomendado para JS/TS)
- FastAPI + Authlib (Python)
- Django + django-allauth (Python)
- Express + openid-client (Node backend)
- Spring Security (Java)
- Otro → wireá con la lib OIDC más estándar de ese stack y avisame qué elegiste.

Generá los archivos de auth (config + routes/middleware) + el config de env:
```
PRYSMID_ISSUER=https://{auth_domain}
PRYSMID_CLIENT_ID=<step 7>
PRYSMID_CLIENT_SECRET=<step 7>
PRYSMID_REDIRECT_URI=<primer redirect URI de step 7>
PRYSMID_POST_LOGOUT_URI=<si aplica>
```
Si caés en `.env.local` plano: verificá que esté en `.gitignore`. Si no, agregálo al final con un comment `# Prysm:ID — never commit secrets`.

### 9. Verificación final
```bash
prysmid setup-check --workspace {workspace_slug} --json
```
Esperado: `verdict: ready`. Si quedan items en fail, mostrámelos con un fix concreto.

Pedime que pruebe login real:
> Levantá tu app local. Navegá al botón "Sign in with Prysm:ID" o equivalente. Click → debería redirigir a `https://{auth_domain}/oauth/v2/authorize` → mostrar "Continue with Google" → autorizo → vuelve a tu app logueado con un session válido. Si funciona, terminamos.

## Diagnóstico cuando un comando falla

Cualquier comando del CLI puede fallar con un error de API HTTP. El formato es:

```
prysmid: API error <STATUS> — <METHOD> <PATH> → <STATUS>
{"error":"...","message":"...","details":...}
hint: <remediation>
```

**Status → acción**:
- `401` → tu token expiró o quedó inválido. Re-ejecutá `prysmid login`.
- `403` → no tenés permiso sobre ese recurso. NO loopees; pedime contexto.
- `404` → slug/id mal escrito. Listá primero (`prysmid workspace list --json`) y reintentá.
- `409` → el recurso ya existe o está en un estado conflictivo. Mostrame el detalle.
- `422` → error de validación. El body JSON tiene los campos malos.
- `5xx` → error transitorio del API. Reintentá una vez. Si persiste, corré `prysmid doctor --json`.

Si el error no es de API (parsing, falta de flag, network), el mensaje es directo y suele incluir qué hace falta.

## Reglas duras
- **NO inventes flags.** Si no estás seguro, consultá `prysmid <cmd> --help` o el manifest de `describe-tools`.
- **NO hardcodees `PRYSMID_API_TOKEN` en archivos del repo.** El token cacheado del login está protegido a nivel filesystem; el env var solo para CI con un secret store.
- **NO ejecutes `prysmid workspace delete` sin confirmación explícita mía.** El comando ya requiere `--yes`, pero igual preguntame antes.
- **NO mezcles lenguas en el mismo flujo.** Si yo escribo en español, respondé en español; mantené nombres de comandos en inglés (son literales).
- **Mostrame siempre el comando que vas a ejecutar antes de correrlo cuando muta estado** (`create`, `update`, `delete`, `enable-google`, `setup`). Para reads (`list`, `get`, `describe-tools`, `doctor`, `whoami`, `setup-check`) podés ejecutar directo.

## Si algo se rompe
- Corré `prysmid doctor --json` y mostrame el output literal.
- Mostrame el comando exacto que falló y su output completo.
- NO asumas; preguntame antes de retroceder pasos manualmente.

Listo. Empezá por el paso 1.
