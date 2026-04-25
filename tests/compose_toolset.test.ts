/**
 * Integration test for the full tool surface — handwritten + curated +
 * generated. Asserts:
 *   1. No duplicate tool names.
 *   2. Hand-written canonical tools are present.
 *   3. Generated tools that have a hand-written equivalent (via alias map)
 *      are filtered out.
 *   4. Total count is at least the lower bound the README advertises.
 */
import { describe, it, expect } from "vitest";

import { composeToolset } from "../src/index.js";

describe("composeToolset", () => {
  const tools = composeToolset();
  const names = tools.map((t) => t.name);

  it("produces no duplicate names", () => {
    const seen = new Set<string>();
    const dupes: string[] = [];
    for (const n of names) {
      if (seen.has(n)) dupes.push(n);
      seen.add(n);
    }
    expect(dupes).toEqual([]);
  });

  it("keeps hand-written canonical tools", () => {
    for (const expected of [
      "list_workspaces",
      "create_workspace",
      "get_workspace",
      "create_oidc_app",
      "delete_oidc_app",
      "add_idp",
      "delete_idp",
      "invite_user",
      "update_branding",
      "update_login_policy",
      "get_billing",
      "set_spending_cap",
      "start_billing_checkout",
      "start_billing_portal",
      "setup_prysmid_workspace",
      "enable_google_login",
      "prysmid_setup_check",
    ]) {
      expect(names).toContain(expected);
    }
  });

  it("drops generated aliases when their handwritten counterpart exists", () => {
    // These would shadow the more agent-friendly handwritten names.
    expect(names).not.toContain("create_app");
    expect(names).not.toContain("delete_app");
    expect(names).not.toContain("create_idp");
    expect(names).not.toContain("update_spending_cap");
    expect(names).not.toContain("billing_checkout");
    expect(names).not.toContain("billing_portal");
    expect(names).not.toContain("billing_get_state");
  });

  it("includes generated tools that have no handwritten equivalent", () => {
    // SMTP, retry-provisioning, etc. are only auto-generated.
    expect(names).toContain("get_smtp");
    expect(names).toContain("set_custom_smtp");
    expect(names).toContain("revert_to_platform_default");
    expect(names).toContain("retry_provisioning");
    expect(names).toContain("update_workspace");
    expect(names).toContain("delete_workspace");
    expect(names).toContain("delete_user");
    expect(names).toContain("delete_logo");
  });

  it("yields a healthy count of tools", () => {
    // 23 handwritten + 3 curated + ~11 generated-no-overlap.
    // Minimum sanity floor — hard floor catches accidental regressions.
    expect(tools.length).toBeGreaterThanOrEqual(30);
  });
});
