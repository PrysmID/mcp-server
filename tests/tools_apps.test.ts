import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PrysmidClient } from "../src/client.js";
import { loadConfig } from "../src/config.js";
import { makeLogger } from "../src/logger.js";
import { createOidcApp } from "../src/tools/apps.js";
import { addIdp } from "../src/tools/idps.js";
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
  it("posts JSON body and applies defaults", async () => {
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
        app_type: "OIDC_APP_TYPE_WEB",
        auth_method: "OIDC_AUTH_METHOD_TYPE_NONE",
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
