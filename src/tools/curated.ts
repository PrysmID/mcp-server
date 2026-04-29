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
    const idp = await client.request(
      `/v1/workspaces/${encodeURIComponent(workspace)}/idps`,
      {
        method: "POST",
        body: {
          provider: "google",
          name,
          config: {
            client_id: google_client_id,
            client_secret: google_client_secret,
          },
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

export const prysmidSetupCheck = defineTool({
  name: "prysmid_setup_check",
  description:
    "Run a readiness checklist on a workspace: state=active, ≥1 OIDC app, ≥1 IdP OR password+register enabled, branding has a primary_color set, login_policy reasonable. Returns pass/fail per item plus a summary verdict.",
  inputShape: {
    workspace: z.string().min(1),
  },
  handler: async ({ workspace }, { client }) => {
    const ws = (await client.request(
      `/v1/workspaces/${encodeURIComponent(workspace)}`,
    )) as { state: string; auth_domain?: string };
    const appsResp = (await client.request(
      `/v1/workspaces/${encodeURIComponent(workspace)}/apps`,
    )) as ListResp;
    const idpsResp = (await client.request(
      `/v1/workspaces/${encodeURIComponent(workspace)}/idps`,
    )) as ListResp;
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
    const verdict = checks.every((c) => c.ok) ? "ready" : "incomplete";
    return { verdict, checks };
  },
});

export const tools = [
  setupPrysmidWorkspace,
  enableGoogleLogin,
  prysmidSetupCheck,
] as const;
