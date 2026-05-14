/**
 * OIDC application tools — list, create, delete on a workspace's apps.
 * Apps are the integration unit: each one represents one downstream service
 * (web app, mobile app, CLI) that authenticates via Prysmid.
 */
import { z } from "zod";

import { defineTool } from "./registry.js";

export const listApps = defineTool({
  name: "list_apps",
  description: "List all OIDC apps in a workspace.",
  inputShape: {
    workspace: z.string().min(1).describe("Workspace slug or UUID"),
  },
  handler: async ({ workspace }, { client }) =>
    client.request(`/v1/workspaces/${encodeURIComponent(workspace)}/apps`),
});

export const createOidcApp = defineTool({
  name: "create_oidc_app",
  description:
    "Create an OIDC application in a workspace. Returns client_id (and client_secret only when app_type=web). app_type=web is a confidential server-rendered app; spa and native are public clients that use PKCE and have no secret.",
  inputShape: {
    workspace: z.string().min(1),
    name: z.string().min(1).max(255),
    redirect_uris: z.array(z.string().url()).min(1),
    post_logout_redirect_uris: z.array(z.string().url()).optional(),
    app_type: z.enum(["web", "spa", "native"]).default("web"),
    dev_mode: z
      .boolean()
      .default(false)
      .describe(
        "Skip redirect URI HTTPS check — only for local dev, NEVER prod.",
      ),
  },
  handler: async ({ workspace, ...body }, { client }) =>
    client.request(
      `/v1/workspaces/${encodeURIComponent(workspace)}/apps`,
      { method: "POST", body },
    ),
});

export const deleteOidcApp = defineTool({
  name: "delete_oidc_app",
  description: "Delete an OIDC app. Idempotent — 404 returns success.",
  inputShape: {
    workspace: z.string().min(1),
    app_id: z.string().min(1),
  },
  handler: async ({ workspace, app_id }, { client }) =>
    client.request(
      `/v1/workspaces/${encodeURIComponent(workspace)}/apps/${encodeURIComponent(app_id)}`,
      { method: "DELETE" },
    ),
});

const APP_TYPE = z.enum(["web", "spa", "native"]);
const AUTH_METHOD = z.enum([
  "client_secret_basic",
  "client_secret_post",
  "none",
  "private_key_jwt",
]);
const GRANT_TYPE = z.enum([
  "authorization_code",
  "refresh_token",
  "implicit",
  "device_code",
  "token_exchange",
]);

export const getApp = defineTool({
  name: "get_app",
  description:
    "Fetch full detail for one OIDC app: redirect URIs, grant types, auth method, dev_mode, timestamps. Never returns the client_secret — use regenerate_app_secret to mint a new one.",
  inputShape: {
    workspace: z.string().min(1).describe("Workspace slug or UUID"),
    app_id: z.string().min(1),
  },
  handler: async ({ workspace, app_id }, { client }) =>
    client.request(
      `/v1/workspaces/${encodeURIComponent(workspace)}/apps/${encodeURIComponent(app_id)}`,
    ),
});

export const updateApp = defineTool({
  name: "update_app",
  description:
    "Patch mutable fields on an OIDC app: redirect URIs, post-logout URIs, grant types, auth method, dev_mode. All fields optional — only provided keys change. client_secret is NEVER accepted here; use regenerate_app_secret to rotate it.",
  inputShape: {
    workspace: z.string().min(1),
    app_id: z.string().min(1),
    redirect_uris: z.array(z.string().url()).optional(),
    post_logout_redirect_uris: z.array(z.string().url()).optional(),
    grant_types: z.array(GRANT_TYPE).optional(),
    auth_method: AUTH_METHOD.optional(),
    dev_mode: z
      .boolean()
      .optional()
      .describe(
        "Skip redirect URI HTTPS check — only for local dev, NEVER prod.",
      ),
  },
  handler: async ({ workspace, app_id, ...patch }, { client }) =>
    client.request(
      `/v1/workspaces/${encodeURIComponent(workspace)}/apps/${encodeURIComponent(app_id)}`,
      { method: "PATCH", body: patch },
    ),
});

export const regenerateAppSecret = defineTool({
  name: "regenerate_app_secret",
  description:
    "Destructive — invalidates the current secret immediately. Returns the new secret plaintext ONCE. Set confirm=true to proceed. Only valid for app_type=web (confidential clients); spa/native are public and have no secret (the API returns 422 in that case).",
  inputShape: {
    workspace: z.string().min(1),
    app_id: z.string().min(1),
    confirm: z
      .literal(true)
      .describe(
        "Must be true to acknowledge that the current secret will be invalidated immediately.",
      ),
  },
  handler: async ({ workspace, app_id, confirm }, { client }) => {
    if (confirm !== true) {
      throw new Error(
        "regenerate_app_secret refused: pass confirm=true to acknowledge that the current secret will be invalidated immediately and the new secret is surfaced only once.",
      );
    }
    return client.request(
      `/v1/workspaces/${encodeURIComponent(workspace)}/apps/${encodeURIComponent(app_id)}/regenerate-secret`,
      { method: "POST" },
    );
  },
});

// Exported for use in index.ts composeToolset (handwritten precedence).
// Also re-exported as `appTypeEnum` etc. would be unnecessary; the tools list
// is the only surface the registry needs.
export const tools = [
  listApps,
  createOidcApp,
  deleteOidcApp,
  getApp,
  updateApp,
  regenerateAppSecret,
] as const;
