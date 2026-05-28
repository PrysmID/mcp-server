/**
 * Login policy tools — control which authentication methods are allowed,
 * MFA factors, passwordless, and domain-discovery routing. Patches are
 * merge semantics on the server side; only fields you set are changed.
 *
 * P3a-3 per-org scoping: both tools accept an optional `org_id` that maps
 * to the `?org_id=` query param. When provided, the operation targets that
 * specific business org's login policy. Omit for the workspace's home org.
 *
 * Schema mirrors the platform API's `LoginPolicyView/Update`:
 *   - allow_username_password / allow_register / allow_external_idp
 *   - force_mfa, force_mfa_local_only, passwordless_allowed (bool, NOT a string enum)
 *   - second_factors: list of {otp, u2f, otp_email, otp_sms}
 *   - multi_factors: list of {u2f_verified}
 *   - hide_password_reset, ignore_unknown_usernames
 *   - allow_domain_discovery (P3a-3 — route logins by email domain)
 */
import { z } from "zod";

import { defineTool } from "./registry.js";

const orgIdArg = z
  .string()
  .min(1)
  .optional()
  .describe(
    "Optional Zitadel org id to scope this operation to a specific business org. Omit for the workspace's home org (backwards-compat).",
  );

const SECOND_FACTORS = ["otp", "u2f", "otp_email", "otp_sms"] as const;
const MULTI_FACTORS = ["u2f_verified"] as const;

export const getLoginPolicy = defineTool({
  name: "get_login_policy",
  description:
    "Return the workspace's current login policy (auth methods, MFA factors, passwordless, domain discovery, hide-password-reset, etc.). Pass `org_id` to read a specific business org's policy.",
  inputShape: {
    workspace: z.string().min(1),
    org_id: orgIdArg,
  },
  handler: async ({ workspace, org_id }, { client }) =>
    client.request(
      `/v1/workspaces/${encodeURIComponent(workspace)}/login-policy`,
      { query: { org_id } },
    ),
});

export const updateLoginPolicy = defineTool({
  name: "update_login_policy",
  description:
    "Update the login policy. PATCH semantics — only fields you pass are changed; other policy fields stay as they were. Pass `org_id` to scope to a specific business org (P3a-3). Set `allow_domain_discovery=true` together with a verified org domain (see `verify_organization_domain`) to route email-based logins to that org automatically.",
  inputShape: {
    workspace: z.string().min(1),
    org_id: orgIdArg,
    allow_username_password: z.boolean().optional(),
    allow_register: z.boolean().optional(),
    allow_external_idp: z.boolean().optional(),
    force_mfa: z
      .boolean()
      .optional()
      .describe("Require any second factor at login."),
    force_mfa_local_only: z
      .boolean()
      .optional()
      .describe(
        "X2: require MFA only for username/password logins, exempting external-IdP logins (which may already enforce MFA upstream). Only meaningful when force_mfa is also true.",
      ),
    passwordless_allowed: z
      .boolean()
      .optional()
      .describe("Allow passkey-first sign-in flows."),
    second_factors: z
      .array(z.enum(SECOND_FACTORS))
      .optional()
      .describe(
        "Replaces the full list of allowed second-factor methods. Pass `[]` to disable all 2FA.",
      ),
    multi_factors: z
      .array(z.enum(MULTI_FACTORS))
      .optional()
      .describe(
        "Replaces the full list of allowed multi-factor (passwordless+verification) methods.",
      ),
    hide_password_reset: z.boolean().optional(),
    ignore_unknown_usernames: z.boolean().optional(),
    allow_domain_discovery: z
      .boolean()
      .optional()
      .describe(
        "P3a-3: route logins to the org that owns the typed email's verified domain, skipping the IdP picker. Requires at least one verified domain on the org (see verify_organization_domain).",
      ),
  },
  handler: async ({ workspace, org_id, ...body }, { client }) =>
    client.request(
      `/v1/workspaces/${encodeURIComponent(workspace)}/login-policy`,
      { method: "PATCH", body, query: { org_id } },
    ),
});

export const tools = [getLoginPolicy, updateLoginPolicy] as const;
