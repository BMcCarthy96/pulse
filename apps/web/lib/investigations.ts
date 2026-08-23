import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { prisma, type Prisma } from "@pulse/db";
import {
  ApiError,
  InvestigationReportAiSchema,
  INVESTIGATION_PROMPT_V3,
  INVESTIGATION_PROMPT_VERSION,
  GUIDED_INVESTIGATION_QUESTIONS,
  MODEL_PRICING_VERSION,
  MONITORING_ENTRY_SUFFIX,
  findLeakedIdentifiers,
  getHealthConfig,
  investigationReportSchema,
  redact,
  type InvestigationMode,
  type InvestigationReport,
  type InvestigationStreamEvent,
  type InvestigationActionType,
} from "@pulse/shared";
import { currentTraceId, costOf } from "@pulse/shared";
import {
  AiBudgetUnavailableError,
  investigationRunBudgetUsd,
  reserveInvestigationSpend,
  settleInvestigationSpend,
} from "@pulse/shared/ai-budget";
import { enqueueSummaryRun } from "./ai-runs";
import { writeAudit } from "./audit";
import { queueByName } from "./queue";
import { retryTrackedJob } from "@pulse/shared";

const LIVE_MODEL =
  process.env.ANTHROPIC_INVESTIGATION_MODEL ?? process.env.ANTHROPIC_MODEL ?? "claude-opus-4-8";
const AI_ENABLED = process.env.AI_ENABLED === "true";
const LIVE_ENABLED = process.env.INVESTIGATION_LIVE_ENABLED === "true";

type EvidenceDraft = {
  kind: "LOG" | "JOB" | "EVENT" | "HEALTH_SNAPSHOT" | "TIMELINE";
  sourceId: string;
  label: string;
  excerpt: string;
  href?: string;
  observedAt?: Date;
  metadata?: Prisma.InputJsonValue;
};

function redactExcerpt(value: string, knownNames: string[] = []) {
  return redact(value.replaceAll(/\s+/g, " ").trim(), knownNames).slice(0, 600);
}

function actionType(value: string): InvestigationActionType | null {
  if (
    value === "RETRY_JOB" ||
    value === "ACKNOWLEDGE_INCIDENT" ||
    value === "RESOLVE_INCIDENT" ||
    value === "REGENERATE_SUMMARY"
  )
    return value;
  return null;
}

function questionIsGuided(question: string) {
  return GUIDED_INVESTIGATION_QUESTIONS.find((item) => item.question === question.trim());
}

function liveAvailable() {
  return AI_ENABLED && LIVE_ENABLED && Boolean(process.env.ANTHROPIC_API_KEY);
}

export function investigationMode() {
  return liveAvailable() ? "LIVE" : "RECORDED";
}

async function loadEvidence(
  orgId: string,
  incidentId: string,
): Promise<{
  incident: {
    id: string;
    title: string;
    status: string;
    severity: string;
    openedAt: Date;
    connector: { id: string; key: string; displayName: string; kind: string };
  };
  knownNames: string[];
  evidence: EvidenceDraft[];
}> {
  const incident = await prisma.incident.findFirst({
    where: { id: incidentId, orgId },
    include: { connector: { select: { id: true, key: true, displayName: true, kind: true } } },
  });
  if (!incident) throw ApiError.notFound(`incident "${incidentId}" not found`);
  const knownNames = (await prisma.user.findMany({ where: { orgId }, select: { name: true } })).map(
    (user) => user.name,
  );
  const windowEnd = incident.resolvedAt ?? new Date();
  const window = { gte: incident.openedAt, lte: windowEnd };
  const [logs, jobs, events, snapshots, timeline] = await Promise.all([
    prisma.logEntry.findMany({
      where: {
        orgId,
        connectorId: incident.connectorId,
        createdAt: window,
        level: { in: ["WARN", "ERROR"] },
      },
      orderBy: { createdAt: "asc" },
      take: 12,
    }),
    prisma.job.findMany({
      where: {
        orgId,
        connectorId: incident.connectorId,
        createdAt: window,
        status: { in: ["FAILED", "DEAD"] },
      },
      orderBy: { createdAt: "asc" },
      take: 12,
    }),
    prisma.integrationEvent.findMany({
      where: { orgId, connectorId: incident.connectorId, receivedAt: window },
      orderBy: { receivedAt: "asc" },
      take: 10,
    }),
    prisma.healthSnapshot.findMany({
      where: { connectorId: incident.connectorId, connector: { orgId }, createdAt: window },
      orderBy: { createdAt: "asc" },
      take: 12,
    }),
    prisma.incidentTimelineEntry.findMany({
      where: { incidentId },
      orderBy: { createdAt: "asc" },
      take: 20,
    }),
  ]);

  const evidence: EvidenceDraft[] = [
    ...timeline.map((entry) => ({
      kind: "TIMELINE" as const,
      sourceId: entry.id,
      label: `Timeline · ${entry.kind}`,
      excerpt: redactExcerpt(entry.message, knownNames),
      href: `/incidents/${incidentId}#timeline-${entry.id}`,
      observedAt: entry.createdAt,
      metadata: { actor: entry.actor === "system" ? "system" : "operator" },
    })),
    ...logs.map((log) => ({
      kind: "LOG" as const,
      sourceId: log.id,
      label: `${log.level} · ${log.source}`,
      excerpt: redactExcerpt(`${log.message} ${JSON.stringify(log.context)}`, knownNames),
      href: `/logs?connectorKey=${incident.connector.key}&level=${log.level}`,
      observedAt: log.createdAt,
    })),
    ...jobs.map((job) => ({
      kind: "JOB" as const,
      sourceId: job.id,
      label: `${job.status} · ${job.type}`,
      excerpt: redactExcerpt(
        `${job.lastError ?? "job failed"} (${job.attempts}/${job.maxAttempts} attempts)`,
        knownNames,
      ),
      href: `/jobs?connectorKey=${incident.connector.key}&status=${job.status}`,
      observedAt: job.createdAt,
      metadata: { status: job.status, attempts: job.attempts },
    })),
    ...events.map((event) => ({
      kind: "EVENT" as const,
      sourceId: event.id,
      label: `${event.direction} · ${event.eventType}`,
      excerpt: redactExcerpt(`${event.status}${event.error ? ` · ${event.error}` : ""}`),
      href: `/events?connectorKey=${incident.connector.key}`,
      observedAt: event.receivedAt,
    })),
    ...snapshots.map((snapshot) => ({
      kind: "HEALTH_SNAPSHOT" as const,
      sourceId: snapshot.id,
      label: `Health · ${snapshot.status}`,
      excerpt: redactExcerpt(
        `${snapshot.status}, error rate ${(snapshot.errorRate * 100).toFixed(1)}%, p95 ${snapshot.p95LatencyMs === null ? "n/a" : `${snapshot.p95LatencyMs}ms`}`,
        knownNames,
      ),
      href: `/connectors/${incident.connector.key}`,
      observedAt: snapshot.windowEnd,
      metadata: { errorRate: snapshot.errorRate, p95LatencyMs: snapshot.p95LatencyMs },
    })),
  ];
  // The incident itself is a safe synthetic anchor for ACK/RESOLVE/SUMMARY actions.
  evidence.unshift({
    kind: "TIMELINE",
    sourceId: incident.id,
    label: "Incident scope",
    excerpt: redactExcerpt(
      `${incident.title} · ${incident.status} · ${incident.severity}`,
      knownNames,
    ),
    href: `/incidents/${incident.id}`,
    observedAt: incident.openedAt,
  });
  return { incident, knownNames, evidence };
}

async function persistEvidence(investigationId: string, drafts: EvidenceDraft[]) {
  for (const draft of drafts) {
    await prisma.investigationEvidence.upsert({
      where: {
        investigationId_kind_sourceId: {
          investigationId,
          kind: draft.kind,
          sourceId: draft.sourceId,
        },
      },
      update: {
        label: draft.label,
        excerpt: draft.excerpt,
        href: draft.href,
        observedAt: draft.observedAt,
        metadata: draft.metadata ?? {},
      },
      create: {
        investigationId,
        kind: draft.kind,
        sourceId: draft.sourceId,
        label: draft.label,
        excerpt: draft.excerpt,
        href: draft.href,
        observedAt: draft.observedAt,
        metadata: draft.metadata ?? {},
      },
    });
  }
  return prisma.investigationEvidence.findMany({
    where: { investigationId },
    orderBy: { createdAt: "asc" },
  });
}

function recordedReport(
  incident: Awaited<ReturnType<typeof loadEvidence>>["incident"],
  evidence: Awaited<ReturnType<typeof persistEvidence>>,
  questionKey: (typeof GUIDED_INVESTIGATION_QUESTIONS)[number]["id"] | undefined,
): InvestigationReport {
  const firstError = evidence
    .filter((item) => item.kind === "LOG" || item.kind === "JOB" || item.kind === "EVENT")
    .sort(
      (left, right) =>
        (left.observedAt?.getTime() ?? Number.MAX_SAFE_INTEGER) -
        (right.observedAt?.getTime() ?? Number.MAX_SAFE_INTEGER),
    )[0];
  const deadJob = evidence.find(
    (item) =>
      item.kind === "JOB" &&
      item.metadata &&
      typeof item.metadata === "object" &&
      (item.metadata as { status?: string }).status === "DEAD",
  );
  const healthSignal = evidence.find(
    (item) => item.kind === "HEALTH_SNAPSHOT" && !item.label.endsWith("HEALTHY"),
  );
  const incidentEvidence = evidence.find((item) => item.sourceId === incident.id) ?? evidence[0];
  const uniqueEvidenceIds = (ids: Array<string | undefined>) =>
    [...new Set(ids.filter((id): id is string => Boolean(id)))].slice(0, 8);
  const support = uniqueEvidenceIds([incidentEvidence?.id, firstError?.id, healthSignal?.id]);
  const impactSupport = uniqueEvidenceIds([
    deadJob?.id,
    firstError?.id,
    healthSignal?.id,
    incidentEvidence?.id,
  ]);
  const independentKinds = (ids: string[]) =>
    new Set(
      ids
        .map((id) => evidence.find((item) => item.id === id))
        .filter((item) => item && item.sourceId !== incident.id)
        .map((item) => item?.kind),
    ).size;
  const recommendedActions: InvestigationReport["recommendedActions"] = [];
  if (deadJob) {
    recommendedActions.push({
      type: "RETRY_JOB",
      targetId: deadJob.sourceId,
      rationale: `${deadJob.label} has exhausted retries and is safe to replay after the failure signal is checked.`,
      evidenceIds: uniqueEvidenceIds([deadJob.id, ...support]),
    });
  }
  if (incident.status === "OPEN") {
    recommendedActions.push({
      type: "ACKNOWLEDGE_INCIDENT",
      targetId: incident.id,
      rationale:
        "Acknowledge ownership while the integration failure is investigated; this does not mutate connector state.",
      evidenceIds: support,
    });
  }
  const firstSignal = firstError
    ? `${firstError.label.toLowerCase()} — ${firstError.excerpt}`
    : "no error-level job, event, or log in the bounded window";
  const summaryByQuestion = {
    "first-signal": `The earliest captured failure signal for ${incident.connector.displayName} is ${firstSignal}. Later evidence is consistent with the incident, but the bounded data does not prove an external root cause.`,
    impact: deadJob
      ? `${incident.connector.displayName} has a DEAD job after retry exhaustion, so the affected integration work remains incomplete until an operator safely replays it.`
      : `${incident.connector.displayName} has failure evidence in the incident window, but the bounded snapshot does not show a DEAD job or prove broader downstream loss.`,
    "next-action": deadJob
      ? `The safest bounded action is to revalidate and retry the DEAD job for ${incident.connector.displayName}; incident ownership can be acknowledged separately.`
      : `No retryable DEAD job is present for ${incident.connector.displayName}. Acknowledge ownership and gather provider or network evidence before changing connector state.`,
  } as const;
  return {
    summary: summaryByQuestion[questionKey ?? "first-signal"] ?? summaryByQuestion["first-signal"],
    hypotheses: [
      {
        statement: firstError
          ? `${firstError.label} is the earliest captured failure signal in this incident's bounded evidence window.`
          : "The bounded evidence window does not contain an error-level job, event, or log yet.",
        confidence: firstError && independentKinds(support) >= 2 ? "high" : "medium",
        evidenceIds: support,
      },
      {
        statement: deadJob
          ? `${deadJob.label} shows that integration work exhausted retries and remains incomplete.`
          : "The bounded evidence set does not show a DEAD job, so retry exhaustion is not established.",
        confidence: deadJob && independentKinds(impactSupport) >= 2 ? "high" : "medium",
        evidenceIds: impactSupport,
      },
    ],
    uncertainty:
      "The evidence cannot distinguish an upstream outage from a deployment or network regression without external provider health data.",
    recommendedActions,
  };
}

/**
 * Models naturally reach for the evidence card id when they recommend an action.
 * The action API intentionally uses the underlying source id instead. Accept the
 * safe, unambiguous evidence-card form and canonicalize it before validation.
 */
export function normalizeInvestigationActionTargets(
  report: InvestigationReport,
  incident: Awaited<ReturnType<typeof loadEvidence>>["incident"],
  evidence: Awaited<ReturnType<typeof persistEvidence>>,
): InvestigationReport {
  const byEvidenceId = new Map(evidence.map((item) => [item.id, item]));
  return {
    ...report,
    recommendedActions: report.recommendedActions.map((action) => {
      const referencedEvidence = byEvidenceId.get(action.targetId);
      if (!referencedEvidence) return action;
      const canTargetJob = action.type === "RETRY_JOB" && referencedEvidence.kind === "JOB";
      const canTargetIncident =
        action.type !== "RETRY_JOB" && referencedEvidence.sourceId === incident.id;
      return canTargetJob || canTargetIncident
        ? { ...action, targetId: referencedEvidence.sourceId }
        : action;
    }),
  };
}

function validateInvestigationReport(
  report: InvestigationReport,
  incident: Awaited<ReturnType<typeof loadEvidence>>["incident"],
  evidence: Awaited<ReturnType<typeof persistEvidence>>,
  knownNames: string[],
) {
  const parsed = investigationReportSchema.safeParse(report);
  if (!parsed.success)
    throw ApiError.conflict("The investigation report failed policy validation.");
  const evidenceById = new Map(evidence.map((item) => [item.id, item]));
  const validCitations = (ids: string[]) => ids.every((id) => evidenceById.has(id));
  if (!parsed.data.hypotheses.every((hypothesis) => validCitations(hypothesis.evidenceIds))) {
    throw ApiError.conflict("The investigation cited evidence outside its bounded snapshot.");
  }
  for (const hypothesis of parsed.data.hypotheses) {
    const citedKinds = new Set(
      hypothesis.evidenceIds
        .map((id) => evidenceById.get(id))
        .filter((item) => item && item.sourceId !== incident.id)
        .map((item) => item?.kind),
    );
    if (hypothesis.confidence === "high" && citedKinds.size < 2) {
      throw ApiError.conflict("High-confidence findings require two independent evidence kinds.");
    }
  }
  for (const action of parsed.data.recommendedActions) {
    if (!validCitations(action.evidenceIds))
      throw ApiError.conflict("The investigation proposed an action with invalid citations.");
    const target = evidence.find((item) => item.sourceId === action.targetId);
    const targetIsIncident = action.targetId === incident.id;
    const validTarget =
      action.type === "RETRY_JOB"
        ? target?.kind === "JOB"
        : targetIsIncident &&
          ["ACKNOWLEDGE_INCIDENT", "RESOLVE_INCIDENT", "REGENERATE_SUMMARY"].includes(action.type);
    if (!validTarget)
      throw ApiError.conflict("The investigation proposed an invalid action target.");
  }
  // Scan prose separately from validated correlation IDs. Incident dates and operational codes
  // are legitimate findings; explicit PHI shapes and tenant-known names still fail closed.
  const reportText = [
    parsed.data.summary,
    parsed.data.uncertainty,
    ...parsed.data.hypotheses.map((item) => item.statement),
    ...parsed.data.recommendedActions.map((item) => item.rationale),
  ].join("\n");
  const leaks = findLeakedIdentifiers(reportText, knownNames, {
    includeAmbiguousMemberIds: false,
    includeBareDates: false,
  });
  if (leaks.length > 0)
    throw ApiError.conflict("The investigation output failed the privacy policy.");
  return parsed.data;
}

async function askLive(context: string): Promise<{
  report: InvestigationReport;
  usage: { input: number; output: number };
  requestId: string | null;
}> {
  const client = new Anthropic({ maxRetries: 0, timeout: 60_000 });
  const response = await client.messages.parse({
    model: LIVE_MODEL,
    max_tokens: 2_000,
    system: INVESTIGATION_PROMPT_V3,
    messages: [{ role: "user", content: context }],
    output_config: { format: zodOutputFormat(InvestigationReportAiSchema) },
  });
  const parsed = investigationReportSchema.safeParse(response.parsed_output);
  if (!parsed.success) throw new Error("investigation response failed schema validation");
  const requestId = typeof response._request_id === "string" ? response._request_id : null;
  return {
    report: parsed.data,
    usage: { input: response.usage.input_tokens, output: response.usage.output_tokens },
    requestId,
  };
}

async function writeActions(
  investigationId: string,
  report: InvestigationReport,
  evidence: Awaited<ReturnType<typeof persistEvidence>>,
) {
  const evidenceIds = new Set(evidence.map((item) => item.id));
  for (const action of report.recommendedActions) {
    const type = actionType(action.type);
    if (
      !type ||
      (!evidenceIds.has(action.targetId) &&
        !evidence.some((item) => item.sourceId === action.targetId))
    )
      continue;
    const citations = action.evidenceIds.filter((id) => evidenceIds.has(id)).slice(0, 8);
    if (citations.length === 0) continue;
    const existing = await prisma.investigationAction.findFirst({
      where: {
        investigationId,
        type,
        targetId: action.targetId,
        status: { in: ["PROPOSED", "EXECUTING"] },
      },
      select: { id: true },
    });
    if (existing) continue;
    await prisma.investigationAction.create({
      data: {
        investigationId,
        type,
        targetId: action.targetId,
        rationale: redact(action.rationale).slice(0, 600),
        evidenceIds: citations,
        payload: {},
      },
    });
  }
}

export async function createInvestigation(args: {
  orgId: string;
  userId: string;
  incidentId: string;
}) {
  const loaded = await loadEvidence(args.orgId, args.incidentId);
  const existing = await prisma.investigation.findFirst({
    where: {
      orgId: args.orgId,
      incidentId: args.incidentId,
      status: { in: ["ACTIVE", "COMPLETED"] },
    },
    orderBy: { updatedAt: "desc" },
    select: { id: true },
  });
  const investigation = existing
    ? await prisma.investigation.findUniqueOrThrow({ where: { id: existing.id } })
    : await prisma.investigation.create({
        data: {
          orgId: args.orgId,
          incidentId: args.incidentId,
          createdById: args.userId,
          title: `Investigation · ${loaded.incident.title}`,
        },
      });
  await persistEvidence(investigation.id, loaded.evidence);
  return getInvestigation(args.orgId, investigation.id);
}

export async function getInvestigation(orgId: string, id: string) {
  const investigation = await prisma.investigation.findFirst({
    where: { id, orgId },
    include: {
      incident: {
        select: {
          id: true,
          title: true,
          status: true,
          severity: true,
          connector: { select: { key: true, displayName: true } },
        },
      },
      evidence: { orderBy: { createdAt: "asc" } },
      actions: { orderBy: { createdAt: "asc" } },
      aiRuns: {
        orderBy: { createdAt: "desc" },
        take: 10,
        select: {
          id: true,
          status: true,
          mode: true,
          model: true,
          promptVersion: true,
          totalInputTokens: true,
          totalOutputTokens: true,
          totalCostUsd: true,
          latencyMs: true,
          traceId: true,
          createdAt: true,
          completedAt: true,
          calls: {
            orderBy: { sequence: "asc" },
            select: {
              sequence: true,
              providerRequestId: true,
              status: true,
              latencyMs: true,
              costUsd: true,
            },
          },
        },
      },
    },
  });
  if (!investigation) throw ApiError.notFound(`investigation "${id}" not found`);
  const actionIds = investigation.actions.map((item) => item.id);
  const audit = actionIds.length
    ? await prisma.auditEntry.findMany({
        where: {
          orgId,
          OR: [
            {
              targetType: "investigation_action",
              targetId: { in: actionIds },
            },
            {
              metadata: {
                path: ["investigationId"],
                equals: id,
              },
            },
          ],
        },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          action: true,
          targetId: true,
          createdAt: true,
          user: { select: { name: true, email: true } },
        },
      })
    : [];
  return { ...investigation, audit };
}

export async function runInvestigation(
  args: {
    orgId: string;
    userId: string;
    investigationId: string;
    question: string;
  },
  onEvent?: (event: InvestigationStreamEvent) => void | Promise<void>,
) {
  const investigation = await prisma.investigation.findFirst({
    where: { id: args.investigationId, orgId: args.orgId },
    include: {
      incident: { include: { connector: true } },
      evidence: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!investigation) throw ApiError.notFound(`investigation "${args.investigationId}" not found`);
  const guided = questionIsGuided(args.question);
  const mode: InvestigationMode = investigationMode();
  if (!guided && mode === "RECORDED") {
    throw ApiError.conflict(
      "Live investigations are unavailable. Choose one of the three deterministic questions.",
    );
  }
  const loaded = await loadEvidence(args.orgId, investigation.incidentId);
  const safeQuestion = redact(args.question.trim(), loaded.knownNames).slice(0, 2_000);
  const evidence = await persistEvidence(investigation.id, loaded.evidence);
  let reservedSpend = 0;
  if (mode === "LIVE") {
    try {
      const reservation = await reserveInvestigationSpend();
      if (!reservation.allowed) {
        throw ApiError.rateLimited(
          86_400,
          "The deployment's daily live investigation budget has been reached.",
        );
      }
      reservedSpend = reservation.reservedUsd;
    } catch (error) {
      if (error instanceof AiBudgetUnavailableError) {
        throw ApiError.rateLimited(60, "AI budget protection is temporarily unavailable.");
      }
      throw error;
    }
  }
  const startedAt = Date.now();
  let run;
  try {
    run = await prisma.$transaction(async (tx) => {
      // Serialize the short claim transaction per investigation. The provider call remains
      // outside the transaction, while concurrent requests see the durable RUNNING row.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${investigation.id}, 0))::text AS "lock"`;
      const activeRun = await tx.aiRun.findFirst({
        where: {
          investigationId: investigation.id,
          kind: "INVESTIGATION",
          status: "RUNNING",
        },
        select: { id: true },
      });
      if (activeRun) throw ApiError.conflict("an investigation run is already in progress");
      return tx.aiRun.create({
        data: {
          orgId: args.orgId,
          incidentId: investigation.incidentId,
          investigationId: investigation.id,
          userId: args.userId,
          kind: "INVESTIGATION",
          mode,
          status: "RUNNING",
          model: mode === "LIVE" ? LIVE_MODEL : "deterministic-demo-v3",
          promptVersion: INVESTIGATION_PROMPT_VERSION,
          question: safeQuestion,
          contextChars: 0,
          traceId: currentTraceId(),
          startedAt: new Date(),
        },
      });
    });
  } catch (error) {
    if (reservedSpend > 0) await settleInvestigationSpend(reservedSpend, 0);
    throw error;
  }
  const eventLog: InvestigationStreamEvent[] = [];
  const emit = async (event: InvestigationStreamEvent) => {
    eventLog.push(event);
    await onEvent?.(event);
  };
  let settledSpend = false;
  let providerDispatched = false;
  let providerRequestId: string | null = null;
  let measuredUsage = { input: 0, output: 0 };
  let measuredCost: number | null = mode === "LIVE" ? null : 0;
  try {
    await emit({
      event: "run.started",
      data: { runId: run.id, mode, promptVersion: INVESTIGATION_PROMPT_VERSION },
    });
    for (const item of evidence) {
      await emit({
        event: "evidence.added",
        data: {
          id: item.id,
          kind: item.kind,
          sourceId: item.sourceId,
          label: item.label,
          excerpt: item.excerpt,
          href: item.href ?? null,
          observedAt: item.observedAt?.toISOString() ?? null,
        },
      });
    }
    await emit({
      event: "tool.started",
      data: { name: "bounded_evidence_query", turn: 1 },
    });
    const context = JSON.stringify({
      incident: {
        id: loaded.incident.id,
        title: redact(loaded.incident.title, loaded.knownNames),
        status: loaded.incident.status,
        severity: loaded.incident.severity,
        connector: {
          key: loaded.incident.connector.key,
          displayName: redact(loaded.incident.connector.displayName, loaded.knownNames),
          kind: loaded.incident.connector.kind,
        },
      },
      question: safeQuestion,
      evidence: evidence.map(({ id, sourceId, kind, label, excerpt, observedAt }) => ({
        id,
        sourceId,
        kind,
        label,
        excerpt,
        observedAt,
      })),
    });
    // Database/source IDs are intentionally present as opaque correlation tokens so the model
    // can cite evidence and target the incident. The privacy boundary is concerned with PHI-like
    // identifiers here; validating those opaque IDs as known identifiers would flag the incident
    // ID that is deliberately included in the structured context.
    const contextLeaks = findLeakedIdentifiers(context, loaded.knownNames);
    if (contextLeaks.length > 0)
      throw ApiError.conflict("Investigation context failed privacy validation.");
    await prisma.aiRun.update({
      where: { id: run.id },
      data: { contextChars: context.length },
    });
    await emit({
      event: "tool.completed",
      data: {
        name: "bounded_evidence_query",
        turn: 1,
        summary: "Loaded redacted logs, jobs, events, health, and timeline evidence.",
        rowCount: evidence.length,
      },
    });
    const providerStartedAt = Date.now();
    let live: Awaited<ReturnType<typeof askLive>> | null = null;
    try {
      providerDispatched = mode === "LIVE";
      live = mode === "LIVE" ? await askLive(context) : null;
      providerRequestId = live?.requestId ?? null;
      const usage = live?.usage ?? { input: 0, output: 0 };
      measuredUsage = usage;
      const providerCost = live
        ? costOf({ inputTokens: usage.input, outputTokens: usage.output }, LIVE_MODEL)
        : 0;
      measuredCost = providerCost;
      if (mode === "LIVE") {
        // Usage is known once the provider returns. Settle immediately so later policy or
        // persistence failures charge measured usage instead of the conservative reservation.
        await settleInvestigationSpend(reservedSpend, providerCost ?? reservedSpend);
        settledSpend = true;
        await prisma.aiCall.create({
          data: {
            runId: run.id,
            sequence: 1,
            attempt: 1,
            providerRequestId,
            model: LIVE_MODEL,
            inputTokens: usage.input,
            outputTokens: usage.output,
            pricingVersion: providerCost === null ? null : MODEL_PRICING_VERSION,
            costUsd: providerCost ?? reservedSpend,
            latencyMs: Date.now() - providerStartedAt,
            status: "OK",
          },
        });
      }
    } catch (error) {
      if (mode === "LIVE") {
        await prisma.aiCall
          .create({
            data: {
              runId: run.id,
              sequence: 1,
              attempt: 1,
              providerRequestId,
              model: LIVE_MODEL,
              latencyMs: Date.now() - providerStartedAt,
              status: error instanceof ApiError ? "REFUSED" : "FAILED",
              errorCode: error instanceof ApiError ? error.code : "PROVIDER_FAILED",
              errorMessage:
                error instanceof Error ? error.message.slice(0, 500) : "provider failed",
            },
          })
          .catch(() => undefined);
      }
      throw error;
    }
    const report = validateInvestigationReport(
      normalizeInvestigationActionTargets(
        live?.report ?? recordedReport(loaded.incident, evidence, guided?.id),
        loaded.incident,
        evidence,
      ),
      loaded.incident,
      evidence,
      loaded.knownNames,
    );
    const usage = live?.usage ?? { input: 0, output: 0 };
    const cost = live
      ? costOf({ inputTokens: usage.input, outputTokens: usage.output }, LIVE_MODEL)
      : 0;
    if (live && cost !== null && cost > investigationRunBudgetUsd()) {
      throw ApiError.conflict("The live investigation exceeded the $0.20 run budget.");
    }
    await writeActions(investigation.id, report, evidence);
    await prisma.investigation.update({
      where: { id: investigation.id },
      data: {
        report: report as unknown as Prisma.InputJsonValue,
        status: "COMPLETED",
        completedAt: new Date(),
      },
    });
    await prisma.aiRun.update({
      where: { id: run.id },
      data: {
        status: "SUCCEEDED",
        answer: report.summary,
        totalInputTokens: usage.input,
        totalOutputTokens: usage.output,
        totalCostUsd: live ? (cost ?? reservedSpend) : 0,
        latencyMs: Date.now() - startedAt,
        completedAt: new Date(),
        toolEvents: { evidenceCount: evidence.length, questionKey: guided?.id ?? null, mode },
      },
    });
    const actions = await prisma.investigationAction.findMany({
      where: { investigationId: investigation.id, status: "PROPOSED" },
      orderBy: { createdAt: "asc" },
    });
    for (const hypothesis of report.hypotheses)
      await emit({ event: "hypothesis.updated", data: hypothesis });
    for (const action of actions)
      await emit({
        event: "action.proposed",
        data: {
          id: action.id,
          type: action.type,
          targetId: action.targetId,
          rationale: action.rationale,
          evidenceIds: action.evidenceIds as string[],
        },
      });
    await emit({ event: "report.completed", data: { summary: report.summary } });
    await emit({ event: "run.completed", data: { runId: run.id, mode } });
    return { runId: run.id, mode, report, events: eventLog };
  } catch (error) {
    if (error instanceof Error && providerRequestId) {
      Object.assign(error, { providerRequestId });
    }
    const policyRefusal = error instanceof ApiError;
    await prisma.aiRun
      .update({
        where: { id: run.id },
        data: {
          status: policyRefusal ? "REFUSED" : "FAILED",
          errorCode: policyRefusal ? error.code : "INVESTIGATION_FAILED",
          errorMessage:
            error instanceof Error ? error.message.slice(0, 500) : "investigation failed",
          totalInputTokens: measuredUsage.input,
          totalOutputTokens: measuredUsage.output,
          totalCostUsd:
            mode === "LIVE" && providerDispatched ? (measuredCost ?? reservedSpend) : measuredCost,
          latencyMs: Date.now() - startedAt,
          completedAt: new Date(),
        },
      })
      .catch(() => undefined);
    throw error;
  } finally {
    if (mode === "LIVE" && reservedSpend > 0 && !settledSpend) {
      await settleInvestigationSpend(reservedSpend, providerDispatched ? reservedSpend : 0).catch(
        () => undefined,
      );
    }
  }
}

export async function approveInvestigationAction(args: {
  orgId: string;
  userId: string;
  investigationId: string;
  actionId: string;
}) {
  const action = await prisma.investigationAction.findFirst({
    where: {
      id: args.actionId,
      investigationId: args.investigationId,
      investigation: { orgId: args.orgId, incident: { orgId: args.orgId } },
    },
    include: { investigation: { include: { incident: { include: { connector: true } } } } },
  });
  if (!action) throw ApiError.notFound(`action "${args.actionId}" not found`);
  if (action.status === "SUCCEEDED") return action;
  if (action.status !== "PROPOSED")
    throw ApiError.conflict(`action is ${action.status.toLowerCase()}`);
  const claimed = await prisma.investigationAction.updateMany({
    where: { id: action.id, status: "PROPOSED" },
    data: { status: "EXECUTING", approvedById: args.userId, approvedAt: new Date() },
  });
  if (claimed.count !== 1)
    throw ApiError.conflict("action was already claimed by another operator");

  try {
    const incident = action.investigation.incident;
    let result: Record<string, unknown> = {};
    let operationalAudit: {
      action: string;
      targetType: string;
      targetId: string;
      metadata: Prisma.InputJsonValue;
    } | null = null;
    if (action.type === "RETRY_JOB") {
      const job = await prisma.job.findFirst({
        where: { id: action.targetId, orgId: args.orgId, connectorId: incident.connectorId },
      });
      if (!job || (job.status !== "DEAD" && job.status !== "FAILED"))
        throw ApiError.conflict("target job is stale; it is no longer retryable");
      result = await retryTrackedJob(prisma, queueByName, job.id);
      operationalAudit = {
        action: "job.retry",
        targetType: "job",
        targetId: job.id,
        metadata: {
          source: "investigation",
          investigationId: action.investigationId,
          previousStatus: job.status,
          result: result as Prisma.InputJsonValue,
        },
      };
    } else if (action.type === "ACKNOWLEDGE_INCIDENT") {
      if (incident.status === "RESOLVED" || incident.status === "ACKNOWLEDGED")
        throw ApiError.conflict("target incident is stale; it is already acknowledged or resolved");
      await prisma.$transaction(async (tx) => {
        await tx.incident.update({
          where: { id: incident.id },
          data: { status: "ACKNOWLEDGED", acknowledgedAt: incident.acknowledgedAt ?? new Date() },
        });
        await tx.incidentTimelineEntry.create({
          data: {
            incidentId: incident.id,
            kind: "status_change",
            message: `Acknowledged from investigation ${action.investigationId}.`,
            actor: args.userId,
          },
        });
      });
      result = { incidentId: incident.id, status: "ACKNOWLEDGED" };
      operationalAudit = {
        action: "incident.acknowledge",
        targetType: "incident",
        targetId: incident.id,
        metadata: {
          source: "investigation",
          investigationId: action.investigationId,
          from: incident.status,
        },
      };
    } else if (action.type === "RESOLVE_INCIDENT") {
      if (incident.status === "RESOLVED")
        throw ApiError.conflict("target incident is stale; it is already resolved");
      if (incident.status !== "MONITORING") {
        throw ApiError.conflict("incident must enter monitoring before it can be resolved");
      }
      if (incident.connector.status !== "HEALTHY") {
        throw ApiError.conflict("connector is not currently healthy");
      }
      const monitoringEntry = await prisma.incidentTimelineEntry.findFirst({
        where: {
          incidentId: incident.id,
          kind: "status_change",
          message: { endsWith: MONITORING_ENTRY_SUFFIX },
        },
        orderBy: { createdAt: "desc" },
      });
      if (!monitoringEntry) {
        throw ApiError.conflict("monitoring stability window has not started");
      }
      const stabilityMinutes = getHealthConfig().monitoringStabilityMinutes;
      const stableForMs = Date.now() - monitoringEntry.createdAt.getTime();
      if (stableForMs < stabilityMinutes * 60_000) {
        throw ApiError.conflict(
          `connector has not completed the ${stabilityMinutes}-minute monitoring window`,
        );
      }
      await prisma.$transaction(async (tx) => {
        await tx.incident.update({
          where: { id: incident.id },
          data: { status: "RESOLVED", resolvedAt: new Date() },
        });
        await tx.incidentTimelineEntry.create({
          data: {
            incidentId: incident.id,
            kind: "status_change",
            message: `Resolved from investigation ${action.investigationId}.`,
            actor: args.userId,
          },
        });
      });
      result = { incidentId: incident.id, status: "RESOLVED" };
      operationalAudit = {
        action: "incident.resolve",
        targetType: "incident",
        targetId: incident.id,
        metadata: {
          source: "investigation",
          investigationId: action.investigationId,
          from: incident.status,
        },
      };
    } else if (action.type === "REGENERATE_SUMMARY") {
      const current = await prisma.incident.findFirst({
        where: { id: incident.id, orgId: args.orgId },
      });
      if (!current || current.aiSummaryStatus === "generating") {
        throw ApiError.conflict("target incident is stale or already generating a summary");
      }
      const activeSummary = await prisma.aiRun.findFirst({
        where: {
          orgId: args.orgId,
          incidentId: current.id,
          kind: "SUMMARY",
          status: { in: ["QUEUED", "RUNNING"] },
        },
        select: { id: true },
      });
      if (activeSummary) throw ApiError.conflict("a summary is already queued for this incident");
      await prisma.incident.update({
        where: { id: current.id },
        data: { aiSummaryStatus: "queued" },
      });
      const queued = await enqueueSummaryRun({
        incidentId: current.id,
        orgId: args.orgId,
        reason: "manual",
      });
      result = { runId: queued.runId, status: "QUEUED" };
      operationalAudit = {
        action: "incident.summary_regenerate",
        targetType: "incident",
        targetId: current.id,
        metadata: {
          source: "investigation",
          investigationId: action.investigationId,
          previousStatus: current.aiSummaryStatus,
          runId: queued.runId,
        },
      };
    }
    const updated = await prisma.investigationAction.update({
      where: { id: action.id },
      data: {
        status: "SUCCEEDED",
        result: result as Prisma.InputJsonValue,
        executedAt: new Date(),
      },
    });
    if (operationalAudit)
      await writeAudit({
        orgId: args.orgId,
        userId: args.userId,
        ...operationalAudit,
      });
    await writeAudit({
      orgId: args.orgId,
      userId: args.userId,
      action: "investigation.action_approved",
      targetType: "investigation_action",
      targetId: action.id,
      metadata: {
        type: action.type,
        targetId: action.targetId,
        result: result as Prisma.InputJsonValue,
      },
    });
    return updated;
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      await prisma.investigationAction.update({
        where: { id: action.id },
        data: { status: "STALE", errorCode: error.code, errorMessage: error.message },
      });
      throw error;
    }
    await prisma.investigationAction
      .update({
        where: { id: action.id },
        data: {
          status: "FAILED",
          errorCode: "ACTION_FAILED",
          errorMessage: error instanceof Error ? error.message.slice(0, 500) : "action failed",
        },
      })
      .catch(() => undefined);
    throw error;
  }
}

export async function dismissInvestigationAction(args: {
  orgId: string;
  userId: string;
  investigationId: string;
  actionId: string;
}) {
  const action = await prisma.investigationAction.findFirst({
    where: {
      id: args.actionId,
      investigationId: args.investigationId,
      investigation: { orgId: args.orgId },
    },
  });
  if (!action) throw ApiError.notFound(`action "${args.actionId}" not found`);
  if (action.status === "DISMISSED") return action;
  if (action.status !== "PROPOSED")
    throw ApiError.conflict(`action is ${action.status.toLowerCase()}`);
  const dismissed = await prisma.investigationAction.updateMany({
    where: { id: action.id, status: "PROPOSED" },
    data: { status: "DISMISSED", approvedById: args.userId, approvedAt: new Date() },
  });
  if (dismissed.count !== 1)
    throw ApiError.conflict("action was already claimed by another operator");
  const result = await prisma.investigationAction.findUniqueOrThrow({ where: { id: action.id } });
  await writeAudit({
    orgId: args.orgId,
    userId: args.userId,
    action: "investigation.action_dismissed",
    targetType: "investigation_action",
    targetId: action.id,
    metadata: { type: action.type, targetId: action.targetId },
  });
  return result;
}

export function initialStreamEvent(
  runId: string,
  mode: InvestigationMode,
): InvestigationStreamEvent {
  return {
    event: "run.started",
    data: { runId, mode, promptVersion: INVESTIGATION_PROMPT_VERSION },
  };
}
