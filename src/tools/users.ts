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

export const tools = [listUsers, inviteUser, deleteUser] as const;
