/**
 * Tests for X3 — service account MCP tools + per-org scoping.
 */
import { describe, it, expect, vi } from "vitest";

import type { PrysmidClient } from "../src/client.js";
import { makeLogger } from "../src/logger.js";
import {
  createServiceAccount,
  deleteServiceAccount,
  listServiceAccounts,
} from "../src/tools/service_accounts.js";

type Call = { path: string; method: string; body: unknown; query: unknown };

function recordingClient(response: unknown = {}): {
  client: PrysmidClient;
  calls: Call[];
} {
  const calls: Call[] = [];
  const client = {
    request: vi.fn(async (path: string, opts: Record<string, unknown> = {}) => {
      calls.push({
        path,
        method: (opts.method as string) ?? "GET",
        body: opts.body,
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

describe("list_service_accounts", () => {
  it("GETs with org_id query", async () => {
    const { client, calls } = recordingClient({ items: [], total: 0 });
    await listServiceAccounts.handler(
      { workspace: "ws-1", org_id: "ORG-9" },
      ctx(client),
    );
    expect(calls[0]!.path).toBe("/v1/workspaces/ws-1/service-accounts");
    expect(calls[0]!.query).toEqual({ org_id: "ORG-9" });
  });
});

describe("create_service_account", () => {
  it("POSTs body and threads org_id, omitting org_id from body", async () => {
    const { client, calls } = recordingClient({ id: "sa-1" });
    await createServiceAccount.handler(
      {
        workspace: "ws-1",
        org_id: "ORG-9",
        user_name: "etl-bot",
        name: "ETL Bot",
      },
      ctx(client),
    );
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.query).toEqual({ org_id: "ORG-9" });
    expect(calls[0]!.body).toEqual({ user_name: "etl-bot", name: "ETL Bot" });
    expect((calls[0]!.body as Record<string, unknown>).org_id).toBeUndefined();
  });

  it("rejects invalid user_name at the schema", () => {
    const parsed = createServiceAccount.inputShape.user_name.safeParse(
      "1-starts-with-digit",
    );
    expect(parsed.success).toBe(false);
  });
});

describe("delete_service_account", () => {
  it("DELETEs with org_id", async () => {
    const { client, calls } = recordingClient();
    await deleteServiceAccount.handler(
      { workspace: "ws-1", org_id: "ORG-9", service_account_id: "sa-1" },
      ctx(client),
    );
    expect(calls[0]!.method).toBe("DELETE");
    expect(calls[0]!.path).toBe("/v1/workspaces/ws-1/service-accounts/sa-1");
    expect(calls[0]!.query).toEqual({ org_id: "ORG-9" });
  });
});
