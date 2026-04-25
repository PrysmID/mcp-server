/**
 * stderr-only logger. MCP servers MUST NOT write to stdout — that channel
 * is reserved for the JSON-RPC protocol; any stray byte breaks the agent.
 */
import type { Config } from "./config.js";

const ORDER = { debug: 10, info: 20, warn: 30, error: 40 } as const;

export interface Logger {
  debug: (msg: string, extra?: unknown) => void;
  info: (msg: string, extra?: unknown) => void;
  warn: (msg: string, extra?: unknown) => void;
  error: (msg: string, extra?: unknown) => void;
}

export function makeLogger(cfg: Pick<Config, "logLevel">): Logger {
  const threshold = ORDER[cfg.logLevel];

  function emit(level: keyof typeof ORDER, msg: string, extra?: unknown) {
    if (ORDER[level] < threshold) return;
    const ts = new Date().toISOString();
    const payload = extra === undefined ? "" : ` ${safeJSON(extra)}`;
    process.stderr.write(`${ts} ${level.toUpperCase()} ${msg}${payload}\n`);
  }

  return {
    debug: (m, e) => emit("debug", m, e),
    info: (m, e) => emit("info", m, e),
    warn: (m, e) => emit("warn", m, e),
    error: (m, e) => emit("error", m, e),
  };
}

function safeJSON(x: unknown): string {
  try {
    return JSON.stringify(x);
  } catch {
    return String(x);
  }
}
