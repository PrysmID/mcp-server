import { describe, expect, it, vi } from "vitest";

import type { PrysmidClient } from "../src/client.js";
import { makeLogger } from "../src/logger.js";
import { setupPrysmidWorkspace } from "../src/tools/curated.js";

function fakeClient(
  responses: Array<unknown | ((path: string) => unknown)>,
): PrysmidClient {
  const queue = [...responses];
  return {
    async request(path: string) {
      const next = queue.shift();
      if (next === undefined) throw new Error(`unexpected call to ${path}`);
      if (typeof next === "function") return (next as (p: string) => unknown)(path);
      return next;
    },
  } as unknown as PrysmidClient;
}

describe("setup_prysmid_workspace", () => {
  it("polls until state=active and returns auth_domain", async () => {
    vi.useFakeTimers();
    const ctx = {
      client: fakeClient([
        { id: "ws-1", slug: "acme", state: "provisioning" }, // POST create
        { id: "ws-1", slug: "acme", state: "provisioning" },
        { id: "ws-1", slug: "acme", state: "active", auth_domain: "auth.acme.prysmid.com" },
      ]),
      log: makeLogger({ logLevel: "error" }),
    };

    const promise = setupPrysmidWorkspace.handler(
      { slug: "acme", display_name: "Acme", timeout_seconds: 30 },
      ctx,
    );
    await vi.advanceTimersByTimeAsync(10_000);
    const out = await promise;
    expect(out).toMatchObject({
      workspace_id: "ws-1",
      slug: "acme",
      auth_domain: "auth.acme.prysmid.com",
      state: "active",
    });
    vi.useRealTimers();
  });

  it("throws on provisioning_failed", async () => {
    vi.useFakeTimers();
    const ctx = {
      client: fakeClient([
        { id: "ws-2", slug: "fail", state: "provisioning" },
        {
          id: "ws-2",
          slug: "fail",
          state: "provisioning_failed",
          provisioning_error: "Cloudflare DNS rejected",
        },
      ]),
      log: makeLogger({ logLevel: "error" }),
    };
    const promise = setupPrysmidWorkspace.handler(
      { slug: "fail", display_name: "Fail Co", timeout_seconds: 30 },
      ctx,
    );
    const assertion = expect(promise).rejects.toThrow(/Cloudflare DNS/);
    await vi.advanceTimersByTimeAsync(5_000);
    await assertion;
    vi.useRealTimers();
  });
});
