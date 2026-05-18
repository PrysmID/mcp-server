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
  it("returns verdict=ready when everything is configured (paginated shape)", async () => {
    const out = (await prysmidSetupCheck.handler(
      { workspace: "acme", probe_idps: false },
      ctx({
        "/v1/workspaces/acme": {
          state: "active",
          auth_domain: "auth.acme.prysmid.com",
        },
        "/v1/workspaces/acme/apps": { items: [{ id: "app-1" }], total: 1 },
        "/v1/workspaces/acme/idps": { items: [{ id: "idp-1" }], total: 1 },
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

  it("still works when list endpoints return a raw array (legacy shape)", async () => {
    const out = (await prysmidSetupCheck.handler(
      { workspace: "legacy", probe_idps: false },
      ctx({
        "/v1/workspaces/legacy": { state: "active" },
        "/v1/workspaces/legacy/apps": [{ id: "app-1" }],
        "/v1/workspaces/legacy/idps": [{ id: "idp-1" }],
        "/v1/workspaces/legacy/login-policy": {
          allow_username_password: true,
          allow_register: true,
          force_mfa: false,
        },
        "/v1/workspaces/legacy/branding": { primary_color: "#0000ff" },
      }),
    )) as { verdict: string };
    expect(out.verdict).toBe("ready");
  });

  it("flags incomplete when no apps and never prints 'undefined apps'", async () => {
    const out = (await prysmidSetupCheck.handler(
      { workspace: "fresh" },
      ctx({
        "/v1/workspaces/fresh": { state: "active" },
        "/v1/workspaces/fresh/apps": { items: [], total: 0 },
        "/v1/workspaces/fresh/idps": { items: [], total: 0 },
        "/v1/workspaces/fresh/login-policy": {
          allow_username_password: true,
          allow_register: true,
        },
        "/v1/workspaces/fresh/branding": { primary_color: "#ff00ff" },
      }),
    )) as {
      verdict: string;
      checks: { ok: boolean; name: string; details?: string }[];
    };
    expect(out.verdict).toBe("incomplete");
    const apps = out.checks.find((c) => c.name === "has_at_least_one_app");
    expect(apps?.ok).toBe(false);
    // Regression guard for Bug #3 — template-string with undefined got into
    // production before because `.length` on the {items,total} object was undefined.
    expect(apps?.details).toBe("0 apps");
    expect(apps?.details).not.toContain("undefined");
  });

  it("flags users_can_sign_in=false when no idps and password disabled", async () => {
    const out = (await prysmidSetupCheck.handler(
      { workspace: "stuck" },
      ctx({
        "/v1/workspaces/stuck": { state: "active" },
        "/v1/workspaces/stuck/apps": { items: [{ id: "a" }], total: 1 },
        "/v1/workspaces/stuck/idps": { items: [], total: 0 },
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

  it("uses affirmative tone for users_can_sign_in.details when ok=true (Bug #5)", async () => {
    const out = (await prysmidSetupCheck.handler(
      { workspace: "passwords" },
      ctx({
        "/v1/workspaces/passwords": { state: "active" },
        "/v1/workspaces/passwords/apps": { items: [{ id: "a" }], total: 1 },
        "/v1/workspaces/passwords/idps": { items: [], total: 0 },
        "/v1/workspaces/passwords/login-policy": {
          allow_username_password: true,
          allow_register: true,
          force_mfa: false,
        },
        "/v1/workspaces/passwords/branding": { primary_color: "#000" },
      }),
    )) as { checks: { ok: boolean; name: string; details?: string }[] };
    const sign = out.checks.find((c) => c.name === "users_can_sign_in");
    expect(sign?.ok).toBe(true);
    // The previous wording ("must allow…") read like a pending obligation
    // even when ok=true. Affirmative phrasing is the contract now.
    expect(sign?.details).not.toContain("must allow");
    expect(sign?.details).toContain("allowed");
  });

  it("auth_strength_reasonable details matches reality when no idps (Bug #4)", async () => {
    const out = (await prysmidSetupCheck.handler(
      { workspace: "weak" },
      ctx({
        "/v1/workspaces/weak": { state: "active" },
        "/v1/workspaces/weak/apps": { items: [{ id: "a" }], total: 1 },
        "/v1/workspaces/weak/idps": { items: [], total: 0 },
        "/v1/workspaces/weak/login-policy": {
          allow_username_password: true,
          allow_register: true,
          force_mfa: false,
          allow_external_idp: true,
        },
        "/v1/workspaces/weak/branding": { primary_color: "#000" },
      }),
    )) as { checks: { ok: boolean; name: string; details?: string }[] };
    const auth = out.checks.find((c) => c.name === "auth_strength_reasonable");
    expect(auth?.ok).toBe(false);
    // Used to incorrectly say "external IdP present" because the check
    // confused login-policy's allow_external_idp toggle with an actual IdP
    // count. The message must reflect that there are zero IdPs configured.
    expect(auth?.details).not.toContain("external IdP present");
    expect(auth?.details).toContain("no external IdPs");
  });

  it("idps_functional check: ready when probes succeed (default probe_idps=true)", async () => {
    const out = (await prysmidSetupCheck.handler(
      { workspace: "good" },
      ctx({
        "/v1/workspaces/good": { state: "active" },
        "/v1/workspaces/good/apps": { items: [{ id: "a" }], total: 1 },
        "/v1/workspaces/good/idps": {
          items: [{ id: "idp-1", type: "google" }],
          total: 1,
        },
        "/v1/workspaces/good/login-policy": {
          allow_username_password: true,
          allow_register: true,
        },
        "/v1/workspaces/good/branding": { primary_color: "#000" },
        "/v1/workspaces/good/idps/idp-1/probe": {
          ok: true,
          provider_reachable: true,
          credentials_ok: true,
          redirect_uri_ok: true,
        },
      }),
    )) as {
      verdict: string;
      checks: { ok: boolean; name: string; details?: string }[];
    };
    expect(out.verdict).toBe("ready");
    const fn = out.checks.find((c) => c.name === "idps_functional");
    expect(fn?.ok).toBe(true);
    expect(fn?.details).toContain("idp-1=ok");
  });

  it("idps_functional check: flags incomplete when a probe fails (real-world redirect_uri_mismatch)", async () => {
    /** Closes the gap that motivated the 2026-05-18 integration report:
     *  setup_check was reporting `ready` while a misconfigured IdP was
     *  silently failing for end-users. The probe must catch that and the
     *  overall verdict must demote to `incomplete`. */
    const out = (await prysmidSetupCheck.handler(
      { workspace: "broken" },
      ctx({
        "/v1/workspaces/broken": { state: "active" },
        "/v1/workspaces/broken/apps": { items: [{ id: "a" }], total: 1 },
        "/v1/workspaces/broken/idps": {
          items: [{ id: "idp-1", type: "google" }],
          total: 1,
        },
        "/v1/workspaces/broken/login-policy": {
          allow_username_password: true,
          allow_register: true,
        },
        "/v1/workspaces/broken/branding": { primary_color: "#000" },
        "/v1/workspaces/broken/idps/idp-1/probe": {
          ok: false,
          provider_reachable: true,
          credentials_ok: true,
          redirect_uri_ok: false,
          error_code: "redirect_uri_mismatch",
          error_detail:
            "Google rejected the redirect_uri. Add EXACTLY 'https://x/...' as an Authorized redirect URI.",
        },
      }),
    )) as {
      verdict: string;
      checks: { ok: boolean; name: string; details?: string }[];
    };
    expect(out.verdict).toBe("incomplete");
    const fn = out.checks.find((c) => c.name === "idps_functional");
    expect(fn?.ok).toBe(false);
    expect(fn?.details).toContain("redirect_uri_mismatch");
    expect(fn?.details).toContain("Google rejected");
  });

  it("idps_functional is reported as skipped when probe_idps=false (preserves backward compat)", async () => {
    const out = (await prysmidSetupCheck.handler(
      { workspace: "skipped", probe_idps: false },
      ctx({
        "/v1/workspaces/skipped": { state: "active" },
        "/v1/workspaces/skipped/apps": { items: [{ id: "a" }], total: 1 },
        "/v1/workspaces/skipped/idps": {
          items: [{ id: "idp-1" }],
          total: 1,
        },
        "/v1/workspaces/skipped/login-policy": {
          allow_username_password: true,
          allow_register: true,
        },
        "/v1/workspaces/skipped/branding": { primary_color: "#000" },
      }),
    )) as {
      verdict: string;
      checks: { ok: boolean; name: string; details?: string }[];
    };
    const fn = out.checks.find((c) => c.name === "idps_functional");
    expect(fn?.ok).toBe(true);
    expect(fn?.details).toContain("skipped");
    expect(out.verdict).toBe("ready");
  });

  it("auth_strength_reasonable celebrates when idps>0 and force_mfa off", async () => {
    const out = (await prysmidSetupCheck.handler(
      { workspace: "delegated", probe_idps: false },
      ctx({
        "/v1/workspaces/delegated": { state: "active" },
        "/v1/workspaces/delegated/apps": { items: [{ id: "a" }], total: 1 },
        "/v1/workspaces/delegated/idps": {
          items: [{ id: "google" }, { id: "github" }],
          total: 2,
        },
        "/v1/workspaces/delegated/login-policy": {
          allow_username_password: true,
          allow_register: true,
          force_mfa: false,
        },
        "/v1/workspaces/delegated/branding": { primary_color: "#000" },
      }),
    )) as { checks: { ok: boolean; name: string; details?: string }[] };
    const auth = out.checks.find((c) => c.name === "auth_strength_reasonable");
    expect(auth?.ok).toBe(true);
    expect(auth?.details).toContain("2 external IdP");
  });
});
