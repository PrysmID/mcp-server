/**
 * User tools — list, invite (sends Zitadel init email), delete.
 * Invite is the primary creation path; users set their own password via the
 * email link. Direct user creation with pre-set credentials is intentionally
 * not exposed here.
 */
import { z } from "zod";

import { defineTool } from "./registry.js";

export const listUsers = defineTool({
  name: "list_users",
  description: "List human users in a workspace.",
  inputShape: {
    workspace: z.string().min(1),
    limit: z.number().int().min(1).max(500).default(100),
  },
  handler: async ({ workspace, limit }, { client }) =>
    client.request(
      `/v1/workspaces/${encodeURIComponent(workspace)}/users`,
      { query: { limit } },
    ),
});

export const inviteUser = defineTool({
  name: "invite_user",
  description:
    "Invite a user by email. Idempotent by email — re-inviting an existing user is a no-op. Triggers a Zitadel init email with a 'set your password' link.",
  inputShape: {
    workspace: z.string().min(1),
    email: z
      .string()
      .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "must be a valid email"),
    first_name: z.string().min(1),
    last_name: z.string().min(1),
    preferred_language: z
      .string()
      .length(2)
      .default("en")
      .describe("ISO 639-1, e.g. en/es/pt"),
  },
  handler: async ({ workspace, ...body }, { client }) =>
    client.request(
      `/v1/workspaces/${encodeURIComponent(workspace)}/users/invite`,
      { method: "POST", body },
    ),
});

export const startUserPasskey = defineTool({
  name: "start_user_passkey",
  description:
    "Start passkey (WebAuthn) enrollment for an end user. Default delivery='email': Zitadel mails the registration link to the user — safe, the link never transits this tool. delivery='link' returns the raw link: it is a BEARER CREDENTIAL (whoever opens it enrolls THEIR authenticator on the account, and with passwordless allowed that passkey signs in without password or TOTP). Only request 'link' for controlled support flows, never print or log it. The user must exist (404 user.not_found otherwise); requires the workspace login policy to allow passwordless for the passkey to be usable at sign-in.",
  inputShape: {
    workspace: z.string().min(1),
    user_id: z.string().min(1),
    delivery: z
      .enum(["email", "link"])
      .default("email")
      .describe(
        "email (default): Zitadel mails the link to the user. link: returns the raw registration link — sensitive, handle as a secret.",
      ),
  },
  handler: async ({ workspace, user_id, delivery }, { client }) =>
    client.request(
      `/v1/workspaces/${encodeURIComponent(workspace)}/users/${encodeURIComponent(user_id)}/passwordless`,
      { method: "POST", body: { delivery } },
    ),
});

export const deleteUser = defineTool({
  name: "delete_user",
  description: "Delete a user by id. Idempotent.",
  inputShape: {
    workspace: z.string().min(1),
    user_id: z.string().min(1),
  },
  handler: async ({ workspace, user_id }, { client }) =>
    client.request(
      `/v1/workspaces/${encodeURIComponent(workspace)}/users/${encodeURIComponent(user_id)}`,
      { method: "DELETE" },
    ),
});

export const tools = [listUsers, inviteUser, startUserPasskey, deleteUser] as const;
