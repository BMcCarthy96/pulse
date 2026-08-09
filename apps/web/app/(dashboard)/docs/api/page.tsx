import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { flattenOperations, loadOpenApiDocument } from "@/lib/openapi";

export const metadata = { title: "API reference — Pulse" };

// The spec is read from disk at request time; nothing here is worth caching between deploys,
// and a stale API reference is worse than a slightly slower one.
export const dynamic = "force-dynamic";

const METHOD_STYLES: Record<string, string> = {
  GET: "bg-blue-100 text-blue-800 border-blue-200",
  POST: "bg-emerald-100 text-emerald-800 border-emerald-200",
  PATCH: "bg-amber-100 text-amber-800 border-amber-200",
  PUT: "bg-amber-100 text-amber-800 border-amber-200",
  DELETE: "bg-red-100 text-red-800 border-red-200",
};

function MethodChip({ method }: { method: string }) {
  return (
    <span
      className={`inline-block rounded border px-1.5 py-0.5 font-mono text-[11px] font-medium ${
        METHOD_STYLES[method] ?? "border-slate-200 bg-slate-100 text-slate-700"
      }`}
    >
      {method}
    </span>
  );
}

export default async function ApiDocsPage() {
  const doc = await loadOpenApiDocument();
  const operations = flattenOperations(doc);

  const byTag = new Map<string, typeof operations>();
  for (const op of operations) {
    const list = byTag.get(op.tag) ?? [];
    list.push(op);
    byTag.set(op.tag, list);
  }

  const baseUrl = doc.servers?.[0]?.url ?? "/api/v1";

  return (
    <div>
      <PageHeader
        title="API reference"
        description={`${operations.length} endpoints · OpenAPI ${doc.openapi} · version ${doc.info.version}`}
        actions={
          <a
            href="/api/v1/openapi"
            className="text-primary hover:bg-muted rounded-md border px-3 py-1.5 text-sm"
          >
            Download openapi.yaml
          </a>
        }
      />

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-sm font-medium">Conventions</CardTitle>
        </CardHeader>
        <CardContent className="text-muted-foreground space-y-2 text-sm">
          <p>
            Base path <code className="text-foreground font-mono text-xs">{baseUrl}</code>. Every
            route requires a session cookie; roles are ordered VIEWER &lt; OPS &lt; ADMIN, so a
            route marked OPS also accepts ADMIN.
          </p>
          <p>
            Failures return a uniform envelope:{" "}
            <code className="text-foreground font-mono text-xs">
              {'{ "error": { "code": "FORBIDDEN", "message": "OPS role required" } }'}
            </code>
          </p>
          <p>
            List routes are cursor-paginated and return{" "}
            <code className="text-foreground font-mono text-xs">{"{ data, nextCursor }"}</code>.
            Pass <code className="text-foreground font-mono text-xs">?withTotal=1</code> for a total
            count — opt-in, because it costs an extra query.
          </p>
        </CardContent>
      </Card>

      <div className="space-y-6">
        {[...byTag.entries()].map(([tag, ops]) => (
          <Card key={tag}>
            <CardHeader>
              <CardTitle className="text-sm font-medium">{tag}</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <tbody>
                  {ops.map((op) => (
                    <tr key={`${op.method} ${op.path}`} className="border-t align-top">
                      <td className="w-20 px-4 py-3">
                        <MethodChip method={op.method} />
                      </td>
                      <td className="w-72 px-2 py-3 font-mono text-xs">{op.path}</td>
                      <td className="px-4 py-3">
                        <div>{op.summary}</div>
                        {op.description && (
                          <p className="text-muted-foreground mt-1 text-xs whitespace-pre-line">
                            {op.description.trim()}
                          </p>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
