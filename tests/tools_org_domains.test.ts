/**
 * Tests for P3a-4 — per-org domain MCP tools.
 *
 * Verify each tool hits the correct REST path/method and threads org_id
 * into the path segment (not as a query — domain endpoints encode org_id
 * in the path because they live under .../organizations/{org_id}/...).
 */
import { describe, it, expect, vi } from "vitest";

import type { PrysmidClient } from "../src/client.js";
import { makeLogger } from "../src/logger.js";
import {
  addOrganizationDomain,
  deleteOrganizationDomain,
  generateOrganizationDomainVerification,
  listOrganizationDomains,
  verifyOrganizationDomain,
} from "../src/tools/org_domains.js";

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

describe("list_organization_domains", () => {
  it("GETs /organizations/{org}/domains", async () => {
    const { client, calls } = recordingClient({ items: [], total: 0 });
    await listOrganizationDomains.handler(
      { workspace: "ws-1", org_id: "ORG-9" },
      ctx(client),
    );
    expect(calls[0]!.path).toBe(
      "/v1/workspaces/ws-1/organizations/ORG-9/domains",
    );
    expect(calls[0]!.method).toBe("GET");
  });
});

describe("add_organization_domain", () => {
  it("POSTs the domain in the body", async () => {
    const { client, calls } = recordingClient();
    await addOrganizationDomain.handler(
      { workspace: "ws-1", org_id: "ORG-9", domain: "acme.com" },
      ctx(client),
    );
    expect(calls[0]!).toMatchObject({
      path: "/v1/workspaces/ws-1/organizations/ORG-9/domains",
      method: "POST",
      body: { domain: "acme.com" },
    });
  });

  it("rejects upper-case domains at the schema level", () => {
    const parsed = addOrganizationDomain.inputShape.domain.safeParse("Acme.com");
    expect(parsed.success).toBe(false);
  });
});

describe("generate_organization_domain_verification", () => {
  it("defaults method to dns when not specified", async () => {
    const { client, calls } = recordingClient({
      token: "t-1",
      url: "_zitadel-challenge.acme.com",
      method: "dns",
    });
    await generateOrganizationDomainVerification.handler(
      { workspace: "ws-1", org_id: "ORG-9", domain: "acme.com", method: "dns" },
      ctx(client),
    );
    expect(calls[0]!).toMatchObject({
      path: "/v1/workspaces/ws-1/organizations/ORG-9/domains/acme.com/_generate_verification",
      method: "POST",
      body: { method: "dns" },
    });
  });

  it("forwards method=http", async () => {
    const { client, calls } = recordingClient();
    await generateOrganizationDomainVerification.handler(
      {
        workspace: "ws-1",
        org_id: "ORG-9",
        domain: "acme.com",
        method: "http",
      },
      ctx(client),
    );
    expect(calls[0]!.body).toEqual({ method: "http" });
  });
});

describe("verify_organization_domain", () => {
  it("POSTs to the _verify path", async () => {
    const { client, calls } = recordingClient();
    await verifyOrganizationDomain.handler(
      { workspace: "ws-1", org_id: "ORG-9", domain: "acme.com" },
      ctx(client),
    );
    expect(calls[0]!).toMatchObject({
      path: "/v1/workspaces/ws-1/organizations/ORG-9/domains/acme.com/_verify",
      method: "POST",
    });
  });
});

describe("delete_organization_domain", () => {
  it("DELETEs the domain", async () => {
    const { client, calls } = recordingClient();
    await deleteOrganizationDomain.handler(
      { workspace: "ws-1", org_id: "ORG-9", domain: "acme.com" },
      ctx(client),
    );
    expect(calls[0]!).toMatchObject({
      path: "/v1/workspaces/ws-1/organizations/ORG-9/domains/acme.com",
      method: "DELETE",
    });
  });
});
