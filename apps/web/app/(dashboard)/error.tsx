"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="max-w-md space-y-3 text-center">
        <h1 className="text-lg font-semibold">This dashboard view failed to load</h1>
        <p className="text-muted-foreground text-sm">
          Pulse kept your data safe. Try the view again or use the navigation to continue.
        </p>
        <Button onClick={() => reset()}>Try again</Button>
      </div>
    </main>
  );
}
