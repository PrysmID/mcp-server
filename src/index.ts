/**
 * Entrypoint — boots an MCP server over stdio with the full Prysmid tool set.
 *
 * Three layers of tools:
 *   1. handwritten — `src/tools/{apps,users,...}.ts`. Polished schemas,
 *      curated descriptions, the canonical surface.
 *   2. curated — `src/tools/curated.ts`. Multi-step orchestrators (e.g.
 *      `setup_prysmid_workspace`).
 *   3. generated — `src/tools/generated/*.ts`. Auto-emitted from the live
 *      OpenAPI spec by `scripts/generate-tools.ts`. Covers everything else.
 *
 * Merge rule: handwritten and curated names always win. A generated tool
 * with the same `name` as one of them is dropped silently — the handwritten
 * version is the source of truth.
 *
 * MCP transport contract:
 *   - JSON-RPC over stdin/stdout
 *   - stdout is RESERVED for protocol bytes; logs go to stderr (see logger.ts)
 *   - one process == one client; the agent spawns a fresh server per session
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { deviceFlow } from "./auth.js";
import { PrysmidClient } from "./client.js";
import { loadConfig, type Config } from "./config.js";
import { makeLogger, type Logger } from "./logger.js";
import { clearToken, loadToken, saveToken } from "./tokenStore.js";
import { registerAll, type ToolDef } from "./tools/registry.js";
import { tools as appsTools } from "./tools/apps.js";
import { tools as billingTools } from "./tools/billing.js";
import { tools as brandingTools } from "./tools/branding.js";
import { tools as curatedTools } from "./tools/curated.js";
import { tools as idpsTools } from "./tools/idps.js";
import { tools as loginPolicyTools } from "./tools/login_policy.js";
import { tools as usersTools } from "./tools/users.js";
import { tools as workspaceTools } from "./tools/workspaces.js";
import { generatedTools } from "./tools/generated/index.js";

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const SERVER_NAME = "prysmid";

function readVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(
      readFileSync(resolve(here, "..", "package.json"), "utf8"),
    );
    return typeof pkg.version === "string" ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/**
 * Map of generated tool names that are superseded by a hand-written tool
 * with a different name (because the hand-written name is more agent-
 * friendly than what FastAPI's operationId produced). Without this, the
 * agent would see two near-duplicates: e.g. `add_idp` (curated) AND
 * `create_idp` (generated) for the same endpoint.
 *
 * Keep the LHS in sync with what the generator emits — if you rename a
 * hand-written tool, update this table.
 */
const GENERATED_ALIASES: Readonly<Record<string, string>> = {
  // generated name → handwritten that already covers it
  create_idp: "add_idp",
  create_app: "create_oidc_app",
  delete_app: "delete_oidc_app",
  update_spending_cap: "set_spending_cap",
  billing_checkout: "start_billing_checkout",
  billing_portal: "start_billing_portal",
  billing_get_state: "get_billing",
};

/**
 * Compose the final tool array. Hand-written + curated tools take
 * precedence over generated tools sharing the same `name`, AND over any
 * generated tool listed in {@link GENERATED_ALIASES}. Exported so tests
 * can assert merge behavior without booting the MCP server.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function composeToolset(): ToolDef<any>[] {
  const handwrittenAndCurated = [
    ...workspaceTools,
    ...appsTools,
    ...idpsTools,
    ...loginPolicyTools,
    ...usersTools,
    ...brandingTools,
    ...billingTools,
    ...curatedTools,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ] as ToolDef<any>[];

  const handwrittenNames = new Set(handwrittenAndCurated.map((t) => t.name));
  const filteredGenerated = generatedTools.filter((t) => {
    if (handwrittenNames.has(t.name)) return false;
    const alias = GENERATED_ALIASES[t.name];
    if (alias && handwrittenNames.has(alias)) return false;
    return true;
  });

  return [...handwrittenAndCurated, ...filteredGenerated];
}

/**
 * Resolve the bearer token to use for API calls. Resolution order:
 *   1. PRYSMID_API_TOKEN env var (CI / static service tokens)
 *   2. Cached device-flow token at ~/.config/prysmid-mcp/token.json (or %APPDATA% on Windows)
 *   3. Run interactive device flow (browser + user code) and save to cache
 *
 * Returns the token plus the human-readable mode string for logs.
 */
export async function resolveAuth(
  cfg: Config,
  log: Logger,
): Promise<{ token: string | null; mode: "bearer" | "cached" | "deviceflow" | "none" }> {
  if (cfg.apiToken) return { token: cfg.apiToken, mode: "bearer" };

  const cached = loadToken(cfg.apiBase);
  if (cached) return { token: cached.accessToken, mode: "cached" };

  if (!process.stderr.isTTY && !process.env.PRYSMID_FORCE_DEVICE_FLOW) {
    log.warn(
      "no PRYSMID_API_TOKEN and no cached token; stderr is not a TTY so refusing to start interactive device flow. Set PRYSMID_API_TOKEN, run `npx -y @prysmid/mcp` once interactively to populate the cache, or set PRYSMID_FORCE_DEVICE_FLOW=1 to override.",
    );
    return { token: null, mode: "none" };
  }

  let result;
  try {
    result = await deviceFlow({ apiBase: cfg.apiBase, log });
  } catch (err) {
    log.error("device flow login failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    clearToken();
    return { token: null, mode: "none" };
  }

  const expiresAt =
    Math.floor(Date.now() / 1000) + (result.expiresIn ?? 3600);
  saveToken({
    apiBase: cfg.apiBase,
    accessToken: result.accessToken,
    refreshToken: result.refreshToken,
    expiresAt,
  });
  return { token: result.accessToken, mode: "deviceflow" };
}

export async function main(): Promise<void> {
  // `prysmid-mcp logout` — small subcommand that just clears the cache.
  if (process.argv[2] === "logout") {
    clearToken();
    process.stderr.write("prysmid-mcp: logged out (token cache cleared)\n");
    return;
  }

  const cfg = loadConfig();
  const log = makeLogger(cfg);
  const auth = await resolveAuth(cfg, log);
  const client = new PrysmidClient(cfg, log, auth.token);

  const server = new McpServer({
    name: SERVER_NAME,
    version: readVersion(),
  });

  const allTools = composeToolset();

  registerAll(server, { client, log }, allTools);

  log.info(`prysmid-mcp starting`, {
    apiBase: cfg.apiBase,
    tools: allTools.length,
    authMode: auth.mode,
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// This module is only ever invoked as the package bin (MCP servers run as a
// process per session). Cross-platform `import.meta.url === file://<argv[1]>`
// is fragile (Windows backslash vs forward slash; symlinked paths) so we
// just always boot UNLESS we're in vitest (which imports this module to
// poke at the exports without wanting to connect a stdio transport).
if (!process.env.VITEST) {
  main().catch((err) => {
    process.stderr.write(`fatal: ${err instanceof Error ? err.stack : err}\n`);
    process.exit(1);
  });
}
