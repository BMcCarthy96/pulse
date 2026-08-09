"use client";

import { useState } from "react";
import { FlaskConical } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { apiPost } from "@/lib/api-client";
import { toast } from "sonner";

const CHAOS_MODES = [
  "HEALTHY",
  "DEGRADED",
  "OUTAGE",
  "TIMEOUT",
  "RATE_LIMIT",
  "BAD_PAYLOAD",
  "AUTH_FAILURE",
] as const;

export function ChaosPanel({
  connectorKey,
  currentMode,
  onChanged,
}: {
  connectorKey: string;
  currentMode: string;
  onChanged: () => void;
}) {
  const [selected, setSelected] = useState(currentMode);
  const [failureRate, setFailureRate] = useState(0.4);

  return (
    <Card className="border-amber-300 bg-amber-50/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <FlaskConical className="size-4 text-amber-600" />
          Chaos panel
        </CardTitle>
        <CardDescription>
          Chaos controls the simulated upstream, letting you reproduce failure modes on demand.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label className="mb-2 block text-xs font-medium">Current mode: {currentMode}</Label>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {CHAOS_MODES.map((mode) => (
              <label
                key={mode}
                className="has-[:checked]:border-primary has-[:checked]:bg-primary/5 flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs"
              >
                <input
                  type="radio"
                  name="chaos-mode"
                  value={mode}
                  checked={selected === mode}
                  onChange={() => setSelected(mode)}
                  className="accent-primary"
                />
                {mode}
              </label>
            ))}
          </div>
        </div>

        {selected === "DEGRADED" && (
          <div className="max-w-xs space-y-1">
            <Label className="text-xs">Failure rate ({Math.round(failureRate * 100)}%)</Label>
            <Input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={failureRate}
              onChange={(e) => setFailureRate(Number(e.target.value))}
            />
          </div>
        )}

        <ConfirmDialog
          trigger={
            <Button size="sm" disabled={selected === currentMode}>
              Apply
            </Button>
          }
          title={`Set ${connectorKey} chaos mode to ${selected}?`}
          description={
            <>
              <p>
                This changes the simulated upstream&apos;s behavior for every request until you
                change it back. An audit entry will be recorded:{" "}
                <code className="text-xs">
                  connector.chaos_change {"{"}from: {currentMode}, to: {selected}
                  {"}"}
                </code>
                .
              </p>
            </>
          }
          confirmLabel="Apply chaos mode"
          onConfirm={async () => {
            try {
              await apiPost(`/api/v1/connectors/${connectorKey}/chaos`, {
                mode: selected,
                config: selected === "DEGRADED" ? { failureRate } : undefined,
              });
              toast.success(`${connectorKey} chaos mode set to ${selected}`);
              onChanged();
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "Failed to set chaos mode");
            }
          }}
        />
      </CardContent>
    </Card>
  );
}
