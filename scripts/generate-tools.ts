/**
 * OpenAPI → MCP tool generator.
 *
 * Reads the Prysmid OpenAPI spec (live or fixture), emits one TS file per tag
 * under `src/tools/generated/<tag>.ts`. Each generated tool wraps a single
 * REST operation: path params + request body become a Zod input schema, and
 * the handler calls `client.request(...)`.
 *
 * Hand-written / curated tools win on name conflicts — the merge happens at
 * registration time in `src/index.ts`, not here. This script is a pure code
 * generator: deterministic input → deterministic output.
 *
 * Run:
 *   npm run gen-tools
 *
 * Programmatic use (for tests):
 *   import { generateFromSpec } from "./generate-tools.ts";
 *   const files = generateFromSpec(spec);
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_SPEC_URL = "https://api.prysmid.com/openapi.json";

// ─── OpenAPI types we actually consume ──────────────────────────────────────
// We don't pull in @types/openapi or similar — the subset we touch is small
// enough that a local interface keeps the generator dependency-free at
// build time (tsx runs scripts/ outside of tsup's bundle).
interface OpenAPISpec {
  paths: Record<string, Record<string, OpenAPIOperation>>;
  components?: { schemas?: Record<string, OpenAPISchema> };
}

interface OpenAPIOperation {
  tags?: string[];
  summary?: string;
  description?: string;
  operationId?: string;
  parameters?: OpenAPIParameter[];
  requestBody?: {
    required?: boolean;
    content?: Record<string, { schema?: OpenAPISchema }>;
  };
}

interface OpenAPIParameter {
  name: string;
  in: "path" | "query" | "header" | "cookie";
  required?: boolean;
  description?: string;
  schema?: OpenAPISchema;
}

interface OpenAPISchema {
  type?: string | string[];
  format?: string;
  enum?: unknown[];
  items?: OpenAPISchema;
  properties?: Record<string, OpenAPISchema>;
  required?: string[];
  description?: string;
  default?: unknown;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  pattern?: string;
  anyOf?: OpenAPISchema[];
  oneOf?: OpenAPISchema[];
  allOf?: OpenAPISchema[];
  $ref?: string;
  examples?: unknown[];
  title?: string;
}

// ─── Public API ─────────────────────────────────────────────────────────────

export interface GeneratedFile {
  /** File path relative to the project root (forward slashes). */
  path: string;
  /** Full TypeScript source. */
  source: string;
}

export interface GenerateOptions {
  /**
   * Tags to skip — by default the FastAPI dashboard's HTML view endpoints
   * (`views`), inbound stripe (`webhooks`) and `health`, none of which are
   * useful as agent tools.
   */
  skipTags?: ReadonlySet<string>;
  /**
   * Path prefixes to keep. Defaults to `/v1/` — the dashboard's `/app/*`
   * endpoints serve HTMX views, not agent-callable JSON.
   */
  pathPrefixes?: readonly string[];
}

const DEFAULT_OPTS: Required<GenerateOptions> = {
  // `views` = HTMX dashboard endpoints (return HTML with empty schema)
  // `webhooks` = inbound from Stripe — agent-callable doesn't make sense
  // `health` = `/healthz`, no useful tool
  // `auth` = browser-flow OIDC redirects (login / callback / logout); the
  //   MCP authenticates via static bearer token, so these would 302 to a
  //   browser nobody can drive. The one exception (`/v1/auth/me`) is worth
  //   exposing but currently the rest of the tag isn't, so we skip it
  //   wholesale and let a future curated tool wrap `me` if needed.
  skipTags: new Set(["views", "webhooks", "health", "auth"]),
  pathPrefixes: ["/v1/"],
};

const HTTP_METHODS = ["get", "post", "put", "patch", "delete"] as const;
type HttpMethod = (typeof HTTP_METHODS)[number];

/**
 * Top-level entrypoint that walks the spec, builds tools, and groups them
 * by their first tag. The return value is a list of files ready to be
 * written; callers decide where to put them.
 */
export function generateFromSpec(
  spec: OpenAPISpec,
  opts: GenerateOptions = {},
): GeneratedFile[] {
  const merged: Required<GenerateOptions> = {
    skipTags: opts.skipTags ?? DEFAULT_OPTS.skipTags,
    pathPrefixes: opts.pathPrefixes ?? DEFAULT_OPTS.pathPrefixes,
  };

  const byTag = new Map<string, GeneratedTool[]>();

  for (const [path, methods] of Object.entries(spec.paths)) {
    if (!merged.pathPrefixes.some((p) => path.startsWith(p))) continue;
    for (const method of HTTP_METHODS) {
      const op = methods[method];
      if (!op) continue;
      const tags = op.tags ?? ["misc"];
      if (tags.some((t) => merged.skipTags.has(t))) continue;

      // Skip ops whose request body is multipart/form-data only (file
      // uploads). The MCP client speaks JSON; binary upload tools belong
      // outside the auto-generated set.
      const reqContent = op.requestBody?.content;
      if (reqContent && !reqContent["application/json"]) {
        warn(
          `skipping ${method.toUpperCase()} ${path} — only non-JSON content types`,
        );
        continue;
      }

      const tool = buildTool(spec, path, method, op);
      const tag = tags[0]!;
      if (!byTag.has(tag)) byTag.set(tag, []);
      byTag.get(tag)!.push(tool);
    }
  }

  const files: GeneratedFile[] = [];
  const tags = [...byTag.keys()].sort();

  for (const tag of tags) {
    const tools = byTag.get(tag)!.sort((a, b) => a.name.localeCompare(b.name));
    files.push({
      path: `src/tools/generated/${slugTag(tag)}.ts`,
      source: renderTagFile(tag, tools),
    });
  }

  files.push({
    path: "src/tools/generated/index.ts",
    source: renderIndex(tags),
  });

  return files;
}

// ─── Tool building ──────────────────────────────────────────────────────────

interface GeneratedTool {
  name: string;
  description: string;
  /** Lines of `key: zodExpr,` for the inputShape literal. */
  inputShapeEntries: string[];
  /** JS expression that builds the URL path with template substitution. */
  pathExpr: string;
  /** Lowercase HTTP method. */
  method: HttpMethod;
  /** Body destructuring if a request body exists. */
  hasBody: boolean;
  /** Names of path params (for destructuring + URL substitution). */
  pathParams: string[];
}

function buildTool(
  spec: OpenAPISpec,
  path: string,
  method: HttpMethod,
  op: OpenAPIOperation,
): GeneratedTool {
  const name = deriveName(op, method, path);
  const description = (op.summary ?? op.description ?? name).split("\n")[0]!.trim();

  const inputShapeEntries: string[] = [];
  const pathParams: string[] = [];

  for (const p of op.parameters ?? []) {
    if (p.in !== "path") continue;
    pathParams.push(p.name);
    const zod = paramToZod(p.schema, p.required ?? true, p.description);
    inputShapeEntries.push(`    ${safeKey(p.name)}: ${zod},`);
  }

  let hasBody = false;
  const bodySchema =
    op.requestBody?.content?.["application/json"]?.schema ?? null;
  if (bodySchema) {
    hasBody = true;
    const resolved = resolveSchema(bodySchema, spec);
    const bodyRequired = new Set(resolved.required ?? []);
    if (resolved.properties) {
      for (const [propName, propSchema] of Object.entries(resolved.properties)) {
        const zod = schemaToZod(propSchema, bodyRequired.has(propName), spec);
        inputShapeEntries.push(`    ${safeKey(propName)}: ${zod},`);
      }
    }
  }

  return {
    name,
    description: cleanForJsString(description),
    inputShapeEntries,
    pathExpr: pathToTemplate(path),
    method,
    hasBody,
    pathParams,
  };
}

/**
 * FastAPI auto-derives `operationId` like
 * `update_workspace_v1_workspaces__workspace_id__patch`. We strip the
 * `_v1_..._{method}` suffix (everything from the first `_v1_`) to recover
 * the clean human form (`update_workspace`). If no suffix is found we keep
 * the operationId verbatim. Falls back to `<method>_<segments>` if absent.
 */
function deriveName(
  op: OpenAPIOperation,
  method: HttpMethod,
  path: string,
): string {
  const tag = (op.tags ?? [])[0];
  if (op.operationId) {
    const idx = op.operationId.indexOf("_v1_");
    const cleaned = idx > 0 ? op.operationId.slice(0, idx) : op.operationId;
    let name = toSnake(cleaned);
    // If FastAPI gave us a one-word handler name (`checkout`, `portal`,
    // `get_state`, `me`), it's too generic to be globally meaningful as an
    // MCP tool name. Prefix with the tag so it self-describes.
    if (tag && isGenericName(name, tag)) {
      name = `${toSnake(tag)}_${name}`;
    }
    return name;
  }
  const segs = path
    .split("/")
    .filter(Boolean)
    .map((s) => s.replace(/[{}]/g, "").replace(/-/g, "_"));
  return toSnake(`${method}_${segs.join("_")}`);
}

const GENERIC_VERBS = new Set([
  "checkout",
  "portal",
  "get_state",
  "me",
  "callback",
  "login",
  "logout",
  "view",
  "save",
  "list",
  "create",
  "update",
  "delete",
]);

function isGenericName(name: string, tag: string): boolean {
  if (GENERIC_VERBS.has(name)) return true;
  // Already mentions the tag (e.g. `list_workspaces`, `create_idp`)
  if (name.includes(toSnake(tag))) return false;
  if (name.includes(toSnake(tag).replace(/s$/, ""))) return false;
  // Single-word names without their resource are generic.
  return !name.includes("_");
}

function pathToTemplate(path: string): string {
  // Keep the literal path; substitution happens via JS template literal.
  // `/v1/workspaces/{workspace_id}` → `\`/v1/workspaces/${encodeURIComponent(workspace_id)}\``
  const replaced = path.replace(/\{([^}]+)\}/g, (_, p) => {
    return "${encodeURIComponent(String(" + safeIdent(p) + "))}";
  });
  return "`" + replaced + "`";
}

function paramToZod(
  schema: OpenAPISchema | undefined,
  required: boolean,
  description: string | undefined,
): string {
  const base = schema ? primitiveToZod(schema) : "z.string()";
  let expr = base;
  if (description) expr += `.describe(${JSON.stringify(description)})`;
  if (!required) expr += ".optional()";
  return expr;
}

function primitiveToZod(schema: OpenAPISchema): string {
  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  if (type === "integer" || type === "number") {
    let z = "z.number()";
    if (type === "integer") z += ".int()";
    if (schema.minimum !== undefined) z += `.min(${schema.minimum})`;
    if (schema.maximum !== undefined) z += `.max(${schema.maximum})`;
    return z;
  }
  if (type === "boolean") return "z.boolean()";
  if (type === "string") {
    if (schema.enum && schema.enum.length > 0) {
      const vals = schema.enum
        .filter((v) => typeof v === "string")
        .map((v) => JSON.stringify(v))
        .join(", ");
      return `z.enum([${vals}])`;
    }
    let z = "z.string()";
    if (schema.format === "uri" || schema.format === "url") z += ".url()";
    if (schema.format === "email") z += ".email()";
    if (schema.format === "uuid") z += ".uuid()";
    if (schema.minLength !== undefined) z += `.min(${schema.minLength})`;
    if (schema.maxLength !== undefined) z += `.max(${schema.maxLength})`;
    if (schema.pattern) {
      // Pattern is a string literal; embed as a RegExp.
      z += `.regex(${regexLiteral(schema.pattern)})`;
    }
    return z;
  }
  return "z.any()";
}

function schemaToZod(
  schema: OpenAPISchema,
  required: boolean,
  spec: OpenAPISpec,
): string {
  const resolved = resolveSchema(schema, spec);
  let expr: string;

  // Handle `anyOf [T, null]` — a Pydantic Optional
  if (resolved.anyOf && resolved.anyOf.length > 0) {
    const nonNull = resolved.anyOf.filter((s) => {
      const t = Array.isArray(s.type) ? s.type[0] : s.type;
      return t !== "null";
    });
    const hasNull = resolved.anyOf.length !== nonNull.length;
    if (nonNull.length === 1) {
      expr = schemaToZod(nonNull[0]!, true, spec);
      if (hasNull) expr += ".nullable()";
      // Pydantic's Optional[T] makes the field optional regardless of
      // `required`; we honor `required` from the parent.
    } else {
      // Multi-branch union: fall back to z.any() and warn.
      warn(`anyOf with ${nonNull.length} non-null branches not supported`);
      expr = "z.any()";
    }
  } else if (resolved.type === "array") {
    const itemExpr = resolved.items
      ? schemaToZod(resolved.items, true, spec)
      : "z.any()";
    expr = `z.array(${itemExpr})`;
    if (resolved.description) {
      expr += `.describe(${JSON.stringify(resolved.description)})`;
    }
  } else if (resolved.type === "object" || resolved.properties) {
    if (resolved.properties) {
      const parts: string[] = [];
      const req = new Set(resolved.required ?? []);
      for (const [k, v] of Object.entries(resolved.properties)) {
        parts.push(`${safeKey(k)}: ${schemaToZod(v, req.has(k), spec)}`);
      }
      expr = `z.object({ ${parts.join(", ")} })`;
    } else {
      expr = "z.record(z.any())";
    }
  } else {
    expr = primitiveToZod(resolved);
    if (resolved.description) {
      expr += `.describe(${JSON.stringify(resolved.description)})`;
    }
  }

  if (
    resolved.default !== undefined &&
    typeof resolved.default !== "object"
  ) {
    expr += `.default(${JSON.stringify(resolved.default)})`;
  } else if (!required && !expr.endsWith(".optional()")) {
    expr += ".optional()";
  }

  return expr;
}

function resolveSchema(
  schema: OpenAPISchema,
  spec: OpenAPISpec,
  seen = new Set<string>(),
): OpenAPISchema {
  if (schema.$ref) {
    const ref = schema.$ref;
    if (seen.has(ref)) {
      // Cycle guard — emit untyped record rather than recurse forever.
      return { type: "object" };
    }
    seen.add(ref);
    const m = ref.match(/^#\/components\/schemas\/(.+)$/);
    if (!m) return { type: "object" };
    const target = spec.components?.schemas?.[m[1]!];
    if (!target) return { type: "object" };
    return resolveSchema(target, spec, seen);
  }
  // Resolve nested $refs in allOf inline (FastAPI uses allOf[$ref] for
  // a property that targets another model).
  if (schema.allOf && schema.allOf.length === 1) {
    return resolveSchema(schema.allOf[0]!, spec, seen);
  }
  return schema;
}

// ─── File rendering ─────────────────────────────────────────────────────────

const HEADER = `/**
 * AUTO-GENERATED by scripts/generate-tools.ts. DO NOT EDIT BY HAND.
 *
 * Tools here are 1:1 with REST endpoints from the Prysmid OpenAPI spec.
 * Hand-written / curated tools with the same \`name\` shadow these at
 * registration time (see src/index.ts).
 */
import { z } from "zod";

import { defineTool } from "../registry.js";
`;

function renderTagFile(tag: string, tools: GeneratedTool[]): string {
  const exportName = `generated${pascal(tag)}Tools`;
  const body = tools.map(renderTool).join("\n\n");
  const list = tools.map((t) => "  " + camelVar(t.name)).join(",\n");
  return [
    HEADER,
    body,
    `\nexport const ${exportName} = [\n${list},\n];\n`,
  ].join("\n");
}

function renderIndex(tags: string[]): string {
  const imports = tags
    .map((t) => {
      const slug = slugTag(t);
      return `import { generated${pascal(t)}Tools } from "./${slug}.js";`;
    })
    .join("\n");
  const concat = tags
    .map((t) => `  ...generated${pascal(t)}Tools`)
    .join(",\n");
  return `/**
 * AUTO-GENERATED. Do not edit.
 *
 * Aggregates every tag's generated tools into a single array. The merge with
 * hand-written tools (where hand-written wins on name collision) lives in
 * src/index.ts.
 */
${imports}

export const generatedTools = [
${concat},
];
`;
}

function renderTool(tool: GeneratedTool): string {
  const varName = camelVar(tool.name);
  const allKeys = [
    ...tool.pathParams.map(safeIdent),
    ...(tool.hasBody ? ["__body"] : []),
  ];
  let handlerBody: string;
  if (tool.hasBody && tool.pathParams.length > 0) {
    const destruct = tool.pathParams.map(safeIdent).join(", ");
    handlerBody = `    const { ${destruct}, ...__body } = input;
    return client.request(${tool.pathExpr}, { method: "${tool.method.toUpperCase()}", body: __body });`;
  } else if (tool.hasBody) {
    handlerBody = `    return client.request(${tool.pathExpr}, { method: "${tool.method.toUpperCase()}", body: input });`;
  } else if (tool.pathParams.length > 0) {
    const destruct = tool.pathParams.map(safeIdent).join(", ");
    handlerBody = `    const { ${destruct} } = input;
    return client.request(${tool.pathExpr}, { method: "${tool.method.toUpperCase()}" });`;
  } else {
    handlerBody = `    return client.request(${tool.pathExpr}, { method: "${tool.method.toUpperCase()}" });`;
  }

  // Suppress unused-var warning when `input` is not destructured.
  const handlerSig =
    allKeys.length === 0
      ? "  handler: async (_input, { client }) => {"
      : "  handler: async (input, { client }) => {";

  const inputShape =
    tool.inputShapeEntries.length > 0
      ? `  inputShape: {\n${tool.inputShapeEntries.join("\n")}\n  },`
      : "  inputShape: {},";

  return `export const ${varName} = defineTool({
  name: ${JSON.stringify(tool.name)},
  description: ${JSON.stringify(tool.description)},
${inputShape}
${handlerSig}
${handlerBody}
  },
});`;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function safeKey(name: string): string {
  return /^[a-zA-Z_$][\w$]*$/.test(name) ? name : JSON.stringify(name);
}

function safeIdent(name: string): string {
  // Path params come from OpenAPI and are usually snake_case identifiers
  // already; if they happen to be reserved or contain dashes, fall back to
  // a sanitized name.
  if (/^[a-zA-Z_$][\w$]*$/.test(name)) return name;
  return name.replace(/[^\w$]/g, "_");
}

function toSnake(s: string): string {
  return s
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[-\s]+/g, "_")
    .toLowerCase();
}

function camelVar(snake: string): string {
  const parts = snake.split("_").filter(Boolean);
  return (
    parts[0] +
    parts
      .slice(1)
      .map((p) => p[0]!.toUpperCase() + p.slice(1))
      .join("")
  );
}

function pascal(s: string): string {
  return s
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((p) => p[0]!.toUpperCase() + p.slice(1))
    .join("");
}

function slugTag(tag: string): string {
  return tag.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function regexLiteral(pattern: string): string {
  // Escape forward slashes only (the rest is already JS-regex-compatible).
  const escaped = pattern.replace(/\//g, "\\/");
  return `/${escaped}/`;
}

function cleanForJsString(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function warn(msg: string): void {
  // Always go to stderr — the script's stdout could be redirected.
  process.stderr.write(`[generate-tools] WARN: ${msg}\n`);
}

// ─── CLI entrypoint ─────────────────────────────────────────────────────────

async function fetchSpec(url: string): Promise<OpenAPISpec> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`failed to fetch ${url}: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as OpenAPISpec;
}

async function cli(): Promise<void> {
  const url = process.env.PRYSMID_OPENAPI_URL ?? DEFAULT_SPEC_URL;
  process.stderr.write(`[generate-tools] fetching ${url}\n`);
  const spec = await fetchSpec(url);

  const here = dirname(fileURLToPath(import.meta.url));
  const projectRoot = resolve(here, "..");

  const files = generateFromSpec(spec);
  for (const f of files) {
    const out = resolve(projectRoot, f.path);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, f.source, "utf8");
    process.stderr.write(`[generate-tools] wrote ${f.path}\n`);
  }
  process.stderr.write(
    `[generate-tools] done — ${files.length - 1} tag file(s) + index.ts\n`,
  );
}

// `import.meta.url === file://argv[1]` is unreliable on Windows
// (Hallazgo #34). For a CLI script we'd rather always run when invoked
// directly. Detection trick: if this module is being imported (e.g. by the
// vitest test runner), the importer will have set `process.env.VITEST`.
if (!process.env.VITEST) {
  cli().catch((err) => {
    process.stderr.write(`fatal: ${err instanceof Error ? err.stack : err}\n`);
    process.exit(1);
  });
}
