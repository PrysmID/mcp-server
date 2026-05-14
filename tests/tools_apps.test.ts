import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PrysmidClient } from "../src/client.js";
import { loadConfig } from "../src/config.js";
import { makeLogger } from "../src/logger.js";
import {
  createOidcApp,
  getApp,
  regenerateAppSecret,
  updateApp,
} from "../src/tools/apps.js";
import { addIdp, getIdp, updateIdp } from "../src/tools/idps.js";
import { inviteUser } from "../src/tools/users.js";

function client() {
  const cfg = loadConfig({
    PRYSMID_API_BASE: "https://api.test.local",
    PRYSMID_API_TOKEN: "tkn",
  });
  return new PrysmidClient(cfg, makeLogger({ logLevel: "error" }));
}

beforeEach(() => {
  vi.spyOn(global, "fetch");
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("create_oidc_app tool", () => {
  it("posts the short app_type value the API expects, never the Zitadel-internal enum", async () => {
    // Regression: the API (app/schemas/app.py:AppType) accepts only "web" |
    // "spa" | "native" and derives auth_method internally. Sending the long
    // OIDC_APP_TYPE_* / OIDC_AUTH_METHOD_TYPE_* wire values made every call
    // 422.
    const mock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    mock.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "app-1", clientId: "c-1" }), {
        status: 201,
      }),
    );

    const out = await createOidcApp.handler(
      {
        workspace: "acme",
        name: "MyApp",
        redirect_uris: ["https://app.test/cb"],
        app_type: "web",
        dev_mode: false,
      },
      { client: client(), log: makeLogger({ logLevel: "error" }) },
    );
    expect(out).toEqual({ id: "app-1", clientId: "c-1" });
    const [, init] = mock.mock.calls[0]!;
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body.workspace).toBeUndefined(); // workspace is in path, not body
    expect(body.name).toBe("MyApp");
    expect(body.redirect_uris).toEqual(["https://app.test/cb"]);
    expect(body.app_type).toBe("web");
    expect(body).not.toHaveProperty("auth_method");
  });
});

describe("add_idp tool", () => {
  it("forwards the discriminated-union body shape that IdpCreate expects", async () => {
    // The backend (app/schemas/idp.py:IdpCreate) discriminates on `type` and
    // takes client_id/client_secret as flat top-level fields. The previous
    // shape (`provider` + nested `config`) made every call 422 (Bug #6).
    const mock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    mock.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "idp-1" }), { status: 201 }),
    );

    await addIdp.handler(
      {
        workspace: "acme",
        type: "google",
        name: "Google",
        client_id: "g-id",
        client_secret: "g-secret",
      },
      { client: client(), log: makeLogger({ logLevel: "error" }) },
    );
    const [, init] = mock.mock.calls[0]!;
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      type: "google",
      name: "Google",
      client_id: "g-id",
      client_secret: "g-secret",
    });
    expect(body).not.toHaveProperty("provider");
    expect(body).not.toHaveProperty("config");
  });
});

describe("get_app tool", () => {
  it("GETs the per-app endpoint and returns the body verbatim", async () => {
    const mock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    const body = {
      id: "app-1",
      name: "MyApp",
      client_id: "c-1",
      app_type: "web",
      redirect_uris: ["https://app.test/cb"],
      post_logout_redirect_uris: [],
      grant_types: ["authorization_code", "refresh_token"],
      auth_method: "client_secret_basic",
      dev_mode: false,
    };
    mock.mockResolvedValueOnce(
      new Response(JSON.stringify(body), { status: 200 }),
    );

    const out = await getApp.handler(
      { workspace: "acme", app_id: "app-1" },
      { client: client(), log: makeLogger({ logLevel: "error" }) },
    );
    expect(out).toEqual(body);
    const [url, init] = mock.mock.calls[0]!;
    expect(String(url)).toContain("/v1/workspaces/acme/apps/app-1");
    // Default fetch method is GET — registered tools never send a body for GET.
    expect(init?.method ?? "GET").toBe("GET");
    expect(init?.body).toBeUndefined();
  });
});

describe("update_app tool", () => {
  it("PATCHes only the provided fields, never includes app_id/workspace in body", async () => {
    const mock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    mock.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "app-1" }), { status: 200 }),
    );

    await updateApp.handler(
      {
        workspace: "acme",
        app_id: "app-1",
        redirect_uris: ["https://app.test/cb2"],
        dev_mode: true,
      },
      { client: client(), log: makeLogger({ logLevel: "error" }) },
    );
    const [url, init] = mock.mock.calls[0]!;
    expect(String(url)).toContain("/v1/workspaces/acme/apps/app-1");
    expect(init.method).toBe("PATCH");
    const sent = JSON.parse(init.body as string);
    expect(sent).toEqual({
      redirect_uris: ["https://app.test/cb2"],
      dev_mode: true,
    });
    expect(sent).not.toHaveProperty("workspace");
    expect(sent).not.toHaveProperty("app_id");
    // client_secret is forbidden on this endpoint — we don't surface it in the
    // schema at all, so the agent literally cannot send it through this tool.
    expect(sent).not.toHaveProperty("client_secret");
  });
});

describe("regenerate_app_secret tool", () => {
  it("POSTs to /regenerate-secret and returns the rotated payload", async () => {
    const mock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    mock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: "app-1",
          client_id: "c-1",
          client_secret: "newplaintext",
          rotated_at: "2026-01-01T00:00:00Z",
        }),
        { status: 200 },
      ),
    );

    const out = await regenerateAppSecret.handler(
      { workspace: "acme", app_id: "app-1", confirm: true },
      { client: client(), log: makeLogger({ logLevel: "error" }) },
    );
    // @ts-expect-error narrow at runtime
    expect(out.client_secret).toBe("newplaintext");
    const [url, init] = mock.mock.calls[0]!;
    expect(String(url)).toContain(
      "/v1/workspaces/acme/apps/app-1/regenerate-secret",
    );
    expect(init.method).toBe("POST");
    expect(init.body).toBeUndefined();
  });

  it("refuses to hit the network when confirm is not true", async () => {
    const mock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    await expect(
      regenerateAppSecret.handler(
        // @ts-expect-error — exercising runtime guard with literal-false
        { workspace: "acme", app_id: "app-1", confirm: false },
        { client: client(), log: makeLogger({ logLevel: "error" }) },
      ),
    ).rejects.toThrow(/confirm=true/);
    expect(mock).not.toHaveBeenCalled();
  });

  it("Zod literal(true) rejects confirm: false at schema parse time", () => {
    const schema = regenerateAppSecret.inputShape.confirm;
    expect(schema.safeParse(true).success).toBe(true);
    expect(schema.safeParse(false).success).toBe(false);
    expect(schema.safeParse(undefined).success).toBe(false);
  });
});

describe("get_idp tool", () => {
  it("GETs the per-idp endpoint", async () => {
    const mock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    const body = {
      id: "idp-1",
      name: "Google",
      type: "google",
      state: "active",
      client_id: "g-id",
      scopes: ["openid", "profile", "email"],
    };
    mock.mockResolvedValueOnce(
      new Response(JSON.stringify(body), { status: 200 }),
    );

    const out = await getIdp.handler(
      { workspace: "acme", idp_id: "idp-1" },
      { client: client(), log: makeLogger({ logLevel: "error" }) },
    );
    expect(out).toEqual(body);
    const [url, init] = mock.mock.calls[0]!;
    expect(String(url)).toContain("/v1/workspaces/acme/idps/idp-1");
    expect(init?.method ?? "GET").toBe("GET");
  });
});

describe("update_idp tool", () => {
  it("PATCHes with client_secret in the body (upstream rotation path)", async () => {
    const mock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    mock.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "idp-1" }), { status: 200 }),
    );

    await updateIdp.handler(
      {
        workspace: "acme",
        idp_id: "idp-1",
        client_secret: "rotated-upstream-secret",
        scopes: ["openid", "email"],
      },
      { client: client(), log: makeLogger({ logLevel: "error" }) },
    );
    const [url, init] = mock.mock.calls[0]!;
    expect(String(url)).toContain("/v1/workspaces/acme/idps/idp-1");
    expect(init.method).toBe("PATCH");
    const sent = JSON.parse(init.body as string);
    expect(sent).toEqual({
      client_secret: "rotated-upstream-secret",
      scopes: ["openid", "email"],
    });
    expect(sent).not.toHaveProperty("workspace");
    expect(sent).not.toHaveProperty("idp_id");
  });
});

describe("invite_user tool", () => {
  it("uses /users/invite endpoint and applies preferred_language default", async () => {
    const mock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    mock.mockResolvedValueOnce(
      new Response(JSON.stringify({ user_id: "u-1", created: true }), {
        status: 200,
      }),
    );

    const out = await inviteUser.handler(
      {
        workspace: "acme",
        email: "alice@example.com",
        first_name: "Alice",
        last_name: "Smith",
        preferred_language: "es",
      },
      { client: client(), log: makeLogger({ logLevel: "error" }) },
    );
    expect(out).toMatchObject({ user_id: "u-1", created: true });
    const [url] = mock.mock.calls[0]!;
    expect(String(url)).toContain("/users/invite");
  });
});
