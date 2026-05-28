/**
 * Tests for P2e MCP surface — domain_auto_claim flag on update_organization
 * and the reconcile_organization_domain_claims tool.
 */
import { describe, it, expect, vi } from "vitest";

import type { PrysmidClient } from "../src/client.js";
import { makeLogger } from "../src/logger.js";
import {
  reconcileOrganizationDomainClaims,
  updateOrganization,
} from "../src/tools/organizations.js";

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

describe("update_organization — domain_auto_claim", () => {
  it("threads domain_auto_claim into the PATCH body", async () => {
    const { client, calls } = recordingClient({ id: "ORG-1" });
    await updateOrganization.handler(
      { workspace: "ws-1", org_id: "ORG-1", domain_auto_claim: true },
      ctx(client),
    );
    expect(calls[0]!.method).toBe("PATCH");
    expect(calls[0]!.body).toEqual({ domain_auto_claim: true });
  });
});

describe("reconcile_organization_domain_claims", () => {
  it("POSTs the reconcile endpoint", async () => {
    const { client, calls } = recordingClient({ granted: 2 });
    await reconcileOrganizationDomainClaims.handler(
      { workspace: "ws-1", org_id: "ORG-1" },
      ctx(client),
    );
    expect(calls[0]!).toMatchObject({
      path: "/v1/workspaces/ws-1/organizations/ORG-1/_reconcile-domain-claims",
      method: "POST",
    });
  });
});
