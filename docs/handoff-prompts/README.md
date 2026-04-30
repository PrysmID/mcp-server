# Handoff prompts — dashboard → agent

Estos archivos son la **fuente de verdad** del prompt que el dashboard de
`app.prysmid.com` entrega al cliente justo después de crear su primer
workspace. El cliente lo copia, lo pega en su agente (Claude Code,
Antigravity, etc.) y desde ahí el agente termina el setup conversacional —
sin clicks, sin terminal commands manuales más allá del paste.

Vivir acá (junto al código del MCP que describen) garantiza que el prompt
y el surface de tools se versionan juntos: si agregamos una tool nueva o
cambiamos el flow del wizard, el prompt se actualiza en el mismo PR.

## Archivos

| Agente / IDE   | Idioma   | Archivo                        |
|----------------|----------|--------------------------------|
| Claude Code    | Español  | `claude-code.es.md`            |
| Claude Code    | English  | `claude-code.en.md`            |
| Antigravity    | Español  | `antigravity.es.md`            |
| Antigravity    | English  | `antigravity.en.md`            |

Cuando agreguemos soporte de prompt para otros hosts (Cursor, Continue,
Cline/Roo, Windsurf, OpenAI Codex, Gemini CLI, Aider, etc.), un par
`<host>.{es,en}.md` por cada uno.

## Variables interpoladas por el dashboard

El dashboard reemplaza estos placeholders antes de servir el prompt al
cliente. Los archivos en este directorio los conservan como `{var}` para
que el dashboard los pueda detectar y reemplazar fácilmente.

| Placeholder        | Ejemplo                                        | Notas                                                |
|--------------------|------------------------------------------------|------------------------------------------------------|
| `{display_name}`   | `Acme`                                         | Display name del workspace, tal como el cliente lo creó |
| `{workspace_slug}` | `acme`                                         | Slug del workspace                                   |
| `{auth_domain}`    | `acme.auth.prysmid.com`                        | Domain custom del tenant Zitadel                     |

Variables NO interpoladas (constantes — viven en la plantilla):

- `https://api.prysmid.com` — API base. Override solo para self-hosted via env var `PRYSMID_API_BASE`; no se documenta en el prompt para no agregar ruido al 99% de clientes SaaS.
- `https://auth.prysmid.com/device` — página de confirmación del device flow (servida por Zitadel native, no por el web app de Prysm:ID).
- `https://docs.prysmid.com/agents/quickstart-claude/` — link a docs.

## Convenciones de mantenimiento

- **ES y EN se sincronizan en el mismo commit.** Si modificás `claude-code.es.md`, modificá `claude-code.en.md` en el mismo PR. Idem para Antigravity.
- **Cambios al MCP que afectan el flujo** (nueva tool curated, breaking change en argumentos, paso nuevo en el setup) requieren update de los 4 prompts.
- **Cuando agreguemos providers además de Google** (GitHub, Microsoft, Apple), el paso "Configurar Google login" se vuelve "Configurar IdP" con sub-instrucciones por provider. El sub-paso 9.0 (decisión de proyecto/cuenta upstream) y el modelo mental de dos capas ya están escritos genéricos para que apliquen a cualquier provider — solo hay que agregar las URLs específicas del nuevo provider en el sub-paso 9.1.
- **Tono / estilo**: se mantiene el patrón de Blenau (instrucciones imperativas en primera persona del cliente al agente, "Reglas de oro" al final, "Al terminar" con próximos pasos concretos).
- **Secciones cross-cut** (presentes en los 4 archivos): step 5 con decision tree agente-vs-humano para device flow, step 6 con explicación del porqué del reinicio, modelo mental de 2 capas + decisión de proyecto upstream antes del IdP setup, sub-paso 11.0 de strategy de secretos, sección "Diagnóstico cuando una tool falla" antes de "Reglas de oro". Si tocás alguna, replicá los cambios en los 4 archivos.

## Para qué NO sirven estos archivos

- **No son docs públicas user-facing.** Las docs viven en `docs.prysmid.com/agents/`. Estos archivos son la plantilla operativa que el dashboard consume.
- **No reemplazan el quickstart en docs.** El quickstart en docs es la versión narrativa con explicaciones; estos prompts son la versión "ejecutable por agente", densos y prescriptivos.
- **No son specs del MCP.** Las specs viven en el código + OpenAPI. Estos prompts asumen que el MCP funciona; documentan cómo conectarlo + usarlo, no cómo está construido.

## Roadmap del feature

Este directorio existe porque P-008-A en `project_management/Pendientes_Producto/progreso.md` lo capturó. Cuando se gradúe a Fase, los deliverables incluyen:

1. Estos archivos completos y revisados (✅ v1 acá).
2. Endpoint `GET /v1/workspaces/{id}/handoff-prompt?host=claude-code&lang=es` que devuelve el prompt interpolado.
3. UI en el dashboard post-create con tabs por host + botón Copy + select de idioma.
4. Telemetría (P-007) que cuente cuántos clientes copian el prompt y cuántos lo ejecutan exitosamente.
