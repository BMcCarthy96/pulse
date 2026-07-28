import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

/**
 * Smoke test for the hand-written OpenAPI document (doc 04 §OpenAPI).
 *
 * The spec is maintained by hand, so the risk is drift rather than syntax. The second half of
 * this file walks the actual route directory and asserts the two agree in both directions — a
 * new endpoint that never made it into the spec fails here, and so does a documented endpoint
 * that does not exist.
 */

const repoRoot = resolve(__dirname, "../../../..");
const specPath = join(repoRoot, "docs/openapi.yaml");
const apiRoot = join(repoRoot, "apps/web/app/api/v1");

interface Spec {
  openapi: string;
  info: { title: string; version: string };
  paths: Record<string, Record<string, { summary?: string; responses?: unknown }>>;
  components: { schemas: Record<string, unknown>; responses: Record<string, unknown> };
}

const raw = readFileSync(specPath, "utf8");
const spec = parse(raw) as Spec;

const HTTP_METHODS = ["get", "post", "put", "patch", "delete"];

/** Walks `app/api/v1` and turns each `route.ts` into its OpenAPI-style path. */
function discoverRoutes(dir: string, prefix = ""): { path: string; methods: string[] }[] {
  const found: { path: string; methods: string[] }[] = [];

  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);

    if (statSync(full).isDirectory()) {
      // Next's [param] becomes OpenAPI's {param}.
      const segment = entry.startsWith("[") ? `{${entry.slice(1, -1)}}` : entry;
      found.push(...discoverRoutes(full, `${prefix}/${segment}`));
      continue;
    }

    if (entry !== "route.ts") continue;

    const source = readFileSync(full, "utf8");
    const methods = HTTP_METHODS.filter((m) => new RegExp(`export const ${m.toUpperCase()}\\b`).test(source));
    found.push({ path: prefix || "/", methods });
  }

  return found;
}

const routes = discoverRoutes(apiRoot);

describe("openapi.yaml — structure", () => {
  it("parses", () => {
    expect(spec).toBeTypeOf("object");
  });

  it("declares an OpenAPI 3.1 document with title and version", () => {
    expect(spec.openapi).toMatch(/^3\.1/);
    expect(spec.info.title).toBe("Pulse API");
    expect(spec.info.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("gives every operation a summary", () => {
    for (const [path, item] of Object.entries(spec.paths)) {
      for (const method of HTTP_METHODS) {
        const op = item[method];
        if (!op) continue;
        expect(op.summary, `${method.toUpperCase()} ${path} has no summary`).toBeTruthy();
      }
    }
  });

  it("gives every operation at least one response", () => {
    for (const [path, item] of Object.entries(spec.paths)) {
      for (const method of HTTP_METHODS) {
        const op = item[method];
        if (!op) continue;
        expect(Object.keys(op.responses ?? {}).length, `${method.toUpperCase()} ${path}`).toBeGreaterThan(0);
      }
    }
  });

  it("declares the error envelope with the doc-04 code list", () => {
    const envelope = spec.components.schemas.ErrorEnvelope as {
      properties: { error: { properties: { code: { enum: string[] } } } };
    };
    expect(envelope.properties.error.properties.code.enum).toEqual([
      "UNAUTHORIZED",
      "FORBIDDEN",
      "NOT_FOUND",
      "VALIDATION",
      "CONFLICT",
      "INTERNAL",
    ]);
  });

  it("has no dangling $ref targets", () => {
    const refs = [...raw.matchAll(/\$ref:\s*"#\/([^"]+)"/g)].map((m) => m[1]);
    expect(refs.length).toBeGreaterThan(0);

    for (const ref of refs) {
      const resolved = ref.split("/").reduce<unknown>((node, key) => {
        if (node && typeof node === "object") return (node as Record<string, unknown>)[key];
        return undefined;
      }, spec as unknown);
      expect(resolved, `dangling $ref: #/${ref}`).toBeDefined();
    }
  });
});

describe("openapi.yaml — agrees with the implemented routes", () => {
  it("found routes to compare against", () => {
    expect(routes.length).toBeGreaterThan(10);
  });

  it("documents every implemented route", () => {
    const documented = new Set(Object.keys(spec.paths));
    const missing = routes.filter((r) => !documented.has(r.path)).map((r) => r.path);
    expect(missing, "implemented but undocumented").toEqual([]);
  });

  it("documents every method each route implements", () => {
    const problems: string[] = [];
    for (const route of routes) {
      const item = spec.paths[route.path];
      if (!item) continue;
      for (const method of route.methods) {
        if (!item[method]) problems.push(`${method.toUpperCase()} ${route.path}`);
      }
    }
    expect(problems, "implemented but undocumented methods").toEqual([]);
  });

  it("does not document routes that do not exist", () => {
    const implemented = new Set(routes.map((r) => r.path));
    const phantom = Object.keys(spec.paths).filter((p) => !implemented.has(p));
    expect(phantom, "documented but not implemented").toEqual([]);
  });
});
