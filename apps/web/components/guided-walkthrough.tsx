"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import { Check, Compass, Pause, Play, RotateCcw } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import type { IncidentRow } from "@/lib/types";
import {
  WALKTHROUGH_PHASES,
  WALKTHROUGH_STEPS,
  calculateWalkthroughPosition,
  createWalkthroughState,
  matchesWalkthroughRoute,
  reduceWalkthroughState,
  walkthroughScrollBehavior,
  type WalkthroughPlacement,
  type WalkthroughState,
  type WalkthroughStep,
  type WalkthroughStepId,
} from "@/lib/guided-walkthrough";
import { Button } from "@/components/ui/button";

type WalkthroughContextValue = {
  enabled: boolean;
  ready: boolean;
  state: WalkthroughState | null;
  activeStep: WalkthroughStep | null;
  completeStep: (step: WalkthroughStepId) => void;
  finish: () => void;
  pause: () => void;
  restart: () => void;
  resume: () => void;
};

const EMPTY_CONTEXT: WalkthroughContextValue = {
  enabled: false,
  ready: true,
  state: null,
  activeStep: null,
  completeStep: () => undefined,
  finish: () => undefined,
  pause: () => undefined,
  restart: () => undefined,
  resume: () => undefined,
};

const WalkthroughContext = createContext<WalkthroughContextValue>(EMPTY_CONTEXT);

export function useGuidedWalkthrough() {
  return useContext(WalkthroughContext);
}

export function GuidedWalkthroughProvider({
  demoSessionId,
  children,
}: {
  demoSessionId?: string;
  children: ReactNode;
}) {
  const enabled = Boolean(demoSessionId);
  const pathname = usePathname();
  const router = useRouter();
  const storageKey = demoSessionId ? `pulse:guided-walkthrough:${demoSessionId}` : null;
  const [state, setState] = useState<WalkthroughState | null>(() =>
    demoSessionId ? createWalkthroughState(demoSessionId) : null,
  );
  const [ready, setReady] = useState(!enabled);
  const [incidentId, setIncidentId] = useState<string | null>(null);
  const [targetAttempt, setTargetAttempt] = useState(0);
  const navigationTargetRef = useRef<string | null>(null);

  useEffect(() => {
    if (!demoSessionId || !storageKey) {
      setReady(true);
      return;
    }
    const stored = window.localStorage.getItem(storageKey);
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as WalkthroughState;
        if (
          parsed.version === 3 &&
          parsed.demoSessionId === demoSessionId &&
          parsed.stepIndex >= 0 &&
          parsed.stepIndex < WALKTHROUGH_STEPS.length
        ) {
          setState(parsed);
        } else {
          window.localStorage.removeItem(storageKey);
        }
      } catch {
        window.localStorage.removeItem(storageKey);
      }
    }
    window.localStorage.removeItem(`pulse:recruiter-tour:${demoSessionId}`);
    setReady(true);
  }, [demoSessionId, storageKey]);

  useEffect(() => {
    if (!ready || !storageKey || !state) return;
    window.localStorage.setItem(storageKey, JSON.stringify(state));
  }, [ready, state, storageKey]);

  useEffect(() => {
    if (!enabled) return;
    void apiFetch<{ data: IncidentRow[] }>("/api/v1/incidents?status=ACTIVE&limit=1")
      .then((response) => setIncidentId(response.data[0]?.id ?? null))
      .catch(() => setIncidentId(null));
  }, [enabled]);

  const activeStep =
    state && state.status !== "complete" ? (WALKTHROUGH_STEPS[state.stepIndex] ?? null) : null;

  const completeStep = useCallback((step: WalkthroughStepId) => {
    setState((current) =>
      current ? reduceWalkthroughState(current, { type: "complete-step", step }) : current,
    );
  }, []);

  const pause = useCallback(() => {
    setState((current) => (current ? reduceWalkthroughState(current, { type: "pause" }) : current));
  }, []);

  const restart = useCallback(() => {
    if (!demoSessionId) return;
    setState(createWalkthroughState(demoSessionId));
    setTargetAttempt((current) => current + 1);
    navigationTargetRef.current = "/";
    router.push("/");
  }, [demoSessionId, router]);

  const resume = useCallback(() => {
    if (!state || !demoSessionId) return;
    if (state.status === "complete") {
      restart();
      return;
    }
    const step = WALKTHROUGH_STEPS[state.stepIndex];
    setState((current) =>
      current ? reduceWalkthroughState(current, { type: "resume" }) : current,
    );
    setTargetAttempt((current) => current + 1);
    if (!matchesWalkthroughRoute(step, pathname)) {
      const destination = step.incidentRoute && incidentId ? `/incidents/${incidentId}` : "/";
      navigationTargetRef.current = destination;
      router.push(destination);
    }
  }, [demoSessionId, incidentId, pathname, restart, router, state]);

  const finish = useCallback(() => {
    setState((current) =>
      current ? reduceWalkthroughState(current, { type: "finish" }) : current,
    );
  }, []);

  useEffect(() => {
    if (!ready || !activeStep || state?.status !== "active") return;
    if (matchesWalkthroughRoute(activeStep, pathname)) {
      navigationTargetRef.current = null;
      return;
    }
    // A reset or Resume click can intentionally navigate to the next step's route. Remote
    // database work can make that transition slower than the normal leave-page pause window, so
    // give the requested route time to settle before treating it as an interruption.
    const waitingForNavigation = navigationTargetRef.current !== null;
    const timeout = window.setTimeout(pause, waitingForNavigation ? 10_000 : 1_500);
    return () => window.clearTimeout(timeout);
  }, [activeStep, pathname, pause, ready, state?.status]);

  const value = useMemo<WalkthroughContextValue>(
    () => ({
      enabled,
      ready,
      state,
      activeStep,
      completeStep,
      finish,
      pause,
      restart,
      resume,
    }),
    [activeStep, completeStep, enabled, finish, pause, ready, restart, resume, state],
  );

  return (
    <WalkthroughContext.Provider value={value}>
      {children}
      {enabled && ready && state?.status === "active" && activeStep ? (
        <WalkthroughOverlay
          key={`${activeStep.id}:${targetAttempt}`}
          step={activeStep}
          stepIndex={state.stepIndex}
          onFinish={finish}
          onPause={pause}
          onRestart={restart}
          onRetry={() => setTargetAttempt((current) => current + 1)}
        />
      ) : null}
    </WalkthroughContext.Provider>
  );
}

export function WalkthroughControls() {
  const { enabled, ready, state, activeStep, resume } = useGuidedWalkthrough();
  if (!enabled || !ready || !state) return null;

  const currentPhase = activeStep?.phase ?? "Audit";
  const currentPhaseIndex = WALKTHROUGH_PHASES.indexOf(currentPhase);
  const stepNumber = Math.min(state.stepIndex + 1, WALKTHROUGH_STEPS.length);
  const label =
    state.status === "complete"
      ? "Replay walkthrough"
      : state.status === "paused"
        ? `Resume ${stepNumber}/${WALKTHROUGH_STEPS.length}`
        : `Walkthrough ${stepNumber}/${WALKTHROUGH_STEPS.length}`;

  return (
    <>
      <nav
        className="bg-muted/40 hidden items-center gap-1 rounded-full border px-2 py-1 xl:flex"
        aria-label={`Demo walkthrough: step ${stepNumber} of ${WALKTHROUGH_STEPS.length}`}
      >
        {WALKTHROUGH_PHASES.map((phase, index) => {
          const complete = state.status === "complete" || index < currentPhaseIndex;
          const current = state.status !== "complete" && index === currentPhaseIndex;
          return (
            <span
              key={phase}
              className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium ${
                current
                  ? "bg-teal-100 text-teal-900"
                  : complete
                    ? "text-emerald-700"
                    : "text-muted-foreground"
              }`}
              aria-current={current ? "step" : undefined}
            >
              {complete ? (
                <Check className="size-3" aria-hidden="true" />
              ) : (
                <span>{index + 1}</span>
              )}
              {phase}
            </span>
          );
        })}
      </nav>
      <Button
        size="sm"
        variant="outline"
        data-testid="walkthrough-button"
        onClick={resume}
        title={state.status === "active" ? "Focus the current walkthrough step" : undefined}
      >
        {state.status === "paused" ? (
          <Play />
        ) : state.status === "complete" ? (
          <RotateCcw />
        ) : (
          <Compass />
        )}
        {label}
      </Button>
    </>
  );
}

function WalkthroughOverlay({
  step,
  stepIndex,
  onFinish,
  onPause,
  onRestart,
  onRetry,
}: {
  step: WalkthroughStep;
  stepIndex: number;
  onFinish: () => void;
  onPause: () => void;
  onRestart: () => void;
  onRetry: () => void;
}) {
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const [calloutSize, setCalloutSize] = useState({ width: 340, height: 210 });
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [missing, setMissing] = useState(false);
  const calloutRef = useRef<HTMLElement | null>(null);
  const focusedStepRef = useRef<string | null>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    // A route transition can leave the previous page mounted for a render. Clear the old
    // geometry immediately so the scrim never points at a stale control on the new page.
    setTarget(null);
    setTargetRect(null);
    setViewport({ width: 0, height: 0 });
    setMissing(false);
    if (!matchesWalkthroughRoute(step, pathname)) return;
    let disposed = false;
    let missingTimer = 0;
    const selector = `[data-walkthrough="${step.target}"]`;
    const findTarget = () => {
      if (disposed) return;
      const next = document.querySelector<HTMLElement>(selector);
      if (!next) return;
      window.clearTimeout(missingTimer);
      setMissing(false);
      setTarget(next);
      setTargetRect(next.getBoundingClientRect());
      if (focusedStepRef.current !== step.id) {
        focusedStepRef.current = step.id;
        const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        next.scrollIntoView({
          behavior: walkthroughScrollBehavior(reducedMotion),
          block: window.innerWidth < 768 ? "center" : "center",
          inline: "nearest",
        });
        window.setTimeout(() => next.focus({ preventScroll: true }), reducedMotion ? 0 : 250);
      }
    };

    findTarget();
    const observer = new MutationObserver(findTarget);
    observer.observe(document.body, { childList: true, subtree: true });
    missingTimer = window.setTimeout(() => {
      if (!document.querySelector(selector)) setMissing(true);
    }, 10_000);
    return () => {
      disposed = true;
      observer.disconnect();
      window.clearTimeout(missingTimer);
    };
  }, [pathname, step]);

  useEffect(() => {
    if (!target) return;
    let frame = 0;
    const update = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        setViewport({ width: window.innerWidth, height: window.innerHeight });
        setTargetRect(target.getBoundingClientRect());
      });
    };
    update();
    const resizeObserver = new ResizeObserver(update);
    resizeObserver.observe(target);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [target]);

  useEffect(() => {
    const callout = calloutRef.current;
    if (!callout) return;
    const update = () =>
      setCalloutSize({ width: callout.offsetWidth, height: callout.offsetHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(callout);
    return () => observer.disconnect();
  }, [missing, target]);

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onPause();
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [onPause]);

  useEffect(() => {
    if (!target) return;
    const descriptionId = "guided-walkthrough-description";
    const previous = target.getAttribute("aria-describedby");
    const values = new Set((previous ?? "").split(/\s+/).filter(Boolean));
    values.add(descriptionId);
    target.setAttribute("aria-describedby", [...values].join(" "));
    return () => {
      if (previous) target.setAttribute("aria-describedby", previous);
      else target.removeAttribute("aria-describedby");
    };
  }, [target]);

  if (!mounted) return null;
  if (missing) {
    return createPortal(
      <aside
        ref={calloutRef}
        data-testid="walkthrough-recovery"
        className="bg-popover text-popover-foreground fixed top-1/2 left-1/2 z-[72] w-[min(22rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-xl border p-4 shadow-2xl"
        aria-labelledby="walkthrough-missing-title"
      >
        <p className="text-muted-foreground text-xs font-medium">
          Step {stepIndex + 1} of {WALKTHROUGH_STEPS.length}
        </p>
        <h2 id="walkthrough-missing-title" className="mt-1 font-semibold">
          This step is taking longer than expected
        </h2>
        <p className="text-muted-foreground mt-2 text-sm leading-6">
          The control is not ready yet. You can try again or come back to the start.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button size="sm" onClick={onRetry}>
            Try again
          </Button>
          <Button size="sm" variant="outline" onClick={onRestart}>
            Restart
          </Button>
          <Button size="sm" variant="ghost" onClick={onPause}>
            Explore on your own
          </Button>
        </div>
      </aside>,
      document.body,
    );
  }
  if (!targetRect || viewport.width === 0 || viewport.height === 0) return null;

  const padding = 7;
  const cutout = {
    top: Math.max(0, targetRect.top - padding),
    right: Math.min(viewport.width, targetRect.right + padding),
    bottom: Math.min(viewport.height, targetRect.bottom + padding),
    left: Math.max(0, targetRect.left - padding),
  };
  const position = calculateWalkthroughPosition({
    target: targetRect,
    callout: calloutSize,
    viewport,
    preferred: step.placement,
  });
  const calloutStyle: CSSProperties = {
    left: position.left,
    top: position.top,
    width: Math.min(340, viewport.width - 32),
  };
  const path = `M0 0H${viewport.width}V${viewport.height}H0Z M${cutout.left} ${cutout.top}V${cutout.bottom}H${cutout.right}V${cutout.top}Z`;

  return createPortal(
    <>
      <svg
        className="pointer-events-none fixed inset-0 z-[70] size-full"
        width={viewport.width}
        height={viewport.height}
        aria-hidden="true"
      >
        <path d={path} fill="rgb(2 6 23 / 0.48)" fillRule="evenodd" />
      </svg>
      <div
        className="pointer-events-none fixed z-[71] rounded-lg ring-2 ring-teal-400 ring-offset-2 ring-offset-white motion-safe:animate-pulse"
        aria-hidden="true"
        style={{
          left: cutout.left,
          top: cutout.top,
          width: cutout.right - cutout.left,
          height: cutout.bottom - cutout.top,
        }}
      />
      <aside
        ref={calloutRef}
        data-testid="walkthrough-callout"
        className="bg-popover text-popover-foreground fixed z-[72] rounded-xl border border-teal-200 p-4 shadow-2xl"
        style={calloutStyle}
        aria-labelledby="guided-walkthrough-title"
      >
        <div
          className={`bg-popover pointer-events-none absolute size-3 rotate-45 border-teal-200 ${arrowClasses(position.placement)}`}
          aria-hidden="true"
        />
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-medium text-teal-700">
            Step {stepIndex + 1} of {WALKTHROUGH_STEPS.length} · {step.phase}
          </p>
          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={onPause}>
            <Pause className="size-3.5" /> Pause
          </Button>
        </div>
        <h2 id="guided-walkthrough-title" className="mt-2 font-semibold">
          {step.title}
        </h2>
        <p
          id="guided-walkthrough-description"
          className="text-muted-foreground mt-2 text-sm leading-6"
        >
          {step.description}
        </p>
        {step.id === "review-audit" ? (
          <Button className="mt-4 w-full" size="sm" onClick={onFinish}>
            Finish walkthrough
          </Button>
        ) : (
          <p className="mt-3 text-xs font-medium text-teal-800">
            Use the highlighted control to continue.
          </p>
        )}
      </aside>
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {step.title}. {step.description}
      </div>
    </>,
    document.body,
  );
}

function arrowClasses(placement: WalkthroughPlacement) {
  if (placement === "top") return "-bottom-1.5 left-1/2 -translate-x-1/2 border-r border-b";
  if (placement === "right") return "top-1/2 -left-1.5 -translate-y-1/2 border-b border-l";
  if (placement === "left") return "top-1/2 -right-1.5 -translate-y-1/2 border-t border-r";
  return "-top-1.5 left-1/2 -translate-x-1/2 border-t border-l";
}
