/**
 * Branding tools — colors, fonts, logo for the login page. Logo upload is
 * out of MCP scope (multipart binary uploads don't fit MCP tool semantics
 * cleanly); use the dashboard or API directly for that.
 */
import { z } from "zod";

import { defineTool } from "./registry.js";

export const getBranding = defineTool({
  name: "get_branding",
  description:
    "Return the workspace's active branding policy (colors, fonts, hide-prysmid-watermark flag, logo URLs).",
  inputShape: {
    workspace: z.string().min(1),
  },
  handler: async ({ workspace }, { client }) =>
    client.request(
      `/v1/workspaces/${encodeURIComponent(workspace)}/branding`,
    ),
});

export const updateBranding = defineTool({
  name: "update_branding",
  description:
    "Update branding colors and watermark. Hex colors as `#RRGGBB`. Activates the policy after update — change shows on next login screen render.",
  inputShape: {
    workspace: z.string().min(1),
    primary_color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .optional(),
    background_color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .optional(),
    warn_color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .optional(),
    font_color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .optional(),
    disable_watermark: z
      .boolean()
      .optional()
      .describe(
        "Hide 'Powered by Prysmid' on the login screen (Pro+ only — Free silently ignored).",
      ),
  },
  handler: async ({ workspace, ...body }, { client }) =>
    client.request(
      `/v1/workspaces/${encodeURIComponent(workspace)}/branding`,
      { method: "PATCH", body },
    ),
});

export const tools = [getBranding, updateBranding] as const;
