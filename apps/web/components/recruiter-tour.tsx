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
  version: 2;
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
    description: "Run a bounded, provider-free investigation and inspect its citations.",
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
  return { version: 2, demoSessionId, completed: [], minimized: false };
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
        if (parsed.version === 2 && parsed.demoSessionId === demoSessionId) setState(parsed);
      } catch {
        window.localStorage.removeItem(storageKey);
      }
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
    if (nextStep.id === "overview") {
      setOpen(false);
      if (pathname !== "/") router.push("/");
      else {
        window.setTimeout(() => document.getElementById("demo-overview")?.focus(), 150);
      }
      return;
    }
    if (nextStep.id === "incident") {
      setOpen(false);
      if (incidentId) router.push(`/incidents/${incidentId}#investigation-heading`);
      else router.push("/incidents");
      return;
    }
    const anchor =
      nextStep.id === "investigate"
        ? "investigate"
        : nextStep.id === "approve"
          ? "actions"
          : "audit-trail";
    const focusAnchor = () => {
      const element = document.getElementById(anchor);
      element?.scrollIntoView({ behavior: "smooth", block: "start" });
      if (element instanceof HTMLElement) element.focus({ preventScroll: true });
    };
    setOpen(false);
    if (pathname.startsWith("/incidents/")) window.setTimeout(focusAnchor, 150);
    else if (incidentId) router.push(`/incidents/${incidentId}#${anchor}`);
    else router.push("/incidents");
  }

  function restart() {
    setState(initialState(demoSessionId));
    router.push("/");
    setOpen(true);
  }

  const completed = state.completed.length;
  const currentIndex = nextStep ? TOUR_STEPS.findIndex((step) => step.id === nextStep.id) : -1;
  const shortTitles: Record<RecruiterTourStep, string> = {
    overview: "Review",
    incident: "Incident",
    investigate: "Investigate",
    approve: "Approve",
    audit: "Audit",
  };

  return (
    <>
      <nav
        className="bg-muted/40 hidden items-center gap-1 rounded-full border px-2 py-1 xl:flex"
        aria-label={`Demo journey: ${completed} of ${TOUR_STEPS.length} steps complete`}
      >
        {TOUR_STEPS.map((step, index) => {
          const done = state.completed.includes(step.id);
          const current = currentIndex === index;
          return (
            <span
              key={step.id}
              className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium ${
                current
                  ? "bg-teal-100 text-teal-900"
                  : done
                    ? "text-emerald-700"
                    : "text-muted-foreground"
              }`}
              aria-current={current ? "step" : undefined}
              title={step.title}
            >
              {done ? <Check className="size-3" aria-hidden="true" /> : <span>{index + 1}</span>}
              {shortTitles[step.id]}
            </span>
          );
        })}
      </nav>
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
          <ol
            className="flex-1 space-y-2 overflow-y-auto px-4"
            aria-label="Recruiter tour progress"
          >
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
    </>
  );
}
