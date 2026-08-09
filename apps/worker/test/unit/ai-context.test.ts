import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `buildIncidentContext` reads from Prisma, so the client is mocked rather than the test needing
 * Postgres — the behaviour under test is what goes *into* the prompt, not how it was queried.
 */

const db = {
  incident: { findUnique: vi.fn() },
  user: { findMany: vi.fn() },
  logEntry: { findMany: vi.fn() },
  job: { findMany: vi.fn() },
  integrationEvent: { findMany: vi.fn() },
};

vi.mock("@pulse/db", () => ({ prisma: db }));

const { buildIncidentContext } = await import("../../src/ai/context.js");

const OPENED_AT = new Date("2026-07-27T14:39:15.310Z");

function connector(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: "conn-1",
    key: "ehr-fhir",
    displayName: "Mercy General EHR (FHIR R4)",
    kind: "EHR",
    description: "Appointment and patient demographics sync",
    ...over,
  };
}

function incident(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: "inc-1",
    connectorId: "conn-1",
    severity: "CRITICAL",
    status: "OPEN",
    detectionSource: "health-engine",
    openedAt: OPENED_AT,
    resolvedAt: null,
    connector: connector(),
    timeline: [],
    ...over,
  };
}

function logRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    createdAt: OPENED_AT,
    level: "ERROR",
    source: "sync.page",
    message: "simulator returned 503",
    context: null,
    ...over,
  };
}

function jobRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    createdAt: OPENED_AT,
    type: "sync.page",
    queue: "sync",
    status: "DEAD",
    attempts: 5,
    maxAttempts: 5,
    lastError: "simulator returned 503",
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.incident.findUnique.mockResolvedValue(incident());
  db.user.findMany.mockResolvedValue([]);
  db.logEntry.findMany.mockResolvedValue([]);
  db.job.findMany.mockResolvedValue([]);
  db.integrationEvent.findMany.mockResolvedValue([]);
});

describe("buildIncidentContext — what reaches the model", () => {
  it("includes the connector, severity, detection source and opened time", async () => {
    const { markdown } = await buildIncidentContext("inc-1");
    expect(markdown).toContain("Mercy General EHR (FHIR R4)");
    expect(markdown).toContain("Severity: CRITICAL");
    expect(markdown).toContain("Detected by: health-engine");
    expect(markdown).toContain(OPENED_AT.toISOString());
  });

  it("throws rather than summarising a missing incident", async () => {
    db.incident.findUnique.mockResolvedValue(null);
    await expect(buildIncidentContext("nope")).rejects.toThrow(/not found/);
  });

  it("omits the resolved line while the incident is still open", async () => {
    const { markdown } = await buildIncidentContext("inc-1");
    expect(markdown).not.toContain("Resolved at:");
  });

  it("includes the resolved line once it is closed", async () => {
    const resolvedAt = new Date("2026-07-27T14:53:30.000Z");
    db.incident.findUnique.mockResolvedValue(incident({ resolvedAt, status: "RESOLVED" }));
    const { markdown } = await buildIncidentContext("inc-1");
    expect(markdown).toContain(`Resolved at: ${resolvedAt.toISOString()}`);
  });
});

describe("buildIncidentContext — chaos mode is never present", () => {
  it("does not query for or emit the chaos mode", async () => {
    db.incident.findUnique.mockResolvedValue(
      incident({ connector: connector({ chaosMode: "OUTAGE", chaosConfig: { failureRate: 1 } }) }),
    );
    db.logEntry.findMany.mockResolvedValue([logRow()]);

    const { markdown } = await buildIncidentContext("inc-1");

    // Chaos mode is the ground-truth answer. Feeding it in would let the model restate the fault
    // injection instead of reasoning from symptoms — the summaries would look brilliant and
    // prove nothing.
    expect(markdown).not.toMatch(/chaos/i);
    expect(markdown).not.toMatch(/OUTAGE|RATE_LIMIT|BAD_PAYLOAD|AUTH_FAILURE/);

    // Belt and braces: the connector select must not even ask for the field.
    const select = db.incident.findUnique.mock.calls[0][0].include.connector.select;
    expect(select).not.toHaveProperty("chaosMode");
    expect(select).not.toHaveProperty("chaosConfig");
  });

  it("still surfaces the symptoms that chaos produces", async () => {
    db.logEntry.findMany.mockResolvedValue([logRow({ message: "simulator returned 503" })]);
    const { markdown } = await buildIncidentContext("inc-1");
    expect(markdown).toContain("503");
  });
});

describe("buildIncidentContext — repeat collapsing", () => {
  it("folds a retry storm into a single counted line", async () => {
    db.logEntry.findMany.mockResolvedValue(Array.from({ length: 34 }, () => logRow()));
    const { markdown } = await buildIncidentContext("inc-1");

    expect(markdown).toContain("(×34)");
    expect(markdown.match(/simulator returned 503/g)).toHaveLength(1);
  });

  it("does not collapse lines that actually differ", async () => {
    db.logEntry.findMany.mockResolvedValue([
      logRow({ message: "simulator returned 503" }),
      logRow({ message: "simulator returned 500" }),
    ]);
    const { markdown } = await buildIncidentContext("inc-1");
    expect(markdown).not.toContain("(×");
    expect(markdown).toContain("503");
    expect(markdown).toContain("500");
  });

  it("only collapses runs that are consecutive", async () => {
    db.logEntry.findMany.mockResolvedValue([
      logRow({ message: "a" }),
      logRow({ message: "a" }),
      logRow({ message: "b" }),
      logRow({ message: "a" }),
    ]);
    const { markdown } = await buildIncidentContext("inc-1");
    expect(markdown).toContain("(×2)");
    expect(markdown.match(/\(×\d+\)/g)).toHaveLength(1);
  });
});

describe("buildIncidentContext — redaction", () => {
  it("redacts identifiers in log messages", async () => {
    db.logEntry.findMany.mockResolvedValue([
      logRow({ message: "failed for PAT-4821 on claim CLM-9" }),
    ]);
    const { markdown } = await buildIncidentContext("inc-1");
    expect(markdown).not.toContain("PAT-4821");
    expect(markdown).toContain("[REDACTED:patient-ref]");
  });

  it("redacts seeded staff names taken from the users table", async () => {
    db.user.findMany.mockResolvedValue([{ name: "Dana Alvarez" }, { name: null }]);
    db.incident.findUnique.mockResolvedValue(
      incident({
        timeline: [
          { createdAt: OPENED_AT, kind: "note", message: "Dana Alvarez acknowledged this" },
        ],
      }),
    );
    const { markdown } = await buildIncidentContext("inc-1");
    expect(markdown).not.toContain("Dana Alvarez");
    expect(markdown).toContain("[REDACTED:name]");
  });

  it("redacts nested JSON in a log context blob", async () => {
    db.logEntry.findMany.mockResolvedValue([logRow({ context: { patientRef: "PAT-1", page: 3 } })]);
    const { markdown } = await buildIncidentContext("inc-1");
    expect(markdown).not.toContain("PAT-1");
    expect(markdown).toContain("page");
  });

  it("preserves operational ISO timestamps", async () => {
    db.logEntry.findMany.mockResolvedValue([logRow()]);
    const { markdown } = await buildIncidentContext("inc-1");
    expect(markdown).toContain(OPENED_AT.toISOString());
    expect(markdown).not.toContain("[REDACTED:dob]");
  });
});

describe("buildIncidentContext — budget", () => {
  it("stays under the cap and reports truncation", async () => {
    // Distinct messages so repeat-collapsing cannot do the shrinking for us.
    db.logEntry.findMany.mockResolvedValue(
      Array.from({ length: 50 }, (_, i) =>
        logRow({ message: `distinct failure ${i} ${"x".repeat(300)}` }),
      ),
    );
    db.job.findMany.mockResolvedValue(
      Array.from({ length: 20 }, (_, i) =>
        jobRow({ lastError: `distinct job error ${i} ${"y".repeat(300)}` }),
      ),
    );

    const { markdown, truncated } = await buildIncidentContext("inc-1");

    expect(truncated).toBe(true);
    expect(markdown.length).toBeLessThanOrEqual(8_000 + 32);
    // The header section is the one thing that must always survive.
    expect(markdown).toContain("# Incident context");
  });

  it("reports no truncation for a small incident", async () => {
    db.logEntry.findMany.mockResolvedValue([logRow()]);
    const { markdown, truncated } = await buildIncidentContext("inc-1");
    expect(truncated).toBe(false);
    expect(markdown.length).toBeLessThan(8_000);
  });

  it("drops later sections before cutting mid-line", async () => {
    db.logEntry.findMany.mockResolvedValue(
      Array.from({ length: 50 }, (_, i) =>
        logRow({ message: `distinct failure ${i} ${"x".repeat(300)}` }),
      ),
    );
    db.integrationEvent.findMany.mockResolvedValue([
      {
        receivedAt: OPENED_AT,
        direction: "INBOUND",
        eventType: "lab.result",
        status: "PROCESSED",
        error: null,
      },
    ]);

    const { markdown } = await buildIncidentContext("inc-1");

    // Events are the least decisive section, so they go before the logs are cut short.
    expect(markdown).not.toContain("Recent integration events");
    expect(markdown).toContain("Recent WARN/ERROR logs");
  });
});

describe("buildIncidentContext — claim rejections", () => {
  it("asks for claim acks only on the clearinghouse connector", async () => {
    await buildIncidentContext("inc-1");
    // EHR incident: one integrationEvent query (recent events), not two.
    expect(db.integrationEvent.findMany).toHaveBeenCalledTimes(1);
  });

  it("adds the claim-ack section for the claims connector", async () => {
    db.incident.findUnique.mockResolvedValue(
      incident({
        connector: connector({ key: "claims", displayName: "ClearPath Clearinghouse (X12 837)" }),
      }),
    );
    db.integrationEvent.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        receivedAt: OPENED_AT,
        payload: { ackStatus: "rejected", reason: "missing prior authorization" },
      },
    ]);

    const { markdown } = await buildIncidentContext("inc-1");

    expect(db.integrationEvent.findMany).toHaveBeenCalledTimes(2);
    expect(markdown).toContain("Clearinghouse claim acknowledgements");
    expect(markdown).toContain("missing prior authorization");
  });
});
