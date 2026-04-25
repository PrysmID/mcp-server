/**
 * Billing tools — read state, manage spending cap, generate Stripe portal URL.
 * Checkout/upgrade flow returns a Stripe-hosted URL; the agent surfaces it to
 * the user for them to navigate (we don't process payment data here).
 */
import { z } from "zod";

import { defineTool } from "./registry.js";

export const getBilling = defineTool({
  name: "get_billing",
  description:
    "Get current billing state: plan, subscription status, current period, spending_cap_cents, signups_blocked.",
  inputShape: {
    workspace: z.string().min(1),
  },
  handler: async ({ workspace }, { client }) =>
    client.request(
      `/v1/workspaces/${encodeURIComponent(workspace)}/billing`,
    ),
});

export const setSpendingCap = defineTool({
  name: "set_spending_cap",
  description:
    "Cap monthly Pro overage spend (cents). Pass null to remove cap (unlimited). When projected overage exceeds cap, signups_blocked flips on.",
  inputShape: {
    workspace: z.string().min(1),
    spending_cap_cents: z
      .number()
      .int()
      .min(0)
      .max(10_000_000)
      .nullable()
      .describe("Max overage cents per period; null = unlimited"),
  },
  handler: async ({ workspace, spending_cap_cents }, { client }) =>
    client.request(
      `/v1/workspaces/${encodeURIComponent(workspace)}/billing/spending-cap`,
      { method: "PATCH", body: { spending_cap_cents } },
    ),
});

export const startCheckout = defineTool({
  name: "start_billing_checkout",
  description:
    "Create a Stripe Checkout session for upgrading. Returns the URL the user must visit. Plan must be `pro` (Free has no checkout; Enterprise is sales-only).",
  inputShape: {
    workspace: z.string().min(1),
    plan: z.enum(["pro"]),
  },
  handler: async ({ workspace, plan }, { client }) =>
    client.request(
      `/v1/workspaces/${encodeURIComponent(workspace)}/billing/checkout`,
      { method: "POST", body: { plan } },
    ),
});

export const startBillingPortal = defineTool({
  name: "start_billing_portal",
  description:
    "Create a Stripe customer-portal session URL where the user manages payment methods, downloads invoices, cancels subscription.",
  inputShape: {
    workspace: z.string().min(1),
  },
  handler: async ({ workspace }, { client }) =>
    client.request(
      `/v1/workspaces/${encodeURIComponent(workspace)}/billing/portal`,
      { method: "POST" },
    ),
});

export const tools = [
  getBilling,
  setSpendingCap,
  startCheckout,
  startBillingPortal,
] as const;
