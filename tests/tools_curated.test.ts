import { describe, expect, it, vi } from "vitest";

import type { PrysmidClient } from "../src/client.js";
import { makeLogger } from "../src/logger.js";
import {
  enableGoogleLogin,
  setupPrysmidWorkspace,
} from "../src/tools/curated.js";

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

describe("enable_google_login", () => {
  function recordingClient(
    responses: unknown[],
  ): {
    client: PrysmidClient;
    calls: Array<{ path: string; method?: string; body?: unknown }>;
  } {
    const queue = [...responses];
    const calls: Array<{ path: string; method?: string; body?: unknown }> = [];
    const client = {
      async request(path: string, opts?: { method?: string; body?: unknown }) {
        calls.push({ path, method: opts?.method, body: opts?.body });
        const next = queue.shift();
        if (next === undefined) throw new Error(`unexpected call to ${path}`);
        return next;
      },
    } as unknown as PrysmidClient;
    return { client, calls };
  }

  it("sends discriminated-union body matching IdpCreate schema (Bug #6 regression)", async () => {
    const { client, calls } = recordingClient([
      { id: "idp-1" },     // POST /idps
      { ok: true },        // PATCH /login-policy
    ]);
    await enableGoogleLogin.handler(
      {
        workspace: "acme",
        google_client_id: "client.example",
        google_client_secret: "shh",
        name: "Google",
      },
      { client, log: makeLogger({ logLevel: "error" }) },
    );

    const idpCreate = calls.find((c) => c.path.endsWith("/idps"));
    expect(idpCreate).toBeDefined();
    expect(idpCreate!.method).toBe("POST");
    // Backend (app/schemas/idp.py:IdpCreate) requires:
    //   * `type` field (NOT `provider`)
    //   * `client_id` and `client_secret` flat at top-level (NOT nested under
    //     a `config` object)
    // Sending the wrong shape made the API 422 before any handler ran. This
    // assertion pins the exact contract so any future drift breaks the test
    // instead of the production flow.
    expect(idpCreate!.body).toEqual({
      type: "google",
      name: "Google",
      client_id: "client.example",
      client_secret: "shh",
    });
    const body = idpCreate!.body as Record<string, unknown>;
    expect(body).not.toHaveProperty("provider");
    expect(body).not.toHaveProperty("config");
  });

  it("force-enables allow_external_idp on the login policy after IdP create", async () => {
    const { client, calls } = recordingClient([
      { id: "idp-1" },
      { ok: true },
    ]);
    await enableGoogleLogin.handler(
      {
        workspace: "acme",
        google_client_id: "x",
        google_client_secret: "y",
        name: "Google",
      },
      { client, log: makeLogger({ logLevel: "error" }) },
    );
    const policyPatch = calls.find((c) => c.path.endsWith("/login-policy"));
    expect(policyPatch).toBeDefined();
    expect(policyPatch!.method).toBe("PATCH");
    expect(policyPatch!.body).toEqual({ allow_external_idp: true });
  });
});
