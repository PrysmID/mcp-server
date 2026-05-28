/**
 * Service account (machine user) tools — /v1/workspaces/{ws}/service-accounts/*.
 *
 * A service account is a Zitadel machine user that emits JWTs verifiable via
 * JWKS (M2M auth, RFC 7523). The JSON key is returned ONCE on create — the
 * platform never stores it, so the agent must surface it to the operator
 * immediately and tell them to store it in their secret manager.
 *
 * X3 per-org scoping: every tool accepts an optional `org_id` that maps to
 * `?org_id=` so the machine user lives in a specific business org. Omit for
 * the workspace's home org.
 */
import { z } from "zod";

import { defineTool } from "./registry.js";

const orgIdArg = z
  .string()
  .min(1)
  .optional()
  .describe(
    "Optional Zitadel org id to scope the service account to a specific business org. Omit for the workspace's home org (backwards-compat).",
  );

export const listServiceAccounts = defineTool({
  name: "list_service_accounts",
  description:
    "List the workspace's service accounts (machine users). The platform-internal provisioner SA is filtered out. Pass `org_id` to list a specific business org's machine users.",
  inputShape: {
    workspace: z.string().min(1),
    org_id: orgIdArg,
  },
  handler: async ({ workspace, org_id }, { client }) =>
    client.request(
      `/v1/workspaces/${encodeURIComponent(workspace)}/service-accounts`,
      { query: { org_id } },
    ),
});

export const createServiceAccount = defineTool({
  name: "create_service_account",
  description:
    "Create a service account (machine user) and mint its JSON key. The `key` is returned ONCE in the response and never stored by Prysmid — surface it to the operator and instruct them to save it in a secret manager. Pass `org_id` to create the SA inside a specific business org.",
  inputShape: {
    workspace: z.string().min(1),
    org_id: orgIdArg,
    user_name: z
      .string()
      .regex(/^[a-zA-Z][a-zA-Z0-9._-]{1,49}$/)
      .describe(
        "Machine username (Zitadel handle). Cannot be the reserved `prysmid-provisioner`.",
      ),
    name: z.string().min(1).max(200).describe("Human-readable display name."),
    description: z.string().max(500).optional(),
  },
  handler: async ({ workspace, org_id, ...body }, { client }) =>
    client.request(
      `/v1/workspaces/${encodeURIComponent(workspace)}/service-accounts`,
      { method: "POST", body, query: { org_id } },
    ),
});

export const deleteServiceAccount = defineTool({
  name: "delete_service_account",
  description:
    "Revoke a service account. Idempotent (204 even if already gone). Refuses to delete the platform provisioner SA. Pass `org_id` to target a specific business org's machine user.",
  inputShape: {
    workspace: z.string().min(1),
    org_id: orgIdArg,
    service_account_id: z.string().min(1),
  },
  handler: async ({ workspace, org_id, service_account_id }, { client }) =>
    client.request(
      `/v1/workspaces/${encodeURIComponent(workspace)}/service-accounts/${encodeURIComponent(service_account_id)}`,
      { method: "DELETE", query: { org_id } },
    ),
});

export const tools = [
  listServiceAccounts,
  createServiceAccount,
  deleteServiceAccount,
] as const;
