/**
 * Curated high-level tools — the ones agents would naturally reach for to
 * accomplish a goal in one call, instead of orchestrating 4 raw endpoints.
 *
 * Keep these small: each represents one end-user intent ("set up a workspace
 * with Google login"). Branch logic and prompts stay on the agent side; this
 * file only owns the API choreography.
 */
import { z } from "zod";

import { defineTool } from "./registry.js";

const SetupWorkspaceOutput = z.object({
  workspace_id: z.string(),
  slug: z.string(),
  auth_domain: z.string(),
  state: z.string(),
});

export const setupPrysmidWorkspace = defineTool({
  name: "setup_prysmid_workspace",
  description:
    "Create a new workspace and wait until it's fully provisioned (Zitadel instance, SMTP, DNS). Returns the live auth_domain ready to integrate.",
  inputShape: {
    slug: z
      .string()
      .min(2)
      .max(63)
      .regex(/^[a-z0-9-]+$/),
    display_name: z.string().min(1),
    timeout_seconds: z
      .number()
      .int()
      .min(10)
      .max(300)
      .default(120)
      .describe("Max time to wait for provisioning before returning."),
  },
  handler: async (
    { slug, display_name, timeout_seconds },
    { client, log },
  ) => {
    const created = (await client.request("/v1/workspaces", {
      method: "POST",
      body: { slug, display_name },
    })) as { id: string; slug: string; state: string; auth_domain?: string };

    const deadline = Date.now() + timeout_seconds * 1000;
    while (Date.now() < deadline) {
      const ws = (await client.request(
        `/v1/workspaces/${encodeURIComponent(created.id)}`,
      )) as {
        id: string;
        slug: string;
        state: string;
        auth_domain?: string;
        provisioning_error?: string;
      };
      if (ws.state === "active") {
        return SetupWorkspaceOutput.parse({
          workspace_id: ws.id,
          slug: ws.slug,
          auth_domain: ws.auth_domain ?? `auth.${ws.slug}.prysmid.com`,
          state: ws.state,
        });
      }
      if (ws.state === "provisioning_failed") {
        throw new Error(
          `Workspace provisioning failed: ${ws.provisioning_error ?? "unknown reason"}`,
        );
      }
      log.debug(`workspace ${created.id} state=${ws.state}, polling…`);
      await sleep(3000);
    }
    throw new Error(
      `Workspace did not reach state=active within ${timeout_seconds}s`,
    );
  },
});

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export const enableGoogleLogin = defineTool({
  name: "enable_google_login",
  description:
    "Add Google as an identity provider on a workspace and enable external IdPs in the login policy. Hands you a checklist if external IdPs were already disabled — agent should confirm before flipping that flag.",
  inputShape: {
    workspace: z.string().min(1),
    google_client_id: z.string().min(1),
    google_client_secret: z.string().min(1),
    name: z.string().default("Google"),
  },
  handler: async (
    { workspace, google_client_id, google_client_secret, name },
    { client },
  ) => {
    // The IdP create body is the discriminated-union shape that
    // app/schemas/idp.py expects: `type` (not `provider`), and client_id /
    // client_secret are flat top-level fields (not nested under `config`).
    // Sending `provider` or nested config 422s the request before any handler
    // runs.
    const idp = await client.request(
      `/v1/workspaces/${encodeURIComponent(workspace)}/idps`,
      {
        method: "POST",
        body: {
          type: "google",
          name,
          client_id: google_client_id,
          client_secret: google_client_secret,
        },
      },
    );

    // Force-enable external IdP toggle in case the workspace had it off.
    await client.request(
      `/v1/workspaces/${encodeURIComponent(workspace)}/login-policy`,
      { method: "PATCH", body: { allow_external_idp: true } },
    );

    return { idp, login_policy: "allow_external_idp=true" };
  },
});

interface SetupCheckItem {
  ok: boolean;
  name: string;
  details?: string;
}

type ListResp = { items?: unknown[]; total?: number } | unknown[];

function countItems(resp: ListResp): number {
  if (Array.isArray(resp)) return resp.length;
  if (typeof resp.total === "number") return resp.total;
  if (Array.isArray(resp.items)) return resp.items.length;
  return 0;
}

type IdpListItem = { id: string; name?: string; type?: string };
type IdpListResp = ListResp & { items?: IdpListItem[] };
type ProbeResp = {
  ok: boolean;
  provider_reachable: boolean;
  credentials_ok?: boolean | null;
  redirect_uri_ok?: boolean | null;
  error_code?: string | null;
  error_detail?: string | null;
};

function listOf(resp: ListResp): unknown[] {
  if (Array.isArray(resp)) return resp;
  if (Array.isArray(resp.items)) return resp.items;
  return [];
}

export const prysmidSetupCheck = defineTool({
  name: "prysmid_setup_check",
  description:
    "Run a readiness checklist on a workspace: state=active, ≥1 OIDC app, ≥1 IdP OR password+register enabled, branding has a primary_color set, login_policy reasonable, AND (by default) every external IdP probes successfully against its upstream provider. Returns pass/fail per item plus a summary verdict. Set `probe_idps=false` to skip the live probe (faster, but won't catch redirect_uri_mismatch or invalid client_secret until a real end-user hits the broken IdP).",
  inputShape: {
    workspace: z.string().min(1),
    probe_idps: z.boolean().optional().default(true),
  },
  handler: async ({ workspace, probe_idps = true }, { client }) => {
    const ws = (await client.request(
      `/v1/workspaces/${encodeURIComponent(workspace)}`,
    )) as { state: string; auth_domain?: string };
    const appsResp = (await client.request(
      `/v1/workspaces/${encodeURIComponent(workspace)}/apps`,
    )) as ListResp;
    const idpsResp = (await client.request(
      `/v1/workspaces/${encodeURIComponent(workspace)}/idps`,
    )) as IdpListResp;
    const policy = (await client.request(
      `/v1/workspaces/${encodeURIComponent(workspace)}/login-policy`,
    )) as {
      allow_username_password?: boolean;
      allow_register?: boolean;
      allow_external_idp?: boolean;
      force_mfa?: boolean;
    };
    const branding = (await client.request(
      `/v1/workspaces/${encodeURIComponent(workspace)}/branding`,
    )) as { primary_color?: string };

    // The list endpoints return { items, total } — but tolerate a raw array
    // too so the check stays robust if the projection ever flips back.
    const appsCount = countItems(appsResp);
    const idpsCount = countItems(idpsResp);
    const idpItems = listOf(idpsResp) as IdpListItem[];
    const passwordsOpen =
      policy.allow_username_password === true &&
      policy.allow_register === true;

    const checks: SetupCheckItem[] = [
      {
        ok: ws.state === "active",
        name: "workspace_active",
        details: `state=${ws.state}`,
      },
      {
        ok: appsCount > 0,
        name: "has_at_least_one_app",
        details: `${appsCount} apps`,
      },
      {
        ok: idpsCount > 0 || passwordsOpen,
        name: "users_can_sign_in",
        details:
          idpsCount > 0
            ? `${idpsCount} idps`
            : passwordsOpen
              ? "no idps but username+password (with self-registration) allowed"
              : "no idps; enable allow_username_password+allow_register or add an IdP",
      },
      {
        ok: !!branding.primary_color,
        name: "branding_primary_color_set",
      },
      {
        ok: policy.force_mfa === true || idpsCount > 0,
        name: "auth_strength_reasonable",
        details: policy.force_mfa
          ? "force_mfa=true"
          : idpsCount > 0
            ? `${idpsCount} external IdP(s) — strength delegated upstream`
            : "MFA off and no external IdPs — passwords-only is weak",
      },
    ];

    // Functional probe of each external IdP. Closes the gap where the
    // checklist reported `ready` because the IdP record existed, but the
    // OAuth flow was actually broken (redirect_uri_mismatch, invalid client_id)
    // — discoverable only via real-world login. Default-on so casual users
    // don't have to know to ask for it; opt-out via probe_idps=false for the
    // rare case where the probe latency matters more than the safety.
    if (probe_idps && idpItems.length > 0) {
      const probeResults: { id: string; result: ProbeResp; error?: string }[] = [];
      for (const idp of idpItems) {
        try {
          const probe = (await client.request(
            `/v1/workspaces/${encodeURIComponent(workspace)}/idps/${encodeURIComponent(idp.id)}/probe`,
            { method: "POST" },
          )) as ProbeResp;
          probeResults.push({ id: idp.id, result: probe });
        } catch (err) {
          probeResults.push({
            id: idp.id,
            result: { ok: false, provider_reachable: false },
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      const allOk = probeResults.every((r) => r.result.ok);
      const summary = probeResults
        .map((r) => {
          const code = r.result.error_code ? ` (${r.result.error_code})` : "";
          return `${r.id}=${r.result.ok ? "ok" : "fail"}${code}`;
        })
        .join(", ");
      const firstFailure = probeResults.find((r) => !r.result.ok);
      const details = firstFailure
        ? `${summary}. First failure: ${firstFailure.result.error_detail ?? firstFailure.error ?? "no detail"}`
        : summary;
      checks.push({
        ok: allOk,
        name: "idps_functional",
        details,
      });
    } else if (idpItems.length > 0) {
      checks.push({
        ok: true,
        name: "idps_functional",
        details: "skipped (probe_idps=false); won't catch redirect_uri_mismatch or invalid_client until a real end-user signs in.",
      });
    }

    const verdict = checks.every((c) => c.ok) ? "ready" : "incomplete";
    return { verdict, checks };
  },
});

export const tools = [
  setupPrysmidWorkspace,
  enableGoogleLogin,
  prysmidSetupCheck,
] as const;
