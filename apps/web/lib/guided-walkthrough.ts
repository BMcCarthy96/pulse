export type WalkthroughStepId =
  | "open-incident"
  | "run-investigation"
  | "open-citation"
  | "open-actions"
  | "open-approval"
  | "confirm-approval"
  | "review-audit";

export type WalkthroughPhase = "Incident" | "Evidence" | "Approval" | "Audit";
export type WalkthroughStatus = "active" | "paused" | "complete";
export type WalkthroughPlacement = "top" | "right" | "bottom" | "left";

export type WalkthroughStep = {
  id: WalkthroughStepId;
  target: string;
  phase: WalkthroughPhase;
  title: string;
  description: string;
  placement: WalkthroughPlacement;
  incidentRoute?: boolean;
};

export const WALKTHROUGH_STEPS: readonly WalkthroughStep[] = [
  {
    id: "open-incident",
    target: "open-incident",
    phase: "Incident",
    title: "Start with the failed sync",
    description:
      "The EHR connector is down, one job is dead, and an incident is already open. Open it to see what happened.",
    placement: "bottom",
  },
  {
    id: "run-investigation",
    target: "run-first-signal",
    phase: "Evidence",
    title: "Check the first signal",
    description:
      "This looks for the earliest useful clue in the incident evidence. Run it and watch the report fill in.",
    placement: "bottom",
    incidentRoute: true,
  },
  {
    id: "open-citation",
    target: "open-first-citation",
    phase: "Evidence",
    title: "Open the source",
    description:
      "Each finding points back to the records it used. Open this citation to see the evidence behind the claim.",
    placement: "bottom",
    incidentRoute: true,
  },
  {
    id: "open-actions",
    target: "open-actions",
    phase: "Evidence",
    title: "See the suggested next step",
    description: "The report found a retry that is safe to review. Open Actions to look at it.",
    placement: "bottom",
    incidentRoute: true,
  },
  {
    id: "open-approval",
    target: "open-retry-approval",
    phase: "Approval",
    title: "Review the retry",
    description:
      "The retry has not run yet. Open the approval screen to check the target and expected result.",
    placement: "left",
    incidentRoute: true,
  },
  {
    id: "confirm-approval",
    target: "confirm-retry-approval",
    phase: "Approval",
    title: "Approve as the operator",
    description:
      "Pulse checks the target again before it queues the retry. Your approval and the result will be recorded.",
    placement: "top",
    incidentRoute: true,
  },
  {
    id: "review-audit",
    target: "review-audit",
    phase: "Audit",
    title: "The action is recorded",
    description:
      "The retry succeeded. The audit shows who approved it, what ran, and when it happened.",
    placement: "left",
    incidentRoute: true,
  },
] as const;

export const WALKTHROUGH_PHASES: readonly WalkthroughPhase[] = [
  "Incident",
  "Evidence",
  "Approval",
  "Audit",
] as const;

export type WalkthroughState = {
  version: 3;
  demoSessionId: string;
  stepIndex: number;
  status: WalkthroughStatus;
};

export function createWalkthroughState(demoSessionId: string): WalkthroughState {
  return { version: 3, demoSessionId, stepIndex: 0, status: "active" };
}

export type WalkthroughAction =
  | { type: "complete-step"; step: WalkthroughStepId }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "finish" };

export function reduceWalkthroughState(
  state: WalkthroughState,
  action: WalkthroughAction,
): WalkthroughState {
  if (action.type === "pause") {
    return state.status === "active" ? { ...state, status: "paused" } : state;
  }
  if (action.type === "resume") {
    return state.status === "complete" ? state : { ...state, status: "active" };
  }
  if (action.type === "finish") {
    return WALKTHROUGH_STEPS[state.stepIndex]?.id === "review-audit"
      ? { ...state, status: "complete" }
      : state;
  }
  if (state.status === "complete") return state;
  if (WALKTHROUGH_STEPS[state.stepIndex]?.id !== action.step) return state;
  return {
    ...state,
    stepIndex: Math.min(state.stepIndex + 1, WALKTHROUGH_STEPS.length - 1),
  };
}

export function matchesWalkthroughRoute(step: WalkthroughStep, pathname: string) {
  return step.incidentRoute ? pathname.startsWith("/incidents/") : pathname === "/";
}

export function walkthroughScrollBehavior(reducedMotion: boolean): ScrollBehavior {
  return reducedMotion ? "auto" : "smooth";
}

type RectLike = {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
};

export function calculateWalkthroughPosition({
  target,
  callout,
  viewport,
  preferred,
}: {
  target: RectLike;
  callout: { width: number; height: number };
  viewport: { width: number; height: number };
  preferred: WalkthroughPlacement;
}) {
  const margin = 16;
  const gap = 18;
  if (viewport.width < 768) {
    return {
      left: margin,
      top: Math.max(margin, viewport.height - callout.height - margin),
      placement: "bottom" as WalkthroughPlacement,
    };
  }

  const candidates = [
    ...new Set<WalkthroughPlacement>([preferred, "bottom", "right", "left", "top"]),
  ];

  function raw(placement: WalkthroughPlacement) {
    if (placement === "top") {
      return {
        left: target.left + target.width / 2 - callout.width / 2,
        top: target.top - callout.height - gap,
      };
    }
    if (placement === "right") {
      return {
        left: target.right + gap,
        top: target.top + target.height / 2 - callout.height / 2,
      };
    }
    if (placement === "left") {
      return {
        left: target.left - callout.width - gap,
        top: target.top + target.height / 2 - callout.height / 2,
      };
    }
    return {
      left: target.left + target.width / 2 - callout.width / 2,
      top: target.bottom + gap,
    };
  }

  const chosen =
    candidates.find((placement) => {
      const position = raw(placement);
      return (
        position.left >= margin &&
        position.top >= margin &&
        position.left + callout.width <= viewport.width - margin &&
        position.top + callout.height <= viewport.height - margin
      );
    }) ?? preferred;
  const position = raw(chosen);
  return {
    left: Math.min(
      Math.max(position.left, margin),
      Math.max(margin, viewport.width - callout.width - margin),
    ),
    top: Math.min(
      Math.max(position.top, margin),
      Math.max(margin, viewport.height - callout.height - margin),
    ),
    placement: chosen,
  };
}
