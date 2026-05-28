/**
 * Audit log export tool — /v1/workspaces/{ws}/audit-log/export.
 *
 * X4: pull a workspace's audit trail as NDJSON (default) or CSV, optionally
 * scoped to one business org via `org_id` (matches `meta.org_id`), with
 * action + time-window filters. The response body is the raw export text —
 * the MCP layer surfaces it verbatim so an agent can summarise it or hand
 * it to the operator for archival.
 */
import { z } from "zod";

import { defineTool } from "./registry.js";

export const exportAuditLog = defineTool({
  name: "export_audit_log",
  description:
    "Export a workspace's audit trail as NDJSON (default) or CSV. Filter by `org_id` (a specific business org, matches meta.org_id), `action` (exact, e.g. `idp.create`), and a created_at window (`start`/`end`, ISO-8601). `limit` caps rows (default 10000, max 50000). Returns the raw export text — narrow the window to page through large trails.",
  inputShape: {
    workspace: z.string().min(1),
    format: z
      .enum(["ndjson", "csv"])
      .default("ndjson")
      .describe(
        "ndjson (default) = one JSON object per line, best for SIEM. csv = flat columns with meta JSON-encoded in one cell.",
      ),
    org_id: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Scope to one business org (matches meta.org_id). Omit for the whole workspace.",
      ),
    action: z
      .string()
      .min(1)
      .optional()
      .describe("Exact audit action to filter, e.g. `idp.create`."),
    start: z
      .string()
      .optional()
      .describe("ISO-8601 timestamp; only rows created at/after this."),
    end: z
      .string()
      .optional()
      .describe("ISO-8601 timestamp; only rows created before this."),
    limit: z.number().int().min(1).max(50000).optional(),
  },
  handler: async ({ workspace, ...query }, { client }) =>
    client.request(
      `/v1/workspaces/${encodeURIComponent(workspace)}/audit-log/export`,
      { query },
    ),
});

export const tools = [exportAuditLog] as const;
