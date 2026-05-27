/**
 * Identity provider tools — Google, GitHub, Microsoft, generic OIDC.
 * Each create_* operation atomically: creates the IdP config AND adds it to
 * the login policy so it appears on the login screen. The Prysmid API
 * encapsulates that two-step lifecycle behind a single endpoint.
 *
 * P3a-1 per-org scoping: every tool accepts an optional `org_id` that maps
 * to the `?org_id=` query param. When provided, the IdP operation targets
 * that specific business org instead of the workspace's home org. Omit it
 * for legacy single-org behaviour.
 */
import { z } from "zod";

import { defineTool } from "./registry.js";

const orgIdArg = z
  .string()
  .min(1)
  .optional()
  .describe(
    "Optional Zitadel org id to scope this operation to a specific business org inside the workspace. Omit for the workspace's home org (backwards-compat).",
  );

// X6: JIT + linking behaviour. All fields optional — omitted fields fall
// back to the Prysm:ID defaults on create, or preserve current state on
// patch. See platform/api/app/schemas/idp.py:IdpProviderOptions for the
// canonical contract.
const providerOptionsSchema = z
  .object({
    is_creation_allowed: z.boolean().optional(),
    is_auto_creation: z
      .boolean()
      .optional()
      .describe(
        "JIT provisioning: True auto-creates a Prysm:ID user on first external login. The most common X6 flag — set False for tightly-controlled enterprise tenants where seats are granted manually.",
      ),
    is_auto_update: z.boolean().optional(),
    is_linking_allowed: z.boolean().optional(),
    auto_linking: z
      .enum(["unspecified", "username", "email"])
      .optional()
      .describe(
        "How to merge an external first-login into an existing Prysm:ID user. `username` matches user_name, `email` matches verified email, `unspecified` disables auto-linking.",
      ),
  })
  .optional()
  .describe(
    "X6: JIT + linking behaviour. Omitted fields fall back to defaults on create (auto-create + auto-update + link-by-username) or preserve current state on patch.",
  );

export const listIdps = defineTool({
  name: "list_idps",
  description:
    "List identity providers (Google/GitHub/Microsoft/OIDC) configured on a workspace. Pass `org_id` to list IdPs of a specific business org.",
  inputShape: {
    workspace: z.string().min(1),
    org_id: orgIdArg,
  },
  handler: async ({ workspace, org_id }, { client }) =>
    client.request(`/v1/workspaces/${encodeURIComponent(workspace)}/idps`, {
      query: { org_id },
    }),
});

export const addIdp = defineTool({
  name: "add_idp",
  description:
    "Add an identity provider to the workspace and attach it to the login policy in one atomic call. Pass `org_id` to attach the IdP to a specific business org (multi-tenant setup) instead of the workspace's home org. Pass `provider_options` to control JIT provisioning + account-linking behaviour (X6).",
  inputShape: {
    workspace: z.string().min(1),
    org_id: orgIdArg,
    type: z
      .enum(["google", "github", "microsoft", "oidc"])
      .describe("Identity provider kind. `microsoft` covers Azure AD / Entra."),
    name: z.string().min(1).describe("Display name shown on login screen"),
    client_id: z.string().min(1),
    client_secret: z.string().min(1),
    scopes: z.array(z.string()).optional(),
    issuer: z
      .string()
      .url()
      .optional()
      .describe("Required for `oidc`; ignored otherwise"),
    tenant_id: z
      .string()
      .optional()
      .describe(
        "Optional for `microsoft` — lock to a specific Entra tenant GUID. Default accepts any account.",
      ),
    provider_options: providerOptionsSchema,
  },
  handler: async ({ workspace, org_id, ...body }, { client }) =>
    client.request(`/v1/workspaces/${encodeURIComponent(workspace)}/idps`, {
      method: "POST",
      body,
      query: { org_id },
    }),
});

export const deleteIdp = defineTool({
  name: "delete_idp",
  description:
    "Remove an identity provider. Strips it from the login policy then deletes the config. Idempotent. Pass `org_id` to target a specific business org's IdP.",
  inputShape: {
    workspace: z.string().min(1),
    org_id: orgIdArg,
    idp_id: z.string().min(1),
  },
  handler: async ({ workspace, org_id, idp_id }, { client }) =>
    client.request(
      `/v1/workspaces/${encodeURIComponent(workspace)}/idps/${encodeURIComponent(idp_id)}`,
      { method: "DELETE", query: { org_id } },
    ),
});

export const getIdp = defineTool({
  name: "get_idp",
  description:
    "Fetch full detail for one identity provider: type, state, client_id, issuer/tenant (when applicable), scopes, secret_updated_at, created_at. Never returns the client_secret. Pass `org_id` to scope to a business org.",
  inputShape: {
    workspace: z.string().min(1),
    org_id: orgIdArg,
    idp_id: z.string().min(1),
  },
  handler: async ({ workspace, org_id, idp_id }, { client }) =>
    client.request(
      `/v1/workspaces/${encodeURIComponent(workspace)}/idps/${encodeURIComponent(idp_id)}`,
      { query: { org_id } },
    ),
});

export const updateIdp = defineTool({
  name: "update_idp",
  description:
    "Patch mutable fields on an identity provider. All fields optional. Passing client_secret rotates the upstream-issued value (Google/GitHub/Microsoft/OIDC client secret stored in Prysmid). Passing client_id retargets to a different upstream client. issuer/tenant_id apply only when relevant to the IdP type. Pass `org_id` to scope to a business org. Pass `provider_options` to flip JIT or linking flags — only the keys you set change, others are preserved (X6).",
  inputShape: {
    workspace: z.string().min(1),
    org_id: orgIdArg,
    idp_id: z.string().min(1),
    name: z.string().min(1).optional(),
    client_id: z.string().min(1).optional(),
    client_secret: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Rotate the upstream-issued client secret. Not the Prysmid app secret — that one is rotated via regenerate_app_secret.",
      ),
    scopes: z.array(z.string()).optional(),
    issuer: z
      .string()
      .url()
      .optional()
      .describe("Only meaningful for type=oidc."),
    tenant_id: z
      .string()
      .optional()
      .describe("Only meaningful for type=microsoft (Entra tenant GUID)."),
    provider_options: providerOptionsSchema,
  },
  handler: async ({ workspace, org_id, idp_id, ...patch }, { client }) =>
    client.request(
      `/v1/workspaces/${encodeURIComponent(workspace)}/idps/${encodeURIComponent(idp_id)}`,
      { method: "PATCH", body: patch, query: { org_id } },
    ),
});

export const probeIdp = defineTool({
  name: "probe_idp",
  description:
    "Probe an external identity provider end-to-end against its upstream authorize endpoint. Catches redirect_uri_mismatch (URI not registered at Google Cloud / GitHub / etc.), invalid_client (client_id rotated or deleted upstream), and provider_unreachable failures BEFORE a real end-user hits them. Use after enable_google_login / add_idp, and any time you suspect the IdP is misconfigured. Today: Google + GitHub get full classification; Microsoft + OIDC generic return `skipped` for the deterministic dimensions (only reachability is verified). Pass `org_id` to scope to a business org.",
  inputShape: {
    workspace: z.string().min(1),
    org_id: orgIdArg,
    idp_id: z.string().min(1),
  },
  handler: async ({ workspace, org_id, idp_id }, { client }) =>
    client.request(
      `/v1/workspaces/${encodeURIComponent(workspace)}/idps/${encodeURIComponent(idp_id)}/probe`,
      { method: "POST", query: { org_id } },
    ),
});

export const tools = [listIdps, addIdp, deleteIdp, getIdp, updateIdp, probeIdp] as const;
