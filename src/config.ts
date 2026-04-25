/**
 * Runtime configuration. Pulled from env at startup; immutable thereafter.
 *
 * The MCP runs as a long-lived stdio process — env reads happen once.
 */

export interface Config {
  apiBase: string;
  apiToken: string | null;
  logLevel: "debug" | "info" | "warn" | "error";
}

const DEFAULT_API_BASE = "https://api.prysmid.com";

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const apiBase = (env.PRYSMID_API_BASE ?? DEFAULT_API_BASE).replace(/\/+$/, "");
  const apiToken = env.PRYSMID_API_TOKEN?.trim() || null;
  const rawLevel = (env.PRYSMID_MCP_LOG_LEVEL ?? "info").toLowerCase();
  const logLevel: Config["logLevel"] =
    rawLevel === "debug" || rawLevel === "warn" || rawLevel === "error"
      ? rawLevel
      : "info";
  return { apiBase, apiToken, logLevel };
}
