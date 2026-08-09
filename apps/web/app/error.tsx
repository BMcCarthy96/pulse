"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function GlobalErrorBoundary({
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
        <h1 className="text-lg font-semibold">Pulse hit an unexpected error</h1>
        <p className="text-muted-foreground text-sm">
          Your data is safe. Try the page again or return to the dashboard.
        </p>
        <Button onClick={() => reset()}>Try again</Button>
      </div>
    </main>
  );
}
