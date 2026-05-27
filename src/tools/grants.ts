/**
 * UserGrant tools — cross-org access primitive.
 *
 * A grant materializes "user X has access to org Y's project Z with these
 * roles". The user lives in their home org (often the workspace's consumer
 * org); access to another org's app is materialized as a grant. The JWT
 * `tenant_id` claim derives from the active grant's org when the user logs
 * in to a project belonging to it — so the same person can have stable `sub`
 * but different `tenant_id` per session.
 */
import { z } from "zod";

import { defineTool } from "./registry.js";

export const grantUserToOrganization = defineTool({
  name: "grant_user_to_organization",
  description:
    "Grant a user access to an organization's project with a set of role keys. The user does NOT need to be a member of the org — that's the point. Idempotent at the (user, org, project) tuple: duplicates return 502 from Zitadel.",
  inputShape: {
    workspace: z.string().min(1),
    org_id: z
      .string()
      .min(1)
      .describe("Zitadel org id of the org GRANTING access."),
    user_id: z
      .string()
      .min(1)
      .describe(
        "Zitadel user id. The user's home org is irrelevant — grants are cross-org.",
      ),
    project_id: z
      .string()
      .min(1)
      .describe(
        "Zitadel project id this grant is for. Look it up via list_apps — every OIDC app belongs to a project.",
      ),
    role_keys: z
      .array(z.string())
      .default([])
      .describe(
        "Role keys defined on the target project. Empty list = bare membership (still gates access).",
      ),
  },
  handler: async ({ workspace, org_id, ...body }, { client }) =>
    client.request(
      `/v1/workspaces/${encodeURIComponent(workspace)}/organizations/${encodeURIComponent(org_id)}/grants`,
      { method: "POST", body },
    ),
});

export const listGrantsInOrganization = defineTool({
  name: "list_grants_in_organization",
  description:
    "List all grants owned by an organization. Returns each grant with the granted user_id, project_id, role_keys, and the org's tenant_id (the value users will see as `tenant_id` claim when this grant is active).",
  inputShape: {
    workspace: z.string().min(1),
    org_id: z.string().min(1),
  },
  handler: async ({ workspace, org_id }, { client }) =>
    client.request(
      `/v1/workspaces/${encodeURIComponent(workspace)}/organizations/${encodeURIComponent(org_id)}/grants`,
    ),
});

export const listGrantsForUser = defineTool({
  name: "list_grants_for_user",
  description:
    "List all grants held by a user across orgs in this workspace. Useful for 'what does this user have access to?' and offboarding/audit reviews.",
  inputShape: {
    workspace: z.string().min(1),
    user_id: z.string().min(1),
  },
  handler: async ({ workspace, user_id }, { client }) =>
    client.request(
      `/v1/workspaces/${encodeURIComponent(workspace)}/users/${encodeURIComponent(user_id)}/grants`,
    ),
});

export const updateGrantRoles = defineTool({
  name: "update_grant_roles",
  description:
    "Replace the role_keys on an existing grant. The set is replaced wholesale — pass the full desired list, not a delta.",
  inputShape: {
    workspace: z.string().min(1),
    org_id: z.string().min(1),
    grant_id: z.string().min(1),
    role_keys: z.array(z.string()),
  },
  handler: async ({ workspace, org_id, grant_id, role_keys }, { client }) =>
    client.request(
      `/v1/workspaces/${encodeURIComponent(workspace)}/organizations/${encodeURIComponent(org_id)}/grants/${encodeURIComponent(grant_id)}`,
      { method: "PATCH", body: { role_keys } },
    ),
});

export const deactivateGrant = defineTool({
  name: "deactivate_grant",
  description:
    "Temporarily suspend a grant without revoking it. Idempotent. Re-enable later with reactivate_grant.",
  inputShape: {
    workspace: z.string().min(1),
    org_id: z.string().min(1),
    grant_id: z.string().min(1),
  },
  handler: async ({ workspace, org_id, grant_id }, { client }) =>
    client.request(
      `/v1/workspaces/${encodeURIComponent(workspace)}/organizations/${encodeURIComponent(org_id)}/grants/${encodeURIComponent(grant_id)}/_deactivate`,
      { method: "POST" },
    ),
});

export const reactivateGrant = defineTool({
  name: "reactivate_grant",
  description: "Re-enable a previously deactivated grant. Idempotent.",
  inputShape: {
    workspace: z.string().min(1),
    org_id: z.string().min(1),
    grant_id: z.string().min(1),
  },
  handler: async ({ workspace, org_id, grant_id }, { client }) =>
    client.request(
      `/v1/workspaces/${encodeURIComponent(workspace)}/organizations/${encodeURIComponent(org_id)}/grants/${encodeURIComponent(grant_id)}/_reactivate`,
      { method: "POST" },
    ),
});

export const revokeGrant = defineTool({
  name: "revoke_grant",
  description:
    "Permanently revoke a grant. Idempotent — 204 even if the Zitadel-side grant is already gone. Emits a `grant.revoked` audit event (will fire a webhook in slice X5).",
  inputShape: {
    workspace: z.string().min(1),
    org_id: z.string().min(1),
    grant_id: z.string().min(1),
  },
  handler: async ({ workspace, org_id, grant_id }, { client }) =>
    client.request(
      `/v1/workspaces/${encodeURIComponent(workspace)}/organizations/${encodeURIComponent(org_id)}/grants/${encodeURIComponent(grant_id)}`,
      { method: "DELETE" },
    ),
});

export const tools = [
  grantUserToOrganization,
  listGrantsInOrganization,
  listGrantsForUser,
  updateGrantRoles,
  deactivateGrant,
  reactivateGrant,
  revokeGrant,
] as const;
