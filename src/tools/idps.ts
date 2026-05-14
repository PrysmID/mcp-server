/**
 * Identity provider tools — Google, GitHub, Microsoft, generic OIDC.
 * Each create_* operation atomically: creates the IdP config AND adds it to
 * the login policy so it appears on the login screen. The Prysmid API
 * encapsulates that two-step lifecycle behind a single endpoint.
 */
import { z } from "zod";

import { defineTool } from "./registry.js";

export const listIdps = defineTool({
  name: "list_idps",
  description:
    "List identity providers (Google/GitHub/Microsoft/OIDC) configured on a workspace.",
  inputShape: {
    workspace: z.string().min(1),
  },
  handler: async ({ workspace }, { client }) =>
    client.request(`/v1/workspaces/${encodeURIComponent(workspace)}/idps`),
});

export const addIdp = defineTool({
  name: "add_idp",
  description:
    "Add an identity provider to the workspace and attach it to the login policy in one atomic call.",
  inputShape: {
    workspace: z.string().min(1),
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
  },
  handler: async ({ workspace, ...body }, { client }) =>
    client.request(
      `/v1/workspaces/${encodeURIComponent(workspace)}/idps`,
      { method: "POST", body },
    ),
});

export const deleteIdp = defineTool({
  name: "delete_idp",
  description:
    "Remove an identity provider. Strips it from the login policy then deletes the config. Idempotent.",
  inputShape: {
    workspace: z.string().min(1),
    idp_id: z.string().min(1),
  },
  handler: async ({ workspace, idp_id }, { client }) =>
    client.request(
      `/v1/workspaces/${encodeURIComponent(workspace)}/idps/${encodeURIComponent(idp_id)}`,
      { method: "DELETE" },
    ),
});

export const getIdp = defineTool({
  name: "get_idp",
  description:
    "Fetch full detail for one identity provider: type, state, client_id, issuer/tenant (when applicable), scopes, secret_updated_at, created_at. Never returns the client_secret.",
  inputShape: {
    workspace: z.string().min(1),
    idp_id: z.string().min(1),
  },
  handler: async ({ workspace, idp_id }, { client }) =>
    client.request(
      `/v1/workspaces/${encodeURIComponent(workspace)}/idps/${encodeURIComponent(idp_id)}`,
    ),
});

export const updateIdp = defineTool({
  name: "update_idp",
  description:
    "Patch mutable fields on an identity provider. All fields optional. Passing client_secret rotates the upstream-issued value (Google/GitHub/Microsoft/OIDC client secret stored in Prysmid). Passing client_id retargets to a different upstream client. issuer/tenant_id apply only when relevant to the IdP type.",
  inputShape: {
    workspace: z.string().min(1),
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
  },
  handler: async ({ workspace, idp_id, ...patch }, { client }) =>
    client.request(
      `/v1/workspaces/${encodeURIComponent(workspace)}/idps/${encodeURIComponent(idp_id)}`,
      { method: "PATCH", body: patch },
    ),
});

export const tools = [listIdps, addIdp, deleteIdp, getIdp, updateIdp] as const;
