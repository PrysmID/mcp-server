/**
 * Tests for X4 — export_audit_log MCP tool.
 */
import { describe, it, expect, vi } from "vitest";

import type { PrysmidClient } from "../src/client.js";
import { makeLogger } from "../src/logger.js";
import { exportAuditLog } from "../src/tools/audit.js";

type Call = { path: string; method: string; query: unknown };

function recordingClient(response: unknown = ""): {
  client: PrysmidClient;
  calls: Call[];
} {
  const calls: Call[] = [];
  const client = {
    request: vi.fn(async (path: string, opts: Record<string, unknown> = {}) => {
      calls.push({
        path,
        method: (opts.method as string) ?? "GET",
        query: opts.query,
      });
      return response;
    }),
  } as unknown as PrysmidClient;
  return { client, calls };
}

const ctx = (client: PrysmidClient) => ({
  client,
  log: makeLogger({ logLevel: "error" }),
});

describe("export_audit_log", () => {
  it("GETs the export path with default ndjson format", async () => {
    const { client, calls } = recordingClient("");
    await exportAuditLog.handler(
      { workspace: "ws-1", format: "ndjson" },
      ctx(client),
    );
    expect(calls[0]!.path).toBe("/v1/workspaces/ws-1/audit-log/export");
    expect(calls[0]!.method).toBe("GET");
    expect(calls[0]!.query).toMatchObject({ format: "ndjson" });
  });

  it("threads all filters into the query", async () => {
    const { client, calls } = recordingClient("");
    await exportAuditLog.handler(
      {
        workspace: "ws-1",
        format: "csv",
        org_id: "ORG-9",
        action: "idp.create",
        start: "2026-05-01T00:00:00Z",
        end: "2026-06-01T00:00:00Z",
        limit: 500,
      },
      ctx(client),
    );
    expect(calls[0]!.query).toEqual({
      format: "csv",
      org_id: "ORG-9",
      action: "idp.create",
      start: "2026-05-01T00:00:00Z",
      end: "2026-06-01T00:00:00Z",
      limit: 500,
    });
    // workspace is in the path, never the query.
    expect((calls[0]!.query as Record<string, unknown>).workspace).toBeUndefined();
  });

  it("rejects an out-of-range limit", () => {
    expect(exportAuditLog.inputShape.limit.safeParse(99999).success).toBe(false);
    expect(exportAuditLog.inputShape.limit.safeParse(500).success).toBe(true);
  });
});
