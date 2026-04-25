/**
 * Hand-written workspace tools. These are the ones agents reach for first;
 * the rest of the surface is auto-generated from OpenAPI in a later pass.
 */
import { z } from "zod";

import { defineTool } from "./registry.js";

export const listWorkspaces = defineTool({
  name: "list_workspaces",
  description:
    "List Prysmid workspaces accessible to the current API token. Returns an array of {id, slug, display_name, plan, state}.",
  inputShape: {},
  handler: async (_input, { client }) =>
    client.request("/v1/workspaces", { method: "GET" }),
});

export const getWorkspace = defineTool({
  name: "get_workspace",
  description: "Get a single workspace by slug or id.",
  inputShape: {
    workspace: z
      .string()
      .min(1)
      .describe("Workspace slug or UUID"),
  },
  handler: async ({ workspace }, { client }) =>
    client.request(`/v1/workspaces/${encodeURIComponent(workspace)}`),
});

export const createWorkspace = defineTool({
  name: "create_workspace",
  description:
    "Create a new Prysmid workspace. Provisioning runs in the background; the response returns immediately with state=provisioning. Poll `get_workspace` until state=active (~30s).",
  inputShape: {
    slug: z
      .string()
      .min(2)
      .max(63)
      .regex(/^[a-z0-9-]+$/, "lowercase alphanumeric and hyphens only")
      .describe("Subdomain-safe slug — becomes auth.<slug>.prysmid.com"),
    display_name: z.string().min(1).max(255),
  },
  handler: async (input, { client }) =>
    client.request("/v1/workspaces", { method: "POST", body: input }),
});

export const tools = [listWorkspaces, getWorkspace, createWorkspace] as const;
