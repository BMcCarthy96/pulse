import { prisma, type ChaosMode, type ConnectorStatus, type Role } from "@pulse/db";

/**
 * Minimal fixtures for integration tests.
 *
 * Deliberately not the demo seed: the seed builds 14 days of history anchored to wall-clock now,
 * which makes any assertion about counts or windows depend on when the suite runs. Tests build
 * exactly the rows they reason about.
 */

export async function createOrg(name = "Lakeview Health Partners") {
  return prisma.organization.create({
    data: { name, slug: `test-${Math.random().toString(36).slice(2, 10)}` },
  });
}

export async function createUser(
  orgId: string,
  over: Partial<{ email: string; name: string; role: Role }> = {},
) {
  return prisma.user.create({
    data: {
      orgId,
      email: over.email ?? `user-${Math.random().toString(36).slice(2, 10)}@lakeviewhealth.example`,
      name: over.name ?? "Dana Alvarez",
      // Not a real hash: no integration test authenticates, and a bcrypt round per fixture is
      // pure wall-clock cost.
      passwordHash: "not-a-real-hash",
      role: over.role ?? "ADMIN",
    },
  });
}

export async function createConnector(
  orgId: string,
  over: Partial<{
    key: string;
    displayName: string;
    kind: string;
    status: ConnectorStatus;
    paused: boolean;
    chaosMode: ChaosMode;
    syncIntervalSec: number | null;
  }> = {},
) {
  return prisma.connector.create({
    data: {
      orgId,
      key: over.key ?? "ehr-fhir",
      displayName: over.displayName ?? "Mercy General EHR (FHIR R4)",
      description: "Appointment and patient demographics sync",
      kind: over.kind ?? "poll_sync",
      status: over.status ?? "HEALTHY",
      paused: over.paused ?? false,
      chaosMode: over.chaosMode ?? "HEALTHY",
      syncIntervalSec: over.syncIntervalSec === undefined ? 300 : over.syncIntervalSec,
    },
  });
}

/**
 * Writes `count` finished jobs whose attempts land inside the health window.
 *
 * `errorHistory` matters: the health engine expands a failed job into one call per *attempt*
 * (doc 03 §4), so a fixture that omits it under-reports failures by a factor of five and any
 * test built on it would assert the wrong thing.
 */
export async function createFailedJobs(
  connectorId: string,
  orgId: string,
  count: number,
  opts: { attempts?: number; minutesAgo?: number; durationMs?: number } = {},
) {
  const attempts = opts.attempts ?? 5;
  const minutesAgo = opts.minutesAgo ?? 2;
  const at = new Date(Date.now() - minutesAgo * 60_000);

  return Promise.all(
    Array.from({ length: count }, () =>
      prisma.job.create({
        data: {
          orgId,
          connectorId,
          queue: "sync",
          type: "sync.page",
          status: "DEAD",
          attempts,
          maxAttempts: attempts,
          payload: { page: 1 },
          lastError: "simulator returned 503",
          errorHistory: Array.from({ length: attempts }, (_, i) => ({
            attempt: i + 1,
            at: new Date(at.getTime() + i * 1000).toISOString(),
            message: "simulator returned 503",
            durationMs: opts.durationMs ?? 120,
          })),
          createdAt: at,
          finishedAt: at,
        },
      }),
    ),
  );
}

export async function createSucceededJobs(
  connectorId: string,
  orgId: string,
  count: number,
  opts: { minutesAgo?: number; durationMs?: number } = {},
) {
  const minutesAgo = opts.minutesAgo ?? 2;
  const at = new Date(Date.now() - minutesAgo * 60_000);

  return Promise.all(
    Array.from({ length: count }, () =>
      prisma.job.create({
        data: {
          orgId,
          connectorId,
          queue: "sync",
          type: "sync.page",
          status: "SUCCEEDED",
          attempts: 1,
          maxAttempts: 5,
          payload: { page: 1 },
          errorHistory: [],
          createdAt: at,
          startedAt: at,
          finishedAt: new Date(at.getTime() + (opts.durationMs ?? 120)),
        },
      }),
    ),
  );
}
