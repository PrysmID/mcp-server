/**
 * Entrypoint — boots an MCP server over stdio with the full Prysmid tool set.
 *
 * MCP transport contract:
 *   - JSON-RPC over stdin/stdout
 *   - stdout is RESERVED for protocol bytes; logs go to stderr (see logger.ts)
 *   - one process == one client; the agent spawns a fresh server per session
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { PrysmidClient } from "./client.js";
import { loadConfig } from "./config.js";
import { makeLogger } from "./logger.js";
import { registerAll } from "./tools/registry.js";
import { tools as curatedTools } from "./tools/curated.js";
import { tools as workspaceTools } from "./tools/workspaces.js";

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

export async function main(): Promise<void> {
  const cfg = loadConfig();
  const log = makeLogger(cfg);
  const client = new PrysmidClient(cfg, log);

  const server = new McpServer({
    name: SERVER_NAME,
    version: readVersion(),
  });

  const allTools = [...workspaceTools, ...curatedTools];

  registerAll(server, { client, log }, allTools);

  log.info(`prysmid-mcp starting`, {
    apiBase: cfg.apiBase,
    tools: allTools.length,
    authMode: cfg.apiToken ? "bearer" : "none",
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    process.stderr.write(`fatal: ${err instanceof Error ? err.stack : err}\n`);
    process.exit(1);
  });
}
