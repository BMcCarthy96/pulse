import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma, type Role } from "@pulse/db";
import { createConnector, createOrg, createUser } from "../../../../test/integration/fixtures.js";

/**
 * Route handlers called as functions, with `auth()` mocked to a chosen session.
 *
 * This is where the doc-04 contract is enforced: the role gate is the first line of every
 * mutation, every mutation writes an AuditEntry, and every failure returns the error envelope
 * rather than a bare string. Those are exactly the properties that are easy to drop when adding
 * a route and impossible to notice by hand.
 */

const session = vi.hoisted(() => ({ current: null as null | Record<string, unknown> }));
vi.mock("@/auth", () => ({ auth: async () => session.current }));

const { POST: acknowledgeIncident } = await import("@/app/api/v1/incidents/[id]/acknowledge/route");
const { POST: resolveIncident } = await import("@/app/api/v1/incidents/[id]/resolve/route");
const { POST: addNote } = await import("@/app/api/v1/incidents/[id]/notes/route");
const { POST: retryJob } = await import("@/app/api/v1/jobs/[id]/retry/route");
const { GET: listAudit } = await import("@/app/api/v1/audit/route");
const { GET: listUsers } = await import("@/app/api/v1/users/route");
const { webhookProcessingQueue, syncQueue, claimsSubmitQueue, eligibilityQueue } =
  await import("@/lib/queue");

type Ctx = { params: Promise<Record<string, string>> };
const ctx = (params: Record<string, string>): Ctx => ({ params: Promise.resolve(params) });
const req = (body?: unknown) =>
  new Request("http://localhost:3010/api/v1/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

async function signIn(role: Role) {
  const org = await createOrg();
  const user = await createUser(org.id, { role, name: "Marcus Webb" });
  session.current = {
    user: { id: user.id, orgId: org.id, role, name: user.name, email: user.email },
  };
  return { org, user };
}

function signOut() {
  session.current = null;
}

async function seedIncident(
  orgId: string,
  connectorId: string,
  over: Record<string, unknown> = {},
) {
  return prisma.incident.create({
    data: {
      orgId,
      connectorId,
      severity: "CRITICAL",
      status: "OPEN",
      title: "Mercy General EHR (FHIR R4) is DOWN",
      ...over,
    },
  });
}

beforeEach(() => {
  signOut();
});

afterAll(async () => {
  await Promise.all([
    webhookProcessingQueue.close(),
    syncQueue.close(),
    claimsSubmitQueue.close(),
    eligibilityQueue.close(),
  ]);
});

describe("role gates", () => {
  it("returns the UNAUTHORIZED envelope with no session", async () => {
    const res = await acknowledgeIncident(req(), ctx({ id: "whatever" }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: { code: "UNAUTHORIZED", message: expect.any(String) },
    });
  });

  it("returns the FORBIDDEN envelope for a VIEWER on an OPS route", async () => {
    await signIn("VIEWER");
    const res = await acknowledgeIncident(req(), ctx({ id: "whatever" }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: { code: "FORBIDDEN", message: "OPS role required" },
    });
  });

  it("gates the audit log to ADMIN", async () => {
    await signIn("OPS");
    const res = await listAudit(new Request("http://localhost:3010/api/v1/audit"), ctx({}));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatchObject({
      code: "FORBIDDEN",
      message: "ADMIN role required",
    });
  });

  it("gates the users list to ADMIN", async () => {
    await signIn("OPS");
    const res = await listUsers(new Request("http://localhost:3010/api/v1/users"), ctx({}));
    expect(res.status).toBe(403);
  });

  it("checks the role before the resource exists", async () => {
    // A VIEWER probing for a nonexistent id must get 403, not 404 — otherwise the response
    // discloses which ids exist to someone not allowed to act on them.
    await signIn("VIEWER");
    const res = await retryJob(req(), ctx({ id: "does-not-exist" }));
    expect(res.status).toBe(403);
  });
});

describe("incidents.acknowledge", () => {
  it("acknowledges, writes both timeline entries and audits the change", async () => {
    const { org, user } = await signIn("OPS");
    const connector = await createConnector(org.id);
    const incident = await seedIncident(org.id, connector.id);

    const res = await acknowledgeIncident(req(), ctx({ id: incident.id }));
    expect(res.status).toBe(200);

    const after = await prisma.incident.findUniqueOrThrow({ where: { id: incident.id } });
    expect(after.status).toBe("ACKNOWLEDGED");
    expect(after.acknowledgedAt).toBeInstanceOf(Date);

    const timeline = await prisma.incidentTimelineEntry.findMany({
      where: { incidentId: incident.id },
    });
    expect(timeline.map((t) => t.kind).sort()).toEqual(["note", "status_change"]);
    expect(timeline.every((t) => t.actor === user.id)).toBe(true);

    const audit = await prisma.auditEntry.findFirstOrThrow({});
    expect(audit).toMatchObject({
      action: "incident.acknowledge",
      targetType: "incident",
      targetId: incident.id,
      userId: user.id,
    });
    expect(audit.metadata).toMatchObject({ from: "OPEN" });
  });

  it("409s on an already-acknowledged incident and writes no second audit row", async () => {
    const { org } = await signIn("OPS");
    const connector = await createConnector(org.id);
    const incident = await seedIncident(org.id, connector.id, {
      status: "ACKNOWLEDGED",
      acknowledgedAt: new Date(),
    });

    const res = await acknowledgeIncident(req(), ctx({ id: incident.id }));

    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("CONFLICT");
    expect(await prisma.auditEntry.count()).toBe(0);
  });

  it("409s on a resolved incident", async () => {
    const { org } = await signIn("OPS");
    const connector = await createConnector(org.id);
    const incident = await seedIncident(org.id, connector.id, {
      status: "RESOLVED",
      resolvedAt: new Date(),
    });

    const res = await acknowledgeIncident(req(), ctx({ id: incident.id }));
    expect(res.status).toBe(409);
  });

  it("404s with the NOT_FOUND envelope for an unknown id", async () => {
    await signIn("OPS");
    const res = await acknowledgeIncident(req(), ctx({ id: "no-such-incident" }));
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("NOT_FOUND");
  });
});

describe("incidents.resolve", () => {
  it("resolves an open incident and stamps resolvedAt", async () => {
    const { org } = await signIn("OPS");
    const connector = await createConnector(org.id);
    const incident = await seedIncident(org.id, connector.id);

    const res = await resolveIncident(req({ note: "cleared by hand" }), ctx({ id: incident.id }));
    expect(res.status).toBe(200);

    const after = await prisma.incident.findUniqueOrThrow({ where: { id: incident.id } });
    expect(after.status).toBe("RESOLVED");
    expect(after.resolvedAt).toBeInstanceOf(Date);
    expect(await prisma.auditEntry.count({ where: { action: "incident.resolve" } })).toBe(1);
  });

  it("409s when the incident is already resolved", async () => {
    const { org } = await signIn("OPS");
    const connector = await createConnector(org.id);
    const incident = await seedIncident(org.id, connector.id, {
      status: "RESOLVED",
      resolvedAt: new Date(),
    });

    const res = await resolveIncident(req({}), ctx({ id: incident.id }));
    expect(res.status).toBe(409);
  });
});

describe("incidents.notes — zod validation", () => {
  it("rejects an empty note with the VALIDATION envelope", async () => {
    const { org } = await signIn("OPS");
    const connector = await createConnector(org.id);
    const incident = await seedIncident(org.id, connector.id);

    const res = await addNote(req({ message: "" }), ctx({ id: incident.id }));

    expect(res.status).toBe(400);
    const body = await res.json();
    // doc 04 §Conventions: the code is "VALIDATION", not "VALIDATION_ERROR".
    expect(body.error.code).toBe("VALIDATION");
    expect(await prisma.incidentTimelineEntry.count()).toBe(0);
  });

  it("rejects a missing body field", async () => {
    const { org } = await signIn("OPS");
    const connector = await createConnector(org.id);
    const incident = await seedIncident(org.id, connector.id);

    const res = await addNote(req({}), ctx({ id: incident.id }));
    expect(res.status).toBe(400);
  });

  it("accepts a valid note and records the author", async () => {
    const { org, user } = await signIn("OPS");
    const connector = await createConnector(org.id);
    const incident = await seedIncident(org.id, connector.id);

    const res = await addNote(req({ message: "paged the vendor" }), ctx({ id: incident.id }));
    expect(res.status).toBe(200);

    const note = await prisma.incidentTimelineEntry.findFirstOrThrow({ where: { kind: "note" } });
    expect(note.message).toContain("paged the vendor");
    expect(note.actor).toBe(user.id);
  });
});

describe("jobs.retry", () => {
  async function seedJob(
    orgId: string,
    connectorId: string,
    status: "DEAD" | "SUCCEEDED" | "QUEUED",
  ) {
    return prisma.job.create({
      data: {
        orgId,
        connectorId,
        queue: "sync",
        type: "sync.page",
        status,
        attempts: status === "DEAD" ? 5 : 0,
        maxAttempts: 5,
        payload: { page: 1 },
        lastError: status === "DEAD" ? "simulator returned 503" : null,
        errorHistory:
          status === "DEAD" ? [{ attempt: 1, at: new Date().toISOString(), message: "boom" }] : [],
      },
    });
  }

  it("re-queues a DEAD job and audits it", async () => {
    const { org, user } = await signIn("OPS");
    const connector = await createConnector(org.id);
    const job = await seedJob(org.id, connector.id, "DEAD");

    const res = await retryJob(req(), ctx({ id: job.id }));
    expect(res.status).toBe(200);

    const after = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(after.status).toBe("QUEUED");
    // The retry history is the point of the failed-job queue — it must survive the re-queue.
    expect(Array.isArray(after.errorHistory)).toBe(true);
    expect(after.errorHistory).toHaveLength(1);

    expect(await prisma.auditEntry.findFirstOrThrow({})).toMatchObject({
      action: "job.retry",
      targetId: job.id,
      userId: user.id,
    });
  });

  it("409s when the job is not in a retryable state", async () => {
    const { org } = await signIn("OPS");
    const connector = await createConnector(org.id);
    const job = await seedJob(org.id, connector.id, "SUCCEEDED");

    const res = await retryJob(req(), ctx({ id: job.id }));

    expect(res.status).toBe(409);
    expect((await res.json()).error.message).toContain("SUCCEEDED");
    expect(await prisma.auditEntry.count()).toBe(0);
  });

  it("409s on a QUEUED job rather than double-queueing it", async () => {
    const { org } = await signIn("OPS");
    const connector = await createConnector(org.id);
    const job = await seedJob(org.id, connector.id, "QUEUED");

    expect((await retryJob(req(), ctx({ id: job.id }))).status).toBe(409);
  });
});

describe("admin surfaces", () => {
  it("lets an ADMIN read the audit log", async () => {
    const { org, user } = await signIn("ADMIN");
    await prisma.auditEntry.create({
      data: {
        orgId: org.id,
        userId: user.id,
        action: "chaos.change",
        targetType: "connector",
        targetId: "c1",
      },
    });

    const res = await listAudit(new Request("http://localhost:3010/api/v1/audit"), ctx({}));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.actions).toContain("chaos.change");
  });

  it("never returns a password hash from the users list", async () => {
    const { org } = await signIn("ADMIN");
    await createUser(org.id, { role: "VIEWER", name: "Priya Nair" });

    const res = await listUsers(new Request("http://localhost:3010/api/v1/users"), ctx({}));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain("passwordHash");
    expect(JSON.stringify(body)).not.toContain("not-a-real-hash");
  });
});
