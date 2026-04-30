/**
 * Tool registry — single place where every MCP tool lives. Each tool exports
 * its input schema (Zod) + handler; `registerAll` wires them into the SDK.
 *
 * Two flavors of tools coexist:
 *   - generated: 1:1 with REST endpoints, produced by `scripts/generate-tools.ts`
 *     (lives under `tools/generated/*` once the script runs)
 *   - curated: high-level orchestrators a human/agent actually wants to call,
 *     e.g. `setup_prysmid_workspace(company_name)` that combines several
 *     endpoints. These live under `tools/curated/*`.
 *
 * Both share the same `Tool` shape so the registry is uniform.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { PrysmidApiError, type PrysmidClient } from "../client.js";
import type { Logger } from "../logger.js";

export interface ToolContext {
  client: PrysmidClient;
  log: Logger;
}

export interface ToolDef<I extends z.ZodRawShape> {
  name: string;
  description: string;
  inputShape: I;
  /**
   * Handler returns plain JSON-able output. The SDK serializes it into
   * MCP `content` blocks; we wrap to text by default (most MCP UIs render it
   * better than structured content).
   */
  handler: (
    input: z.infer<z.ZodObject<I>>,
    ctx: ToolContext,
  ) => Promise<unknown>;
}

export function defineTool<I extends z.ZodRawShape>(t: ToolDef<I>): ToolDef<I> {
  return t;
}

// `ToolDef<any>` here intentionally — the array is heterogeneous (each tool
// has its own input shape) and the SDK's registerTool only cares about the
// runtime Zod object, not compile-time type inference. Without `any` there's
// no single ZodRawShape that satisfies every entry simultaneously.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerAll(
  server: McpServer,
  ctx: ToolContext,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tools: ReadonlyArray<ToolDef<any>>,
): void {
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.inputShape,
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async (input: any) => {
        try {
          const result = await tool.handler(input, ctx);
          return {
            content: [
              {
                type: "text" as const,
                text:
                  typeof result === "string"
                    ? result
                    : JSON.stringify(result, null, 2),
              },
            ],
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          // For API errors, surface the response body so callers see the
          // FastAPI validation detail instead of a bare status code.
          const detail =
            err instanceof PrysmidApiError && err.body ? `\n${err.body}` : "";
          ctx.log.error(`tool ${tool.name} failed`, { message });
          return {
            isError: true,
            content: [
              { type: "text" as const, text: `error: ${message}${detail}` },
            ],
          };
        }
      },
    );
  }
}
