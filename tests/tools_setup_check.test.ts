import { describe, expect, it } from "vitest";

import type { PrysmidClient } from "../src/client.js";
import { makeLogger } from "../src/logger.js";
import { prysmidSetupCheck } from "../src/tools/curated.js";

function fakeClient(byPath: Record<string, unknown>): PrysmidClient {
  return {
    async request(path: string) {
      // Strip query string for matching
      const key = path.split("?")[0]!;
      if (!(key in byPath)) throw new Error(`unexpected request to ${key}`);
      return byPath[key];
    },
  } as unknown as PrysmidClient;
}

const ctx = (paths: Record<string, unknown>) => ({
  client: fakeClient(paths),
  log: makeLogger({ logLevel: "error" }),
});

describe("prysmid_setup_check", () => {
  it("returns verdict=ready when everything is configured", async () => {
    const out = (await prysmidSetupCheck.handler(
      { workspace: "acme" },
      ctx({
        "/v1/workspaces/acme": {
          state: "active",
          auth_domain: "auth.acme.prysmid.com",
        },
        "/v1/workspaces/acme/apps": [{ id: "app-1" }],
        "/v1/workspaces/acme/idps": [{ id: "idp-1" }],
        "/v1/workspaces/acme/login-policy": {
          allow_username_password: true,
          allow_register: true,
          force_mfa: false,
        },
        "/v1/workspaces/acme/branding": { primary_color: "#0000ff" },
      }),
    )) as { verdict: string };
    expect(out.verdict).toBe("ready");
  });

  it("flags incomplete when no apps", async () => {
    const out = (await prysmidSetupCheck.handler(
      { workspace: "fresh" },
      ctx({
        "/v1/workspaces/fresh": { state: "active" },
        "/v1/workspaces/fresh/apps": [],
        "/v1/workspaces/fresh/idps": [],
        "/v1/workspaces/fresh/login-policy": {
          allow_username_password: true,
          allow_register: true,
        },
        "/v1/workspaces/fresh/branding": { primary_color: "#ff00ff" },
      }),
    )) as { verdict: string; checks: { ok: boolean; name: string }[] };
    expect(out.verdict).toBe("incomplete");
    const apps = out.checks.find((c) => c.name === "has_at_least_one_app");
    expect(apps?.ok).toBe(false);
  });

  it("flags users_can_sign_in=false when no idps and password disabled", async () => {
    const out = (await prysmidSetupCheck.handler(
      { workspace: "stuck" },
      ctx({
        "/v1/workspaces/stuck": { state: "active" },
        "/v1/workspaces/stuck/apps": [{ id: "a" }],
        "/v1/workspaces/stuck/idps": [],
        "/v1/workspaces/stuck/login-policy": {
          allow_username_password: false,
          allow_register: false,
        },
        "/v1/workspaces/stuck/branding": { primary_color: "#000000" },
      }),
    )) as { verdict: string; checks: { ok: boolean; name: string }[] };
    expect(out.verdict).toBe("incomplete");
    const sign = out.checks.find((c) => c.name === "users_can_sign_in");
    expect(sign?.ok).toBe(false);
  });
});
