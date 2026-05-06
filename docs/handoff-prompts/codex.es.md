Quiero que actúes como mi agente de integración para Prysm:ID dentro de Codex.

## Objetivo
- Configurar y validar el MCP de Prysm:ID en Codex.
- Autenticarlo de forma persistente.
- Probar que podés invocar herramientas reales del MCP desde esta sesión.
- Completar la integración del workspace `{workspace_slug}`.
- Dejar el repo local listo para login OIDC sin duplicar cambios ni recrear recursos existentes.

## Mi workspace
Ya está provisioned (lo creé desde app.prysmid.com):
- display_name: {display_name}
- slug: {workspace_slug}
- auth_domain: {auth_domain}

## Contexto crítico
- Esto es **Codex**, no Claude Code. El config vive en `~/.codex/config.toml` (Linux/macOS) o `%USERPROFILE%\.codex\config.toml` (Windows). El registro del MCP es por TOML, no por CLI tipo `claude mcp add`.
- El MCP de Prysm:ID es **stdio** (subprocess local). NO es HTTP, NO uses `serverUrl`, NO uses `--transport http`.
- El env var correcto es `PRYSMID_API_TOKEN` (no `PRYSMID_TOKEN`).
- No pidas secretos por chat. Si ya hay un token cacheado en disco o un PAT en el secret store del proyecto, reusalo.
- Si una acción ya está hecha, no la repitas. Verificá estado primero, mutá solo si hay diferencia real.
- Si el workspace, el IdP o la app ya existen, reusá lo existente en vez de crear duplicados.

## Modelo de auth — entender antes de configurar

El MCP de Prysm:ID soporta dos modos de auth, mutuamente excluyentes:

**Modo A — device flow (default, interactivo)**
- No seteás `PRYSMID_API_TOKEN`.
- En la primera invocación, el MCP imprime a stderr un banner con un URL y un código de 8 letras `XXXX-XXXX`.
- Yo confirmo el código en el browser una sola vez. El MCP cachea el token en:
  - Linux/macOS: `~/.config/prysmid-mcp/token.json`
  - Windows: `%APPDATA%\prysmid-mcp\token.json`
- Sesiones futuras de Codex levantan el token cacheado sin re-auth hasta que expire (~12 hs; con refresh, hasta ~30 días).
- **Problema con stdio en Codex**: stderr del subprocess MCP no es un TTY → la lib de device flow normalmente se rehúsa a prompt. Solución: setear `PRYSMID_FORCE_DEVICE_FLOW=1` en el env del MCP, lo que fuerza la emisión del banner igual. Codex muestra stderr del MCP en su panel de logs.

**Modo B — token estático (para CI / automatización)**
- Seteás `PRYSMID_API_TOKEN=pat_...` en el env del MCP con un PAT generado desde `app.prysmid.com`.
- No hay device flow, no hay banner; el MCP usa el token directo.
- Solo conviene para entornos sin browser local.

**Default recomendado: Modo A** salvo que yo te indique lo contrario.

## Regla de oro
- No declares éxito por tener archivos escritos.
- Solo considerá éxito cuando una herramienta real del MCP responde **y** `prysmid_setup_check(workspace="{workspace_slug}")` retorna `verdict: "ready"`.

## Regla #0 — vos ejecutás, yo no abro terminales

**Vos sos quien corre los comandos.** Tenés un tool de shell — usalo. **NO** me pidas a mí "ejecutá esto en tu terminal y pegame la salida". Eso anula el sentido de tener un agente con acceso a shell.

Lo único que yo hago manualmente:
1. Confirmar el código del device flow en el browser (un click — yo ya estoy logueado en Google).
2. Pegar credenciales que vienen de UIs externas (Google Cloud Console, etc.) que vos no podés ver.
3. Decisiones de producto que requieren mi opinión (nombre de app, redirect URIs, framework).

Todo lo demás lo corrés vos.

## Procedimiento (estricto y secuencial)

### 1. Diagnóstico inicial
- Detectá: SO, shell, versión de Node (`node --version`, requiere ≥20).
- Verificá que `codex` está disponible: `codex --version`.
- Identificá el path del config:
  - Linux/macOS: `~/.codex/config.toml`
  - Windows: `%USERPROFILE%\.codex\config.toml`
- Listá MCPs actuales: `codex mcp list`.

### 2. Inspección antes de tocar nada
- Si `prysmid` ya aparece en `codex mcp list`, leé el bloque `[mcp_servers.prysmid]` del config y confirmá que tiene la forma esperada (sección 3). Si ya está bien, **no lo reescribas**.
- Si `prysmid` NO existe o está mal configurado, seguí al paso 3.
- Backup defensivo del config antes de editar:
  ```bash
  # Linux/macOS
  cp ~/.codex/config.toml ~/.codex/config.toml.bak.$(date +%s)
  # Windows (Git Bash)
  cp "$USERPROFILE/.codex/config.toml" "$USERPROFILE/.codex/config.toml.bak.$(date +%s)"
  ```

### 3. Registrá el MCP (modo A — device flow)
Forma esperada del bloque en `~/.codex/config.toml`:

```toml
[mcp_servers.prysmid]
command = "npx"
args = ["-y", "@prysmid/mcp"]
enabled = true
# `required` deliberadamente omitido (= false). Si ponemos true y el MCP falla
# al arrancar (npm sin red, paquete corrupto), Codex rechaza cargar la sesión.
# Mejor que falle suave: la UI muestra el server como "failed" y el usuario
# sigue funcionando con los demás MCPs.

[mcp_servers.prysmid.env]
# Forzá emisión del banner de device flow a stderr aunque no haya TTY.
# Codex captura stderr del subprocess y lo muestra en su panel de logs.
PRYSMID_FORCE_DEVICE_FLOW = "1"
```

**Modo B (token estático, solo si yo lo pido)**: agregá `PRYSMID_API_TOKEN = "pat_..."` al bloque `[mcp_servers.prysmid.env]` y omitir `PRYSMID_FORCE_DEVICE_FLOW`.

Si el bloque ya existe pero tiene una forma equivalente con orden de keys distinto, no lo reescribas — el formato TOML no es sensible al orden.

### 4. Pre-cache del token (modo A — one-time)

**Por qué este paso existe.** Si Codex arranca el MCP como subprocess y la primera tool call necesita auth, el flujo se va a poner pesado: el agente recibe 401, hace logging del banner, vos tenés que ir al panel de logs de Codex, leer el code, y reintentar. Mejor pre-cachear: ejecutar el MCP UNA vez fuera de Codex, completar device flow, y dejar el token en disco. Después Codex arranca el MCP y todas las tool calls funcionan inmediatas.

**Decisión: ¿lo corrés vos o me lo delegás?**

- **Opción A (preferida)** — si podés lanzar procesos en background con stderr en streaming:
  1. Lanzá `npx -y @prysmid/mcp` como background task con stderr capturado.
  2. Polleá stderr cada ~2s hasta que aparezca `Prysmid MCP — Sign in to your account`.
  3. Extraé URL (`https://auth.prysmid.com/device`) y código (`ABCD-EFGH`).
  4. Mostrámelos:
     > Abrí: https://auth.prysmid.com/device
     > Confirmá el código: ABCD-EFGH
  5. Polleá el archivo de token (`~/.config/prysmid-mcp/token.json` o `%APPDATA%\prysmid-mcp\token.json`) hasta que exista con tamaño > 0. Cuando aparezca, matá el proceso.

- **Opción B (fallback)** — si tu sandbox no soporta procesos en background: pedime que abra una terminal y ejecute `npx -y @prysmid/mcp`. Yo abro el URL, confirmo el código, espero el mensaje `device flow login complete`, y mato con Ctrl+C.

Yo ya estoy logueado en Prysm:ID con Google de cuando creé el workspace, así que la confirmación es un click.

**Si encontrás el token cacheado ya presente y no expirado, saltate este paso.**

### 5. Reinicio de Codex
El MCP se carga como subprocess al startup de Codex. Si Codex estaba abierto cuando editaste `config.toml`, los cambios no se aplican hasta que reinicies. Pedime que cierre Codex completamente y lo abra de nuevo.

### 6. Verificación del registro
- Ejecutá `codex mcp list`. Confirmá que `prysmid` aparece como `enabled`.
- Si aparece `Auth: Unsupported` para `prysmid`, eso es esperado para stdio (Codex solo soporta OAuth sobre HTTP).
- Si el server NO aparece, leé el panel de logs del MCP en Codex; un error frecuente es Node ausente del PATH del proceso.

### 7. Validación real del MCP
No te limites a confirmar que `npx` arranca. Hacé prueba real de protocolo:

- Si Codex en esta sesión puede invocar MCP tools directamente (lo más probable post-reinicio), usalo.
- Si no, usá `@modelcontextprotocol/inspector` en modo CLI como harness:
  ```bash
  npx -y @modelcontextprotocol/inspector --cli npx -y @prysmid/mcp
  ```
  desde ahí podés invocar `tools/list`, `list_workspaces`, etc.

**Validación mínima obligatoria:**
1. Listar herramientas → confirmá ≥10 tools, incluyendo `list_workspaces`, `prysmid_setup_check`, `enable_google_login`.
2. Llamar `list_workspaces({})` → esperá array que incluya `{workspace_slug}`.
3. Llamar `prysmid_setup_check(workspace="{workspace_slug}")` → reportá `verdict` exacto y cada check.

Si esa prueba ya pasó en esta sesión, no la repitas. Si falla, leé el error completo, corregí la causa exacta y reintentá UNA vez.

### 8. Catálogo de herramientas esperadas
- `list_workspaces`, `get_workspace`, `create_workspace`, `delete_workspace`
- `list_apps`, `create_oidc_app`, `delete_oidc_app`
- `list_idps`, `add_idp`, `delete_idp`, `enable_google_login` (curated, multi-step)
- `get_login_policy`, `update_login_policy`
- `get_branding`, `update_branding`, `delete_logo`, `revert_to_platform_default`
- `list_users`, `invite_user`, `delete_user`
- `setup_prysmid_workspace` (curated), `prysmid_setup_check`, `retry_provisioning`
- Billing y SMTP también disponibles si yo los pido.

Si alguna herramienta cambió de nombre, no asumas: inspeccioná el catálogo real y adaptá.

### 9. Estado actual del workspace
Llamá `prysmid_setup_check(workspace="{workspace_slug}")`. Reportame el `verdict` y cada item.

- Si `verdict: ready`, **no toques nada**, andá al paso 13 (wiring del repo).
- Si `verdict: incomplete`, identificá los checks fallidos y trabajá **solo** sobre esos. Los típicos en este momento: `has_at_least_one_app: false`, `auth_strength_reasonable: false`.

### 10. Modelo mental OIDC — dos capas
Antes de tocar IdPs y OIDC apps, asegurate de entender el flujo:

```
Browser → tu-app.com  (admin / portal / lo que sea)
   ↓ "Sign in"
Browser → {auth_domain}                     ← capa Prysm:ID (paso 11)
   ↓ "Continue with Google"
Browser → accounts.google.com               ← capa Google (sub-paso 11.1)
   ↓ user authorizes
Browser → {auth_domain}/idps/callback       ← URI #1: Google → Prysm:ID
   ↓ Prysm:ID valida y emite SU PROPIO code OIDC
Browser → tu-app.com/auth/callback          ← URI #2: Prysm:ID → tu app
   ↓ tu app valida con su client_secret
Browser → tu-app.com/dashboard  (logueado)
```

- **URI #1** se registra en Google Cloud (paso 11). UNA sola.
- **URI #2** se registra en Prysm:ID via `create_oidc_app` (paso 12). Pueden ser varias.
- Las dos capas tienen client_id/client_secret aislados.

### 11. IdPs (idempotente)
- `list_idps(workspace="{workspace_slug}")`.
- Si Google ya existe y está activo, **no lo agregues de nuevo**.
- Si existe pero está deshabilitado, intentá habilitarlo o actualizarlo. NO crees duplicado.
- Si falta y yo te indico configurarlo:
  1. Decidime: proyecto Google Cloud nuevo o reutilizar uno existente. Si es para usuarios externos, dedicado; si es interno, reusar.
  2. Decime exactamente:
     > Andá a https://console.cloud.google.com/apis/credentials. **+ Create Credentials → OAuth 2.0 Client ID → Web application**.
     > - Name: `prysmid-{workspace_slug}`
     > - Authorized redirect URIs (URI #1, copiá EXACTO):
     >   ```
     >   https://{auth_domain}/idps/callback
     >   ```
     > Pegame Client ID + Client Secret.
  3. **No pidas el client_secret en chat si ya está en el secret store del proyecto** (`.env.local`, vault del repo, etc.). Buscalo primero. Si no existe, ahí sí preguntámelo.
  4. Llamá `enable_google_login(workspace="{workspace_slug}", google_client_id=..., google_client_secret=...)`. Es curated: agrega Google Y flipea `allow_external_idp=true` en la login policy.

### 12. OIDC app (idempotente)
- `list_apps(workspace="{workspace_slug}")`.
- Si ya existe una app con el mismo nombre o redirect URI equivalente, reusala. Reportame su `client_id` y `client_secret` desde el state local si lo tenemos; si no, anotá que el secret no se puede recuperar (Zitadel solo lo muestra una vez).
- Si falta, preguntame:
  - Nombre de la app (etiqueta interna).
  - Redirect URI(s). Si son `http://localhost`, agregá `dev_mode=true`.
  - Post-logout redirect URI (opcional).
  - App type (default `web`).
- **Antes de llamar `create_oidc_app` — decidí dónde va el `client_secret`** (detectá `devvault.yml` → DevVault, `.doppler.yaml` → Doppler, `op://` → 1Password; default `.env.local` con `chmod 600`). El secret se ve UNA sola vez; si lo creás antes de saber su destino, terminás echándolo al chat y queda comprometido en el transcript.
- Llamá `create_oidc_app(...)`.
- **Manejo del response — NO eches el secret al chat.** Parseá el JSON internamente, escribí `client_secret` directo al store decidido arriba. Reportame solo:
  - `client_id` (no es secreto)
  - issuer: `https://{auth_domain}`
  - discovery: `https://{auth_domain}/.well-known/openid-configuration`
  - `client_secret`: **`<escrito en {ruta o referencia del store}>`** — sin el valor (últimos 4 chars `…wXyZ` como evidencia si querés)
  - Una nota: "el secret quedó persistido; no lo voy a volver a imprimir".
- Si yo te pido explícitamente el valor completo (ej. para pegarlo en otra UI), recién ahí mostralo y avisame que queda en el transcript.

### 13. Login policy (idempotente)
- `get_login_policy(workspace="{workspace_slug}")`.
- Si ya tiene `allow_external_idp=true` y lo demás necesario está activo, **no la reescribas**.
- Si falta algo, llamá `update_login_policy` cambiando **solo** los campos pendientes.

### 14. Branding (idempotente)
- `get_branding(workspace="{workspace_slug}")`.
- Si `branding_primary_color_set` ya pasa el check, no toques.
- Si falta, llamá `update_branding` cambiando solo los campos faltantes. No sobrescribas el branding entero.

### 15. Wiring del repo
- Detectá el framework real (Next.js, FastAPI, Django, Express, Spring, etc.).
- Si el wiring OIDC ya existe (rutas de auth, middleware, callback handler), no lo dupliques.
- Strategy de secretos: preguntame **antes** de tocar archivos. Opciones comunes:
  - `.env.local` plano (gitignored) — default.
  - El secret store del proyecto (vault, secret manager, archivos cifrados).
- **Adaptá el wiring al sistema elegido**. Si hay store, NO escribas el `client_secret` plano en `.env.local`.
- Variables a setear (path/formato según strategy):
  ```
  PRYSMID_ISSUER=https://{auth_domain}
  PRYSMID_CLIENT_ID=<paso 12>
  PRYSMID_CLIENT_SECRET=<paso 12>
  PRYSMID_REDIRECT_URI=<primer redirect URI de paso 12>
  PRYSMID_POST_LOGOUT_URI=<si aplica>
  ```
- Si `.env.local` es la ruta: confirmá que está en `.gitignore`. Si no, agregálo con `# Prysm:ID — never commit secrets`.

### 16. Validación final
- Llamá `prysmid_setup_check(workspace="{workspace_slug}")` de nuevo.
- Objetivo: `verdict: ready`.
- Si quedan items en fail, mostrámelos con un fix concreto.
- Pedime probar login real:
  > Levantá tu app local. Click "Sign in with Prysm:ID" → redirige a `https://{auth_domain}/oauth/v2/authorize` → "Continue with Google" → autorizo → vuelvo a tu app logueado.

## Manejo de errores

Cuando una tool falla, leé el error completo antes de reintentar:

| Status | Acción |
|---|---|
| 401 | Token expirado o inválido. Verificá si el archivo de token existe; si sí, podés tener un token corrupto — borralo y volvé al paso 4. |
| 403 | Sin permiso. NO loopees; pedime contexto. |
| 404 | Slug/id incorrecto. Listá primero (`list_workspaces`, `list_apps`, etc.) y reintentá. |
| 409 | Recurso ya existe / conflicto. Reusá lo existente o renombrá. Esto es señal de que **deberías haber listado antes**. |
| 422 | Error de validación. El body JSON tiene los campos malos. Corregí solo esos. |
| 5xx | Error transitorio. Reintentá UNA vez. Si persiste, parámonos. |

Si el error ya ocurrió y fue resuelto en esta sesión, no repitas la misma acción.

## Reglas duras
- **No crear** un recurso que ya existe.
- **No reescribir** una config si ya coincide con el objetivo.
- **No volver a invitar** usuarios ya existentes.
- **No volver a agregar** un IdP activo ya presente.
- **No volver a crear** una app equivalente.
- **No volver a ejecutar** una prueba ya aprobada salvo que la config haya cambiado.
- **No volver a pedir** credenciales ya disponibles localmente.
- **No declarar `incomplete`** si el último check real ya dio `ready`.
- **No declares éxito** hasta que el MCP responda Y `prysmid_setup_check` retorne `verdict: ready`.

## Formato de salida
- Mostrame los comandos que ejecutaste.
- Mostrame el resultado útil de cada prueba.
- Si algo ya estaba configurado, decímelo explícitamente.
- Si algo se creó nuevo, decí qué recurso exacto.
- Si algo se reusó, decímelo.
- Si algo no se puede completar por falta de datos, pará y pedime solo lo mínimo que falta.

Listo. Empezá por el paso 1.
