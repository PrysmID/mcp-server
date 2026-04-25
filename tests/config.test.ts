import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("uses defaults when env is empty", () => {
    const cfg = loadConfig({});
    expect(cfg.apiBase).toBe("https://api.prysmid.com");
    expect(cfg.apiToken).toBeNull();
    expect(cfg.logLevel).toBe("info");
  });

  it("trims trailing slashes off the api base", () => {
    const cfg = loadConfig({ PRYSMID_API_BASE: "https://api.example.com///" });
    expect(cfg.apiBase).toBe("https://api.example.com");
  });

  it("treats whitespace-only token as null", () => {
    const cfg = loadConfig({ PRYSMID_API_TOKEN: "   " });
    expect(cfg.apiToken).toBeNull();
  });

  it("clamps unknown log levels to info", () => {
    const cfg = loadConfig({ PRYSMID_MCP_LOG_LEVEL: "verbose" });
    expect(cfg.logLevel).toBe("info");
  });

  it("accepts debug/warn/error", () => {
    expect(loadConfig({ PRYSMID_MCP_LOG_LEVEL: "DEBUG" }).logLevel).toBe(
      "debug",
    );
    expect(loadConfig({ PRYSMID_MCP_LOG_LEVEL: "warn" }).logLevel).toBe(
      "warn",
    );
    expect(loadConfig({ PRYSMID_MCP_LOG_LEVEL: "ERROR" }).logLevel).toBe(
      "error",
    );
  });
});
