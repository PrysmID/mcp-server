import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PrysmidApiError, PrysmidClient } from "../src/client.js";
import { loadConfig } from "../src/config.js";
import { makeLogger } from "../src/logger.js";

function client(overrides: Partial<NodeJS.ProcessEnv> = {}) {
  const cfg = loadConfig({
    PRYSMID_API_BASE: "https://api.test.local",
    PRYSMID_API_TOKEN: "tkn_xyz",
    ...overrides,
  });
  const log = makeLogger({ logLevel: "error" });
  return new PrysmidClient(cfg, log);
}

beforeEach(() => {
  vi.spyOn(global, "fetch");
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("PrysmidClient", () => {
  it("sends bearer header and json body", async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );

    const c = client();
    const out = await c.request("/v1/workspaces", {
      method: "POST",
      body: { slug: "acme", display_name: "Acme" },
    });

    expect(out).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("https://api.test.local/v1/workspaces");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer tkn_xyz");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(init.body).toBe(JSON.stringify({ slug: "acme", display_name: "Acme" }));
  });

  it("appends query params and skips undefined ones", async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify([]), { status: 200 }),
    );

    const c = client();
    await c.request("/v1/workspaces", {
      query: { limit: 10, after: undefined, active: true },
    });

    const [url] = fetchMock.mock.calls[0]!;
    const u = new URL(String(url));
    expect(u.searchParams.get("limit")).toBe("10");
    expect(u.searchParams.has("after")).toBe(false);
    expect(u.searchParams.get("active")).toBe("true");
  });

  it("throws PrysmidApiError on 4xx and surfaces error code", async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: "plan.upgrade_required", message: "..." }),
        { status: 402 },
      ),
    );

    const c = client();
    await expect(c.request("/v1/idps")).rejects.toMatchObject({
      name: "PrysmidApiError",
      status: 402,
      code: "plan.upgrade_required",
    });
  });

  it("rejects without a token", async () => {
    const c = client({ PRYSMID_API_TOKEN: "" });
    await expect(c.request("/v1/workspaces")).rejects.toBeInstanceOf(
      PrysmidApiError,
    );
  });

  it("returns text when response is not JSON", async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(new Response("ok", { status: 200 }));
    const c = client();
    const out = await c.request<string>("/healthz");
    expect(out).toBe("ok");
  });

  it("returns undefined for empty 204 responses", async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce(new Response("", { status: 204 }));
    const c = client();
    const out = await c.request("/v1/workspaces/abc", { method: "DELETE" });
    expect(out).toBeUndefined();
  });
});
