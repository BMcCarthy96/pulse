import { Redis } from "ioredis";

const RESERVE_SCRIPT = `
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
local requested = tonumber(ARGV[1])
local budget = tonumber(ARGV[2])
if current + requested > budget then return {0, current} end
local next = redis.call('INCRBYFLOAT', KEYS[1], requested)
redis.call('EXPIRE', KEYS[1], 172800)
return {1, next}
`;

let redis: Redis | null = null;
let connectPromise: Promise<void> | null = null;

function client() {
  return (redis ??= new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: 1_000,
  }));
}

async function connected() {
  const connection = client();
  if (connection.status === "ready") return connection;
  connectPromise ??= connection.connect().finally(() => {
    connectPromise = null;
  });
  await connectPromise;
  return connection;
}

function key(orgId: string, now = new Date()) {
  return `pulse:ai-budget:${orgId}:${now.toISOString().slice(0, 10)}`;
}

function configuredDailyBudget() {
  const configured = Number(process.env.AI_DAILY_BUDGET_USD ?? "5");
  return Number.isFinite(configured) && configured > 0 ? configured : 5;
}

export class AiBudgetUnavailableError extends Error {
  constructor() {
    super("AI budget storage unavailable");
    this.name = "AiBudgetUnavailableError";
  }
}

export async function reserveAiSpend(
  orgId: string,
  amountUsd: number,
  dailyBudgetUsd = configuredDailyBudget(),
) {
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) return { allowed: true, reservedUsd: 0 };
  const budget = Number.isFinite(dailyBudgetUsd) && dailyBudgetUsd > 0 ? dailyBudgetUsd : 5;
  try {
    const result = (await connected().then((connection) =>
      connection.eval(RESERVE_SCRIPT, 1, key(orgId), amountUsd.toFixed(6), budget.toFixed(6)),
    )) as [number, string];
    return {
      allowed: Number(result[0]) === 1,
      reservedUsd: Number(result[0]) === 1 ? amountUsd : 0,
      usedUsd: Number(result[1]),
    };
  } catch {
    throw new AiBudgetUnavailableError();
  }
}

export async function settleAiSpend(orgId: string, reservedUsd: number, actualUsd: number) {
  const delta = Number((actualUsd - reservedUsd).toFixed(6));
  if (!Number.isFinite(delta) || delta === 0) return;
  try {
    const connection = await connected();
    await connection.incrbyfloat(key(orgId), delta);
  } catch {
    // Settlement is best-effort: the reservation is already fail-closed, and a later daily
    // reservation remains conservative if a refund cannot be written.
  }
}

const INVESTIGATION_BUDGET_SCOPE = "deployment:investigation";
const DEFAULT_INVESTIGATION_RUN_BUDGET_USD = 0.2;

function configuredInvestigationDailyBudget() {
  const configured = Number(process.env.AI_INVESTIGATION_DAILY_BUDGET_USD ?? "5");
  return Number.isFinite(configured) && configured > 0 ? configured : 5;
}

export function investigationRunBudgetUsd() {
  const configured = Number(
    process.env.AI_INVESTIGATION_MAX_COST_USD ?? String(DEFAULT_INVESTIGATION_RUN_BUDGET_USD),
  );
  return Number.isFinite(configured) && configured > 0
    ? Math.min(configured, DEFAULT_INVESTIGATION_RUN_BUDGET_USD)
    : DEFAULT_INVESTIGATION_RUN_BUDGET_USD;
}

/**
 * Reserve the deployment-wide investigation spend before dispatching a live provider call.
 * The reservation is intentionally separate from per-organization AI budgets so demo tenants
 * cannot multiply the global recruiter-safe cap.
 */
export function reserveInvestigationSpend(
  amountUsd = investigationRunBudgetUsd(),
  dailyBudgetUsd = configuredInvestigationDailyBudget(),
) {
  return reserveAiSpend(INVESTIGATION_BUDGET_SCOPE, amountUsd, dailyBudgetUsd);
}

export function settleInvestigationSpend(reservedUsd: number, actualUsd: number) {
  return settleAiSpend(INVESTIGATION_BUDGET_SCOPE, reservedUsd, actualUsd);
}
