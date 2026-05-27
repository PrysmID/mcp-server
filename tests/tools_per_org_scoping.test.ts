/**
 * Tests for P3a-4 — per-org scoping on handwritten idps + login_policy tools.
 *
 * Verify the optional `org_id` argument flows through as a `?org_id=` query
 * param when provided, and that the param is undefined (omitted) otherwise.
 * Server-side, `undefined` query values are dropped by client.ts so an
 * omitted org_id never appears on the wire.
 */
import { describe, it, expect, vi } from "vitest";

import type { PrysmidClient } from "../src/client.js";
import { makeLogger } from "../src/logger.js";
import {
  addIdp,
  deleteIdp,
  getIdp,
  listIdps,
  probeIdp,
  updateIdp,
} from "../src/tools/idps.js";
import {
  getLoginPolicy,
  updateLoginPolicy,
} from "../src/tools/login_policy.js";

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

describe("idps tools — org_id propagation", () => {
  it("list_idps with org_id sets the query", async () => {
    const { client, calls } = recordingClient({ items: [], total: 0 });
    await listIdps.handler(
      { workspace: "ws-1", org_id: "ORG-9" },
      ctx(client),
    );
    expect(calls[0]!.query).toEqual({ org_id: "ORG-9" });
  });

  it("list_idps without org_id leaves the query undefined", async () => {
    const { client, calls } = recordingClient({ items: [], total: 0 });
    await listIdps.handler({ workspace: "ws-1" }, ctx(client));
    expect(calls[0]!.query).toEqual({ org_id: undefined });
  });

  it("add_idp forwards org_id and does not include it in the body", async () => {
    const { client, calls } = recordingClient({ id: "idp-1" });
    await addIdp.handler(
      {
        workspace: "ws-1",
        org_id: "ORG-9",
        type: "google",
        name: "Google",
        client_id: "cid",
        client_secret: "sec",
      },
      ctx(client),
    );
    expect(calls[0]!.query).toEqual({ org_id: "ORG-9" });
    expect(calls[0]!.body).toMatchObject({ type: "google", name: "Google" });
    expect((calls[0]!.body as Record<string, unknown>).org_id).toBeUndefined();
  });

  it.each([
    ["get_idp", getIdp, "GET"],
    ["delete_idp", deleteIdp, "DELETE"],
  ])("%s forwards org_id", async (_name, tool, method) => {
    const { client, calls } = recordingClient();
    await tool.handler(
      { workspace: "ws-1", org_id: "ORG-9", idp_id: "idp-1" },
      ctx(client),
    );
    expect(calls[0]!.method).toBe(method);
    expect(calls[0]!.query).toEqual({ org_id: "ORG-9" });
  });

  it("update_idp forwards org_id and patch body", async () => {
    const { client, calls } = recordingClient();
    await updateIdp.handler(
      {
        workspace: "ws-1",
        org_id: "ORG-9",
        idp_id: "idp-1",
        client_secret: "new-secret",
      },
      ctx(client),
    );
    expect(calls[0]!.query).toEqual({ org_id: "ORG-9" });
    expect(calls[0]!.body).toEqual({ client_secret: "new-secret" });
  });

  it("probe_idp forwards org_id", async () => {
    const { client, calls } = recordingClient();
    await probeIdp.handler(
      { workspace: "ws-1", org_id: "ORG-9", idp_id: "idp-1" },
      ctx(client),
    );
    expect(calls[0]!.path).toBe("/v1/workspaces/ws-1/idps/idp-1/probe");
    expect(calls[0]!.query).toEqual({ org_id: "ORG-9" });
  });
});

describe("login_policy tools — org_id + allow_domain_discovery", () => {
  it("get_login_policy with org_id", async () => {
    const { client, calls } = recordingClient({});
    await getLoginPolicy.handler(
      { workspace: "ws-1", org_id: "ORG-9" },
      ctx(client),
    );
    expect(calls[0]!).toMatchObject({
      path: "/v1/workspaces/ws-1/login-policy",
      method: "GET",
      query: { org_id: "ORG-9" },
    });
  });

  it("update_login_policy threads allow_domain_discovery + org_id", async () => {
    const { client, calls } = recordingClient({});
    await updateLoginPolicy.handler(
      {
        workspace: "ws-1",
        org_id: "ORG-9",
        allow_domain_discovery: true,
        force_mfa: true,
      },
      ctx(client),
    );
    expect(calls[0]!).toMatchObject({
      path: "/v1/workspaces/ws-1/login-policy",
      method: "PATCH",
      query: { org_id: "ORG-9" },
    });
    expect(calls[0]!.body).toEqual({
      allow_domain_discovery: true,
      force_mfa: true,
    });
    expect((calls[0]!.body as Record<string, unknown>).org_id).toBeUndefined();
  });

  it("update_login_policy second_factors enum validates", () => {
    const parsed = updateLoginPolicy.inputShape.second_factors.safeParse([
      "otp",
      "u2f",
    ]);
    expect(parsed.success).toBe(true);
    const bad = updateLoginPolicy.inputShape.second_factors.safeParse([
      "yubikey",
    ]);
    expect(bad.success).toBe(false);
  });
});
