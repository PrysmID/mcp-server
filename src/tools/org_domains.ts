/**
 * Per-org domain tools — wraps
 * /v1/workspaces/{ws}/organizations/{org_id}/domains/*.
 *
 * Domain claims are the prerequisite for domain discovery on the login
 * screen (`update_login_policy ... allow_domain_discovery=true`) and
 * future email-claim flows. Attaching is cheap; verification needs the
 * operator to publish a DNS TXT record or HTTP file from the token.
 *
 * Typical flow an agent should follow:
 *   1. add_organization_domain(workspace, org_id, domain)
 *   2. generate_organization_domain_verification(... method=dns)
 *      → returns {token, url, method}, agent shows token + record to operator
 *   3. operator publishes the TXT record
 *   4. verify_organization_domain(...) → checks publication, marks verified
 *   5. update_login_policy(workspace, org_id, allow_domain_discovery=true)
 */
import { z } from "zod";

import { defineTool } from "./registry.js";

const workspaceArg = z.string().min(1);
const orgIdArg = z
  .string()
  .min(1)
  .describe(
    "Zitadel org id (the `id` returned by create/list_organizations). Per-org scoping.",
  );
const domainArg = z
  .string()
  .min(3)
  .max(253)
  .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/)
  .describe(
    "Fully-qualified domain to manage. Lower-case only — `Acme.com` and `acme.com` are different to Zitadel.",
  );

export const listOrganizationDomains = defineTool({
  name: "list_organization_domains",
  description:
    "List every domain attached to an organization with its verification state. Use after add/verify to confirm the domain shows `is_verified=true`.",
  inputShape: {
    workspace: workspaceArg,
    org_id: orgIdArg,
  },
  handler: async ({ workspace, org_id }, { client }) =>
    client.request(
      `/v1/workspaces/${encodeURIComponent(workspace)}/organizations/${encodeURIComponent(org_id)}/domains`,
    ),
});

export const addOrganizationDomain = defineTool({
  name: "add_organization_domain",
  description:
    "Attach a domain to an organization. State starts UNVERIFIED — chain `generate_organization_domain_verification` and `verify_organization_domain` to complete setup. 409 if already attached.",
  inputShape: {
    workspace: workspaceArg,
    org_id: orgIdArg,
    domain: domainArg,
  },
  handler: async ({ workspace, org_id, domain }, { client }) =>
    client.request(
      `/v1/workspaces/${encodeURIComponent(workspace)}/organizations/${encodeURIComponent(org_id)}/domains`,
      { method: "POST", body: { domain } },
    ),
});

export const generateOrganizationDomainVerification = defineTool({
  name: "generate_organization_domain_verification",
  description:
    "Generate (or rotate) the verification token + record location for an attached domain. Returns `{token, url, method}`. The operator must publish the token at `url` (DNS TXT for method=dns; HTTP file for method=http) before calling `verify_organization_domain`. DNS is the default — works on apex domains, does not require HTTP control.",
  inputShape: {
    workspace: workspaceArg,
    org_id: orgIdArg,
    domain: domainArg,
    method: z
      .enum(["dns", "http"])
      .default("dns")
      .describe(
        "Verification method. `dns` (default) → publish a TXT record. `http` → serve a file at `.well-known/zitadel-challenge/<token>` on the domain.",
      ),
  },
  handler: async ({ workspace, org_id, domain, method }, { client }) =>
    client.request(
      `/v1/workspaces/${encodeURIComponent(workspace)}/organizations/${encodeURIComponent(org_id)}/domains/${encodeURIComponent(domain)}/_generate_verification`,
      { method: "POST", body: { method } },
    ),
});

export const verifyOrganizationDomain = defineTool({
  name: "verify_organization_domain",
  description:
    "Trigger Zitadel to look up the published verification token and mark the domain verified. Returns the updated domain projection with `is_verified=true` on success. 400 if the token is not found (DNS not propagated yet, wrong record, etc.) — retry after publishing.",
  inputShape: {
    workspace: workspaceArg,
    org_id: orgIdArg,
    domain: domainArg,
  },
  handler: async ({ workspace, org_id, domain }, { client }) =>
    client.request(
      `/v1/workspaces/${encodeURIComponent(workspace)}/organizations/${encodeURIComponent(org_id)}/domains/${encodeURIComponent(domain)}/_verify`,
      { method: "POST" },
    ),
});

export const deleteOrganizationDomain = defineTool({
  name: "delete_organization_domain",
  description:
    "Detach a domain from an organization. Idempotent (204 even if already gone). Verified domains can be removed too — domain discovery will no longer route logins of that email domain to this org.",
  inputShape: {
    workspace: workspaceArg,
    org_id: orgIdArg,
    domain: domainArg,
  },
  handler: async ({ workspace, org_id, domain }, { client }) =>
    client.request(
      `/v1/workspaces/${encodeURIComponent(workspace)}/organizations/${encodeURIComponent(org_id)}/domains/${encodeURIComponent(domain)}`,
      { method: "DELETE" },
    ),
});

export const tools = [
  listOrganizationDomains,
  addOrganizationDomain,
  generateOrganizationDomainVerification,
  verifyOrganizationDomain,
  deleteOrganizationDomain,
] as const;
