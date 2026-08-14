"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { apiPost } from "@/lib/api-client";
import { toast } from "sonner";
import { announceRecruiterTourStep } from "@/components/recruiter-tour";

export function DemoResetButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function reset() {
    setBusy(true);
    try {
      await apiPost("/api/demo/reset");
      announceRecruiterTourStep("reset");
      toast.success("Demo workspace reset");
      router.push("/");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not reset demo");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Button size="sm" variant="outline" disabled={busy} onClick={() => void reset()}>
      {busy ? "Resetting…" : "Reset demo"}
    </Button>
  );
}
