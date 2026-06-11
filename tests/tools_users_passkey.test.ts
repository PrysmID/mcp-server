/**
 * Tests for start_user_passkey — slice (a) of the passkey enrollment epic.
 * Email delivery is the safe default; the raw link is a bearer credential
 * and must be requested explicitly.
 */
import { describe, it, expect, vi } from "vitest";

import type { PrysmidClient } from "../src/client.js";
import { makeLogger } from "../src/logger.js";
import { startUserPasskey } from "../src/tools/users.js";

type Call = { path: string; method: string; body: unknown };

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

describe("start_user_passkey", () => {
  it("POSTs the passwordless path with email delivery", async () => {
    const { client, calls } = recordingClient({ sent: true });
    await startUserPasskey.handler(
      { workspace: "blenau", user_id: "u-1", delivery: "email" },
      ctx(client),
    );
    expect(calls[0]!.path).toBe("/v1/workspaces/blenau/users/u-1/passwordless");
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.body).toEqual({ delivery: "email" });
  });

  it("defaults delivery to email at the schema level", () => {
    const parsed = startUserPasskey.inputShape.delivery.parse(undefined);
    expect(parsed).toBe("email");
  });

  it("passes link delivery through only when explicitly requested", async () => {
    const { client, calls } = recordingClient({ link: "https://x/ui/login/l" });
    await startUserPasskey.handler(
      { workspace: "blenau", user_id: "u-1", delivery: "link" },
      ctx(client),
    );
    expect(calls[0]!.body).toEqual({ delivery: "link" });
  });

  it("rejects unknown delivery values", () => {
    expect(
      startUserPasskey.inputShape.delivery.safeParse("carrier-pigeon").success,
    ).toBe(false);
  });

  it("URL-encodes workspace and user id", async () => {
    const { client, calls } = recordingClient({});
    await startUserPasskey.handler(
      { workspace: "a b", user_id: "u/1", delivery: "email" },
      ctx(client),
    );
    expect(calls[0]!.path).toBe(
      "/v1/workspaces/a%20b/users/u%2F1/passwordless",
    );
  });

  it("marks the raw link as sensitive in the tool description", () => {
    expect(startUserPasskey.description).toMatch(/BEARER CREDENTIAL/);
    expect(startUserPasskey.description).toMatch(/never print or log/);
  });
});
