import { beforeEach, describe, expect, it, vi } from "vitest";

const db = {
  incident: { findFirst: vi.fn() },
  user: { findMany: vi.fn() },
  logEntry: { findMany: vi.fn() },
  job: { findMany: vi.fn() },
  healthSnapshot: { findMany: vi.fn() },
  incidentTimelineEntry: { findMany: vi.fn() },
  integrationEvent: { findMany: vi.fn() },
};

vi.mock("@pulse/db", () => ({ prisma: db }));

const { executeCopilotTool, loadCopilotScope } = await import("@/lib/copilot");

const openedAt = new Date("2026-08-01T10:00:00.000Z");

beforeEach(() => {
  vi.clearAllMocks();
  db.incident.findFirst.mockResolvedValue({
    id: "inc-1",
    orgId: "org-1",
    connectorId: "conn-1",
    openedAt,
    resolvedAt: null,
    title: "EHR sync incident",
    severity: "CRITICAL",
    status: "OPEN",
    detectionSource: "health-engine",
    connector: { id: "conn-1", key: "ehr-fhir", displayName: "EHR", kind: "poll_sync" },
  });
  db.user.findMany.mockResolvedValue([{ id: "user-1", name: "Dana Alvarez" }]);
  db.logEntry.findMany.mockResolvedValue([]);
  db.job.findMany.mockResolvedValue([]);
  db.healthSnapshot.findMany.mockResolvedValue([]);
  db.incidentTimelineEntry.findMany.mockResolvedValue([]);
  db.integrationEvent.findMany.mockResolvedValue([]);
});

describe("copilot query boundary", () => {
  it("loads only an organization-owned incident and redacts tool rows", async () => {
    const scope = await loadCopilotScope("inc-1", "org-1");
    expect(scope?.knownIdentifiers).toContain("conn-1");
    db.logEntry.findMany.mockResolvedValue([
      {
        level: "ERROR",
        source: "sync",
        message: "failed for PAT-42",
        context: { patientRef: "PAT-42" },
        createdAt: openedAt,
      },
    ]);
    const result = await executeCopilotTool(scope!, "search_logs", { query: "failed" });
    expect(result.summary).toContain("1");
    expect(result.text).not.toContain("PAT-42");
    expect(db.logEntry.findMany.mock.calls[0][0].where.connectorId).toBe("conn-1");
  });

  it("does not allow arbitrary tool names", async () => {
    const scope = await loadCopilotScope("inc-1", "org-1");
    await expect(executeCopilotTool(scope!, "read_database", {})).rejects.toThrow(
      /unknown copilot tool/,
    );
  });
});
