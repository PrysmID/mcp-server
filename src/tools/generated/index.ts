/**
 * AUTO-GENERATED. Do not edit.
 *
 * Aggregates every tag's generated tools into a single array. The merge with
 * hand-written tools (where hand-written wins on name collision) lives in
 * src/index.ts.
 */
import { generatedAppsTools } from "./apps.js";
import { generatedBillingTools } from "./billing.js";
import { generatedBrandingTools } from "./branding.js";
import { generatedIdpsTools } from "./idps.js";
import { generatedLoginPolicyTools } from "./login-policy.js";
import { generatedSmtpTools } from "./smtp.js";
import { generatedUsersTools } from "./users.js";
import { generatedWorkspacesTools } from "./workspaces.js";

export const generatedTools = [
  ...generatedAppsTools,
  ...generatedBillingTools,
  ...generatedBrandingTools,
  ...generatedIdpsTools,
  ...generatedLoginPolicyTools,
  ...generatedSmtpTools,
  ...generatedUsersTools,
  ...generatedWorkspacesTools,
];
