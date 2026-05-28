/**
 * Organization tools — multi-tenant orgs inside a workspace's Zitadel instance.
 *
 * Each org carries a stable `tenant_id` UUID that surfaces in the JWT
 * `tenant_id` claim and is what consumer apps should use as their tenant
 * partition key. Slugs and display names can change; tenant_id never does.
 *
 * The consumer org (slug `__consumer__`, `is_consumer=true`) is provisioned
 * separately via `ensure_consumer_organization` — regular `create_organization`
 * cannot use the reserved slug.
 */
import { z } from "zod";

import { defineTool } from "./registry.js";

export const createOrganization = defineTool({
  name: "create_organization",
  description:
    "Create a new organization inside a workspace. Returns the org with a stable `tenant_id` UUID — that's the value users will see as the `tenant_id` claim on their JWT when an active grant resolves to this org. Idempotent on slug: re-creating a duplicate slug returns 409.",
  inputShape: {
    workspace: z.string().min(1),
    name: z.string().min(1).max(255).describe("Display name (mutable)."),
    slug: z
      .string()
      .min(3)
      .max(63)
      .regex(/^[a-z][a-z0-9-]*[a-z0-9]$/)
      .describe(
        "URL-safe slug, unique per workspace. Immutable. Cannot be `__consumer__` (reserved).",
      ),
    allow_register: z
      .boolean()
      .default(false)
      .describe(
        "Whether self-registration is allowed for this org. Default false (invite-only).",
      ),
  },
  handler: async ({ workspace, ...body }, { client }) =>
    client.request(
      `/v1/workspaces/${encodeURIComponent(workspace)}/organizations`,
      { method: "POST", body },
    ),
});

export const listOrganizations = defineTool({
  name: "list_organizations",
  description:
    "List all organizations in a workspace, oldest first. Each item includes the stable `tenant_id` UUID and the consumer flag.",
  inputShape: {
    workspace: z.string().min(1),
  },
  handler: async ({ workspace }, { client }) =>
    client.request(
      `/v1/workspaces/${encodeURIComponent(workspace)}/organizations`,
    ),
});

export const getOrganization = defineTool({
  name: "get_organization",
  description:
    "Read one organization by its Zitadel org id (the `id` returned by create/list, not the internal Prysm:ID UUID).",
  inputShape: {
    workspace: z.string().min(1),
    org_id: z.string().min(1),
  },
  handler: async ({ workspace, org_id }, { client }) =>
    client.request(
      `/v1/workspaces/${encodeURIComponent(workspace)}/organizations/${encodeURIComponent(org_id)}`,
    ),
});

export const updateOrganization = defineTool({
  name: "update_organization",
  description:
    "Rename an organization and/or toggle `allow_register` / `domain_auto_claim`. Sparse — omit fields to leave them untouched. Rename propagates to Zitadel synchronously.",
  inputShape: {
    workspace: z.string().min(1),
    org_id: z.string().min(1),
    name: z.string().min(1).max(255).optional(),
    allow_register: z.boolean().optional(),
    domain_auto_claim: z
      .boolean()
      .optional()
      .describe(
        "P2e opt-in: when True, verifying a domain on this org (or calling reconcile_organization_domain_claims) auto-grants the org access over consumer-org users with a matching verified email domain. Public domains are always excluded; the user's home org is never moved (the claim is an additional, revocable grant).",
      ),
  },
  handler: async ({ workspace, org_id, ...body }, { client }) =>
    client.request(
      `/v1/workspaces/${encodeURIComponent(workspace)}/organizations/${encodeURIComponent(org_id)}`,
      { method: "PATCH", body },
    ),
});

export const reconcileOrganizationDomainClaims = defineTool({
  name: "reconcile_organization_domain_claims",
  description:
    "P2e: grant this org access over consumer-org users whose verified email domain matches one of the org's verified domains. Idempotent and re-runnable — catches users who self-registered after a domain was verified. Requires domain_auto_claim=true on the org (returns skipped with a reason otherwise). Public email domains are always excluded; the user's home org is never moved. Returns counts: granted / already_present / candidates + the domains matched.",
  inputShape: {
    workspace: z.string().min(1),
    org_id: z.string().min(1),
  },
  handler: async ({ workspace, org_id }, { client }) =>
    client.request(
      `/v1/workspaces/${encodeURIComponent(workspace)}/organizations/${encodeURIComponent(org_id)}/_reconcile-domain-claims`,
      { method: "POST" },
    ),
});

export const deactivateOrganization = defineTool({
  name: "deactivate_organization",
  description:
    "Block all logins to an organization. Idempotent. Consumer org cannot be deactivated — toggle `allow_consumer_org=false` on the workspace instead.",
  inputShape: {
    workspace: z.string().min(1),
    org_id: z.string().min(1),
  },
  handler: async ({ workspace, org_id }, { client }) =>
    client.request(
      `/v1/workspaces/${encodeURIComponent(workspace)}/organizations/${encodeURIComponent(org_id)}/_deactivate`,
      { method: "POST" },
    ),
});

export const reactivateOrganization = defineTool({
  name: "reactivate_organization",
  description: "Re-enable logins for a previously deactivated organization. Idempotent.",
  inputShape: {
    workspace: z.string().min(1),
    org_id: z.string().min(1),
  },
  handler: async ({ workspace, org_id }, { client }) =>
    client.request(
      `/v1/workspaces/${encodeURIComponent(workspace)}/organizations/${encodeURIComponent(org_id)}/_reactivate`,
      { method: "POST" },
    ),
});

export const deleteOrganization = defineTool({
  name: "delete_organization",
  description:
    "Hard-delete an organization. Cascades users/projects/grants on the Zitadel side. Idempotent against out-of-band Zitadel removal. Consumer org is protected — toggle `allow_consumer_org=false` on the workspace to remove it.",
  inputShape: {
    workspace: z.string().min(1),
    org_id: z.string().min(1),
  },
  handler: async ({ workspace, org_id }, { client }) =>
    client.request(
      `/v1/workspaces/${encodeURIComponent(workspace)}/organizations/${encodeURIComponent(org_id)}`,
      { method: "DELETE" },
    ),
});

export const ensureConsumerOrganization = defineTool({
  name: "ensure_consumer_organization",
  description:
    "Idempotently provision the workspace's consumer organization for self-registered users. Requires `workspace.allow_consumer_org=true` (toggle it via update_workspace first). Returns the org row whether newly created or already present. Slug `__consumer__`, `allow_register=true`, `is_consumer=true`.",
  inputShape: {
    workspace: z.string().min(1),
  },
  handler: async ({ workspace }, { client }) =>
    client.request(
      `/v1/workspaces/${encodeURIComponent(workspace)}/organizations/_ensure-consumer`,
      { method: "POST" },
    ),
});

export const tools = [
  createOrganization,
  listOrganizations,
  getOrganization,
  updateOrganization,
  reconcileOrganizationDomainClaims,
  deactivateOrganization,
  reactivateOrganization,
  deleteOrganization,
  ensureConsumerOrganization,
] as const;
