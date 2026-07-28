import { NextResponse } from "next/server";
import { handleApiError, requireSession } from "@/lib/authz";
import { loadOpenApiDocument, readOpenApiYaml } from "@/lib/openapi";

/**
 * Serves the hand-written spec. `?format=json` returns the parsed document (for tooling);
 * anything else returns the YAML source verbatim.
 *
 * Session-gated like the rest of `/api/v1` — the spec describes an authenticated surface, and
 * there is no reason for it to be the one public exception.
 */
export const GET = handleApiError("openapi", async (req) => {
  await requireSession();

  const format = new URL(req.url).searchParams.get("format");

  if (format === "json") {
    return NextResponse.json(await loadOpenApiDocument());
  }

  return new NextResponse(await readOpenApiYaml(), {
    status: 200,
    headers: {
      "content-type": "application/yaml; charset=utf-8",
      "cache-control": "no-store",
    },
  });
});
