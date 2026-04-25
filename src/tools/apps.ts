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
    "Create an OIDC application in a workspace. Returns client_id (and client_secret if confidential). Use auth_method=NONE for SPA/PKCE; use BASIC for confidential web apps.",
  inputShape: {
    workspace: z.string().min(1),
    name: z.string().min(1).max(255),
    redirect_uris: z.array(z.string().url()).min(1),
    post_logout_redirect_uris: z.array(z.string().url()).optional(),
    app_type: z
      .enum([
        "OIDC_APP_TYPE_WEB",
        "OIDC_APP_TYPE_USER_AGENT",
        "OIDC_APP_TYPE_NATIVE",
      ])
      .default("OIDC_APP_TYPE_WEB"),
    auth_method: z
      .enum([
        "OIDC_AUTH_METHOD_TYPE_NONE",
        "OIDC_AUTH_METHOD_TYPE_BASIC",
        "OIDC_AUTH_METHOD_TYPE_POST",
      ])
      .default("OIDC_AUTH_METHOD_TYPE_NONE"),
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

export const tools = [listApps, createOidcApp, deleteOidcApp] as const;
