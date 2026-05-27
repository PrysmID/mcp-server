/**
 * Outbound webhook endpoint tools — register URLs that Prysm:ID POSTs
 * events to when things happen in a workspace (user.created, grant.granted,
 * org.deleted, etc.).
 *
 * Each endpoint gets a 32-byte HMAC signing secret returned EXACTLY ONCE
 * by create_webhook_endpoint. Store it then; subsequent get/list/update
 * responses omit it. To rotate, delete and recreate the endpoint —
 * there is no mutation path that would silently invalidate a verifier.
 *
 * Distinct from the platform's /webhooks endpoint (Stripe-incoming).
 * These tools own the outgoing surface.
 */
import { z } from "zod";

import { defineTool } from "./registry.js";

const KNOWN_EVENTS = [
  "user.created",
  "user.deleted",
  "user.deactivated",
  "user.reactivated",
  "session.created",
  "org.created",
  "org.updated",
  "org.deactivated",
  "org.reactivated",
  "org.deleted",
  "grant.granted",
  "grant.updated",
  "grant.deactivated",
  "grant.reactivated",
  "grant.revoked",
] as const;

const eventName = z.enum(KNOWN_EVENTS);

export const createWebhookEndpoint = defineTool({
  name: "create_webhook_endpoint",
  description:
    "Register a new outbound webhook endpoint for a workspace. Returns the freshly-generated `signing_secret` EXACTLY ONCE — store it immediately to verify deliveries; it is NOT retrievable later. HTTPS required in prod. Empty `enabled_events` = catch-all (subscribe to everything).",
  inputShape: {
    workspace: z.string().min(1),
    url: z
      .string()
      .url()
      .describe(
        "Destination URL. Must be https:// in production; http:// is permitted only on dev/staging environments.",
      ),
    description: z
      .string()
      .max(255)
      .optional()
      .describe("Human label so you can tell endpoints apart in the dashboard."),
    enabled_events: z
      .array(eventName)
      .default([])
      .describe(
        "Event types this endpoint subscribes to. Empty = catch-all. Unknown event types return 422.",
      ),
  },
  handler: async ({ workspace, ...body }, { client }) =>
    client.request(
      `/v1/workspaces/${encodeURIComponent(workspace)}/webhook-endpoints`,
      { method: "POST", body },
    ),
});

export const listWebhookEndpoints = defineTool({
  name: "list_webhook_endpoints",
  description:
    "List all outbound webhook endpoints registered for a workspace. Does NOT return signing secrets — that's only on create.",
  inputShape: {
    workspace: z.string().min(1),
  },
  handler: async ({ workspace }, { client }) =>
    client.request(
      `/v1/workspaces/${encodeURIComponent(workspace)}/webhook-endpoints`,
    ),
});

export const getWebhookEndpoint = defineTool({
  name: "get_webhook_endpoint",
  description:
    "Read one webhook endpoint by id. Omits the signing secret — recreate the endpoint if it was lost.",
  inputShape: {
    workspace: z.string().min(1),
    endpoint_id: z.string().min(1),
  },
  handler: async ({ workspace, endpoint_id }, { client }) =>
    client.request(
      `/v1/workspaces/${encodeURIComponent(workspace)}/webhook-endpoints/${encodeURIComponent(endpoint_id)}`,
    ),
});

export const updateWebhookEndpoint = defineTool({
  name: "update_webhook_endpoint",
  description:
    "Sparse update of an endpoint's url / description / enabled_events / enabled flag. Omit fields to leave them untouched. signing_secret is NOT mutable — to rotate, delete and recreate.",
  inputShape: {
    workspace: z.string().min(1),
    endpoint_id: z.string().min(1),
    url: z.string().url().optional(),
    description: z.string().max(255).optional(),
    enabled_events: z.array(eventName).optional(),
    enabled: z
      .boolean()
      .optional()
      .describe(
        "Toggle deliveries without losing config. Useful when the destination is temporarily down.",
      ),
  },
  handler: async ({ workspace, endpoint_id, ...body }, { client }) =>
    client.request(
      `/v1/workspaces/${encodeURIComponent(workspace)}/webhook-endpoints/${encodeURIComponent(endpoint_id)}`,
      { method: "PATCH", body },
    ),
});

export const deleteWebhookEndpoint = defineTool({
  name: "delete_webhook_endpoint",
  description:
    "Permanently remove a webhook endpoint. Pending deliveries to it are NOT removed (operator can inspect them) but no new deliveries will be queued.",
  inputShape: {
    workspace: z.string().min(1),
    endpoint_id: z.string().min(1),
  },
  handler: async ({ workspace, endpoint_id }, { client }) =>
    client.request(
      `/v1/workspaces/${encodeURIComponent(workspace)}/webhook-endpoints/${encodeURIComponent(endpoint_id)}`,
      { method: "DELETE" },
    ),
});

export const tools = [
  createWebhookEndpoint,
  listWebhookEndpoints,
  getWebhookEndpoint,
  updateWebhookEndpoint,
  deleteWebhookEndpoint,
] as const;
