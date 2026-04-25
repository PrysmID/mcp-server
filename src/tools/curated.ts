/**
 * Curated high-level tools — the ones agents would naturally reach for to
 * accomplish a goal in one call, instead of orchestrating 4 raw endpoints.
 *
 * Keep these small: each represents one end-user intent ("set up a workspace
 * with Google login"). Branch logic and prompts stay on the agent side; this
 * file only owns the API choreography.
 */
import { z } from "zod";

import { defineTool } from "./registry.js";

const SetupWorkspaceOutput = z.object({
  workspace_id: z.string(),
  slug: z.string(),
  auth_domain: z.string(),
  state: z.string(),
});

export const setupPrysmidWorkspace = defineTool({
  name: "setup_prysmid_workspace",
  description:
    "Create a new workspace and wait until it's fully provisioned (Zitadel instance, SMTP, DNS). Returns the live auth_domain ready to integrate.",
  inputShape: {
    slug: z
      .string()
      .min(2)
      .max(63)
      .regex(/^[a-z0-9-]+$/),
    display_name: z.string().min(1),
    timeout_seconds: z
      .number()
      .int()
      .min(10)
      .max(300)
      .default(120)
      .describe("Max time to wait for provisioning before returning."),
  },
  handler: async (
    { slug, display_name, timeout_seconds },
    { client, log },
  ) => {
    const created = (await client.request("/v1/workspaces", {
      method: "POST",
      body: { slug, display_name },
    })) as { id: string; slug: string; state: string; auth_domain?: string };

    const deadline = Date.now() + timeout_seconds * 1000;
    while (Date.now() < deadline) {
      const ws = (await client.request(
        `/v1/workspaces/${encodeURIComponent(created.id)}`,
      )) as {
        id: string;
        slug: string;
        state: string;
        auth_domain?: string;
        provisioning_error?: string;
      };
      if (ws.state === "active") {
        return SetupWorkspaceOutput.parse({
          workspace_id: ws.id,
          slug: ws.slug,
          auth_domain: ws.auth_domain ?? `auth.${ws.slug}.prysmid.com`,
          state: ws.state,
        });
      }
      if (ws.state === "provisioning_failed") {
        throw new Error(
          `Workspace provisioning failed: ${ws.provisioning_error ?? "unknown reason"}`,
        );
      }
      log.debug(`workspace ${created.id} state=${ws.state}, polling…`);
      await sleep(3000);
    }
    throw new Error(
      `Workspace did not reach state=active within ${timeout_seconds}s`,
    );
  },
});

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export const tools = [setupPrysmidWorkspace] as const;
