import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";

/**
 * Loads the hand-written OpenAPI document from `docs/openapi.yaml`.
 *
 * Read from disk rather than imported so the spec stays a single source of truth that lives with
 * the other docs — the `/docs/api` page and `/api/v1/openapi` both render this one file, and
 * there is no build step that could let them drift apart.
 */

const SPEC_PATH = join(process.cwd(), "..", "..", "docs", "openapi.yaml");

export interface OpenApiOperation {
  summary?: string;
  description?: string;
  tags?: string[];
}

export interface OpenApiDocument {
  openapi: string;
  info: { title: string; version: string; description?: string };
  servers?: { url: string; description?: string }[];
  tags?: { name: string }[];
  paths: Record<string, Record<string, OpenApiOperation>>;
  components?: Record<string, unknown>;
}

export async function readOpenApiYaml(): Promise<string> {
  return readFile(SPEC_PATH, "utf8");
}

export async function loadOpenApiDocument(): Promise<OpenApiDocument> {
  return parse(await readOpenApiYaml()) as OpenApiDocument;
}

const HTTP_METHODS = ["get", "post", "put", "patch", "delete"] as const;

export interface FlatOperation {
  method: string;
  path: string;
  summary: string;
  description?: string;
  tag: string;
}

/** Flattens `paths` into a table-friendly list, in document order. */
export function flattenOperations(doc: OpenApiDocument): FlatOperation[] {
  const out: FlatOperation[] = [];
  for (const [path, item] of Object.entries(doc.paths ?? {})) {
    for (const method of HTTP_METHODS) {
      const operation = item[method];
      if (!operation) continue;
      out.push({
        method: method.toUpperCase(),
        path,
        summary: operation.summary ?? "",
        description: operation.description,
        tag: operation.tags?.[0] ?? "Other",
      });
    }
  }
  return out;
}
