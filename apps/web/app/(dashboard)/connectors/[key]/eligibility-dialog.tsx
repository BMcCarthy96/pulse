"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiPost } from "@/lib/api-client";
import { toast } from "sonner";

export function EligibilityDialog() {
  const [open, setOpen] = useState(false);
  const [memberId, setMemberId] = useState("MEM-1001");
  const [payerId, setPayerId] = useState("PAYER-1");
  const [pending, setPending] = useState(false);

  async function submit() {
    setPending(true);
    try {
      const res = await apiPost<{ jobId: string }>("/api/v1/eligibility/check", {
        memberId,
        payerId,
      });
      toast.success(
        `Eligibility check queued (job ${res.jobId.slice(-6)}) — see Jobs tab for the result`,
      );
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to run eligibility check");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="outline" />}>
        Run eligibility check
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Run eligibility check</DialogTitle>
          <DialogDescription>
            Submits a 270/271-style request to VerifyMed Eligibility.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="memberId">Member ID</Label>
            <Input id="memberId" value={memberId} onChange={(e) => setMemberId(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="payerId">Payer ID</Label>
            <Input id="payerId" value={payerId} onChange={(e) => setPayerId(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending ? "Submitting..." : "Run check"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
