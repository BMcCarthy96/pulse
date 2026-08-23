"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { ArrowRight, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

export function DemoEntryButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function enter() {
    setBusy(true);
    setError(null);
    try {
      const result = await signIn("demo", { demo: "1", redirect: false });
      if (result?.error) {
        setError(
          result.url?.includes("demo_capacity")
            ? "The interactive demo is at capacity. Use the guided path and engineering proof below."
            : result.url?.includes("demo_rate_limit")
              ? "This network has created several demos recently. Please try again later."
              : "The interactive workspace is temporarily unavailable. Please use the walkthrough below.",
        );
        return;
      }
      router.push("/");
      router.refresh();
    } catch {
      setError(
        "The interactive workspace is temporarily unavailable. Please use the walkthrough below.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <Button size="lg" disabled={busy} onClick={() => void enter()} className="w-full sm:w-auto">
        {busy ? <LoaderCircle className="animate-spin" /> : null}
        {busy ? "Preparing isolated workspace…" : "Launch interactive demo"}
        {!busy && <ArrowRight />}
      </Button>
      {error && (
        <p role="alert" className="max-w-xl text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
