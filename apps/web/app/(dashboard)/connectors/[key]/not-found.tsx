import Link from "next/link";

export default function ConnectorNotFound() {
  return (
    <main className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="space-y-3 text-center">
        <h1 className="text-lg font-semibold">Connector not found</h1>
        <p className="text-muted-foreground text-sm">
          The connector may have been removed or is outside your organization.
        </p>
        <Link href="/connectors" className="text-sm underline">
          Return to connectors
        </Link>
      </div>
    </main>
  );
}
