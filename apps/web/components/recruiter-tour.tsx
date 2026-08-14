"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Check, Circle, RotateCcw, Route } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import type { IncidentRow } from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

export type RecruiterTourStep = "overview" | "incident" | "investigate" | "approve" | "audit";

type TourState = {
  version: 1;
  demoSessionId: string;
  completed: RecruiterTourStep[];
  minimized: boolean;
};

const TOUR_EVENT = "pulse:recruiter-tour";
const TOUR_STEPS: { id: RecruiterTourStep; title: string; description: string }[] = [
  {
    id: "overview",
    title: "Review the overview",
    description: "See the affected connector, dead job, and open incident.",
  },
  {
    id: "incident",
    title: "Open the EHR incident",
    description: "Enter the bounded investigation workspace.",
  },
  {
    id: "investigate",
    title: "Find the first signal",
    description: "Run the deterministic recorded investigation.",
  },
  {
    id: "approve",
    title: "Approve the retry",
    description: "Exercise the human approval boundary.",
  },
  {
    id: "audit",
    title: "Review the audit",
    description: "Confirm both approval and job retry are recorded.",
  },
];

export function announceRecruiterTourStep(step: RecruiterTourStep | "reset") {
  window.dispatchEvent(new CustomEvent(TOUR_EVENT, { detail: { step } }));
}

function initialState(demoSessionId: string): TourState {
  return { version: 1, demoSessionId, completed: [], minimized: false };
}

export function RecruiterTour({ demoSessionId }: { demoSessionId: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const storageKey = `pulse:recruiter-tour:${demoSessionId}`;
  const [state, setState] = useState<TourState>(() => initialState(demoSessionId));
  const [open, setOpen] = useState(false);
  const [incidentId, setIncidentId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const stored = window.localStorage.getItem(storageKey);
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as TourState;
        if (parsed.version === 1 && parsed.demoSessionId === demoSessionId) setState(parsed);
      } catch {
        window.localStorage.removeItem(storageKey);
      }
    } else {
      setOpen(true);
    }
    setReady(true);
  }, [demoSessionId, storageKey]);

  useEffect(() => {
    if (!ready) return;
    window.localStorage.setItem(storageKey, JSON.stringify(state));
  }, [ready, state, storageKey]);

  const complete = useCallback((step: RecruiterTourStep) => {
    setState((current) =>
      current.completed.includes(step)
        ? current
        : { ...current, completed: [...current.completed, step] },
    );
  }, []);

  useEffect(() => {
    if (pathname === "/") complete("overview");
    if (pathname.startsWith("/incidents/")) complete("incident");
  }, [complete, pathname]);

  useEffect(() => {
    const listener = (event: Event) => {
      const step = (event as CustomEvent<{ step?: RecruiterTourStep | "reset" }>).detail?.step;
      if (step === "reset") {
        const fresh = initialState(demoSessionId);
        setState(fresh);
        window.localStorage.setItem(storageKey, JSON.stringify(fresh));
        setOpen(true);
      } else if (step) {
        complete(step);
      }
    };
    window.addEventListener(TOUR_EVENT, listener);
    return () => window.removeEventListener(TOUR_EVENT, listener);
  }, [complete, demoSessionId, storageKey]);

  useEffect(() => {
    void apiFetch<{ data: IncidentRow[] }>("/api/v1/incidents?status=ACTIVE&limit=1")
      .then((response) => setIncidentId(response.data[0]?.id ?? null))
      .catch(() => setIncidentId(null));
  }, []);

  const nextStep = useMemo(
    () => TOUR_STEPS.find((step) => !state.completed.includes(step.id)),
    [state.completed],
  );

  function goNext() {
    if (!nextStep) {
      setOpen(false);
      return;
    }
    if (nextStep.id === "overview") router.push("/");
    else if (incidentId) router.push(`/incidents/${incidentId}#investigation-heading`);
    else router.push("/incidents");
    if (nextStep.id === "overview" || nextStep.id === "incident") setOpen(false);
  }

  function restart() {
    setState(initialState(demoSessionId));
    router.push("/");
    setOpen(true);
  }

  const completed = state.completed.length;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={<Button size="sm" variant="outline" data-testid="recruiter-tour-button" />}
      >
        <Route /> Tour {completed}/{TOUR_STEPS.length}
      </SheetTrigger>
      <SheetContent side="right" className="sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Recruiter walkthrough</SheetTitle>
          <SheetDescription>
            Follow one incident from detection to an approved and audited operational action.
          </SheetDescription>
        </SheetHeader>
        <ol className="flex-1 space-y-2 overflow-y-auto px-4" aria-label="Recruiter tour progress">
          {TOUR_STEPS.map((step, index) => {
            const done = state.completed.includes(step.id);
            const current = nextStep?.id === step.id;
            return (
              <li
                key={step.id}
                className={`rounded-lg border p-3 ${current ? "border-foreground bg-muted/40" : ""}`}
                aria-current={current ? "step" : undefined}
              >
                <div className="flex gap-3">
                  <span className="mt-0.5" aria-hidden="true">
                    {done ? (
                      <Check className="text-emerald-600" />
                    ) : (
                      <Circle className="text-muted-foreground" />
                    )}
                  </span>
                  <div>
                    <p className="text-sm font-medium">
                      {index + 1}. {step.title}
                    </p>
                    <p className="text-muted-foreground mt-1 text-xs leading-5">
                      {step.description}
                    </p>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
        <SheetFooter>
          <Button onClick={goNext}>
            {nextStep ? `Next: ${nextStep.title}` : "Walkthrough complete"}
          </Button>
          <Button variant="ghost" onClick={restart}>
            <RotateCcw /> Restart tour
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
