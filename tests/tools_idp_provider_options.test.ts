/**
 * Tests for X6 — provider_options on add_idp / update_idp MCP tools.
 */
import { describe, it, expect, vi } from "vitest";

import type { PrysmidClient } from "../src/client.js";
import { makeLogger } from "../src/logger.js";
import { addIdp, updateIdp } from "../src/tools/idps.js";

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

describe("add_idp — provider_options", () => {
  it("passes provider_options through in the body unchanged (snake_case)", async () => {
    const { client, calls } = recordingClient({ id: "idp-1" });
    await addIdp.handler(
      {
        workspace: "ws-1",
        type: "google",
        name: "Google",
        client_id: "cid",
        client_secret: "sec",
        provider_options: {
          is_auto_creation: false,
          auto_linking: "email",
        },
      },
      ctx(client),
    );
    expect(calls[0]!.body).toMatchObject({
      type: "google",
      provider_options: {
        is_auto_creation: false,
        auto_linking: "email",
      },
    });
  });

  it("rejects unknown auto_linking values at the schema", () => {
    const parsed = addIdp.inputShape.provider_options.safeParse({
      auto_linking: "yolo",
    });
    expect(parsed.success).toBe(false);
  });

  it("omits provider_options from the body when not set", async () => {
    const { client, calls } = recordingClient({ id: "idp-1" });
    await addIdp.handler(
      {
        workspace: "ws-1",
        type: "google",
        name: "Google",
        client_id: "cid",
        client_secret: "sec",
      },
      ctx(client),
    );
    expect(
      (calls[0]!.body as Record<string, unknown>).provider_options,
    ).toBeUndefined();
  });
});

describe("update_idp — provider_options", () => {
  it("forwards a partial provider_options patch", async () => {
    const { client, calls } = recordingClient();
    await updateIdp.handler(
      {
        workspace: "ws-1",
        idp_id: "idp-1",
        provider_options: { is_auto_creation: false },
      },
      ctx(client),
    );
    expect(calls[0]!.method).toBe("PATCH");
    expect(calls[0]!.body).toEqual({
      provider_options: { is_auto_creation: false },
    });
  });
});
