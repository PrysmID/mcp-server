/**
 * Generator unit tests — fixture-driven so we don't depend on the live
 * Prysmid API. Asserts:
 *   1. Output file paths and tool count are stable.
 *   2. Skip rules (views, health, multipart-only bodies) are honored.
 *   3. Generic operationIds get prefixed with their tag.
 *   4. Path params + body fields land in the inputShape.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { describe, it, expect } from "vitest";

import { generateFromSpec } from "../scripts/generate-tools.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = resolve(here, "fixtures", "sample-openapi.json");
const spec = JSON.parse(readFileSync(fixturePath, "utf8"));

describe("generateFromSpec on fixture", () => {
  const files = generateFromSpec(spec);

  it("emits one file per kept tag plus an index", () => {
    const paths = files.map((f) => f.path).sort();
    expect(paths).toEqual([
      "src/tools/generated/index.ts",
      "src/tools/generated/things.ts",
    ]);
  });

  it("things.ts contains list/create/delete tools", () => {
    const things = files.find((f) => f.path.endsWith("things.ts"))!;
    expect(things.source).toContain('name: "list_things"');
    expect(things.source).toContain('name: "create_thing"');
    expect(things.source).toContain('name: "delete_thing"');
  });

  it("skips `views` and `health` tags", () => {
    expect(files.length).toBe(2); // things + index
    const all = files.map((f) => f.source).join("\n");
    expect(all).not.toContain("views");
    expect(all).not.toContain("healthz");
  });

  it("path params get z.string().uuid() from format=uuid", () => {
    const things = files.find((f) => f.path.endsWith("things.ts"))!;
    expect(things.source).toMatch(/thing_id:\s*z\.string\(\)\.uuid\(\)/);
  });

  it("body fields land in inputShape with constraints", () => {
    const things = files.find((f) => f.path.endsWith("things.ts"))!;
    expect(things.source).toContain('z.string().min(1).max(100)');
    expect(things.source).toContain('z.enum(["small", "large"])');
    // anyOf [array, null] becomes nullable
    expect(things.source).toMatch(/tags:\s*z\.array\(z\.string\(\)\)\.nullable\(\)/);
  });

  it("URL template substitutes path params with encodeURIComponent", () => {
    const things = files.find((f) => f.path.endsWith("things.ts"))!;
    expect(things.source).toContain(
      "`/v1/things/${encodeURIComponent(String(thing_id))}`",
    );
  });

  it("index.ts re-exports the tag's array", () => {
    const idx = files.find((f) => f.path.endsWith("index.ts"))!;
    expect(idx.source).toContain(
      'import { generatedThingsTools } from "./things.js"',
    );
    expect(idx.source).toContain("...generatedThingsTools");
  });
});

describe("generateFromSpec — multipart body skip", () => {
  it("drops ops whose only body content type is non-JSON", () => {
    const fixture = {
      paths: {
        "/v1/upload": {
          post: {
            tags: ["files"],
            operationId: "upload_v1_upload_post",
            requestBody: {
              required: true,
              content: {
                "multipart/form-data": { schema: { type: "object" } },
              },
            },
            responses: { "200": { description: "ok" } },
          },
        },
        "/v1/files": {
          get: {
            tags: ["files"],
            operationId: "list_files_v1_files_get",
            responses: { "200": { description: "ok" } },
          },
        },
      },
    };
    const files = generateFromSpec(fixture);
    const filesTs = files.find((f) => f.path.endsWith("files.ts"))!;
    expect(filesTs.source).toContain('name: "list_files"');
    expect(filesTs.source).not.toContain('name: "upload"');
  });
});

describe("generateFromSpec — generic name prefixing", () => {
  it("prefixes single-word operationIds with their tag", () => {
    const fixture = {
      paths: {
        "/v1/billing/checkout": {
          post: {
            tags: ["billing"],
            operationId: "checkout_v1_billing_checkout_post",
            responses: { "200": { description: "ok" } },
          },
        },
      },
    };
    const files = generateFromSpec(fixture);
    const billing = files.find((f) => f.path.endsWith("billing.ts"))!;
    expect(billing.source).toContain('name: "billing_checkout"');
  });
});
