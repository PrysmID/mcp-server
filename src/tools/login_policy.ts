/**
 * Login policy tools — control which authentication methods are allowed,
 * MFA enforcement, lockout thresholds. Patches are merge semantics on the
 * server side; only fields you set are changed.
 */
import { z } from "zod";

import { defineTool } from "./registry.js";

export const getLoginPolicy = defineTool({
  name: "get_login_policy",
  description:
    "Return the workspace's current login policy (password rules, MFA, IdPs allowed, lockout, etc.).",
  inputShape: {
    workspace: z.string().min(1),
  },
  handler: async ({ workspace }, { client }) =>
    client.request(
      `/v1/workspaces/${encodeURIComponent(workspace)}/login-policy`,
    ),
});

export const updateLoginPolicy = defineTool({
  name: "update_login_policy",
  description:
    "Update the login policy. PATCH semantics — only fields you pass are changed; other policy fields stay as they were.",
  inputShape: {
    workspace: z.string().min(1),
    allow_username_password: z.boolean().optional(),
    allow_register: z.boolean().optional(),
    allow_external_idp: z.boolean().optional(),
    force_mfa: z
      .boolean()
      .optional()
      .describe("Require any second factor at login"),
    passwordless_type: z
      .enum([
        "PASSWORDLESS_TYPE_NOT_ALLOWED",
        "PASSWORDLESS_TYPE_ALLOWED",
      ])
      .optional()
      .describe("Enables passkey-first when set to ALLOWED"),
    max_password_attempts: z.number().int().min(0).max(20).optional(),
    lockout_password_attempts: z.number().int().min(0).max(20).optional(),
  },
  handler: async ({ workspace, ...body }, { client }) =>
    client.request(
      `/v1/workspaces/${encodeURIComponent(workspace)}/login-policy`,
      { method: "PATCH", body },
    ),
});

export const tools = [getLoginPolicy, updateLoginPolicy] as const;
