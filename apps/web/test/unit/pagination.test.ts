import { describe, expect, it } from "vitest";
import { paginate } from "@/lib/pagination";

type Row = { id: string; createdAt: Date };
type CursorEntry = {
  createdAt?: Date | { lt?: Date };
  id?: { lt?: string };
};
type FakeWhere = { AND?: Array<{ OR?: CursorEntry[] }> };

function readDateLowerBound(value: unknown) {
  if (typeof value !== "object" || value === null || !("lt" in value)) return undefined;
  const candidate = (value as { lt?: unknown }).lt;
  return candidate instanceof Date ? candidate : undefined;
}

function readStringLowerBound(value: unknown) {
  if (typeof value !== "object" || value === null || !("lt" in value)) return undefined;
  const candidate = (value as { lt?: unknown }).lt;
  return typeof candidate === "string" ? candidate : undefined;
}

function fakeModel(rows: Row[]) {
  return {
    findMany: async (args: { where?: FakeWhere; take: number; cursor?: { id: string } }) => {
      let filtered = [...rows].sort(
        (a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id),
      );
      if (args.cursor) {
        const index = filtered.findIndex((row) => row.id === args.cursor?.id);
        if (index >= 0) filtered = filtered.slice(index + 1);
      }
      const cursor = args.where?.AND?.[1]?.OR;
      if (cursor) {
        const first = cursor[0];
        const second = cursor[1];
        const firstCreatedAt = readDateLowerBound(first?.createdAt);
        const secondCreatedAt = second?.createdAt instanceof Date ? second.createdAt : undefined;
        const secondId = readStringLowerBound(second?.id);
        if (firstCreatedAt && secondCreatedAt && secondId) {
          filtered = filtered.filter(
            (row) =>
              row.createdAt < firstCreatedAt ||
              (row.createdAt.getTime() === secondCreatedAt.getTime() && row.id < secondId),
          );
        }
      }
      return filtered.slice(0, args.take);
    },
    count: async () => rows.length,
  };
}

describe("paginate", () => {
  it("uses the ordered timestamp and id tie-breaker without skipping tied rows", async () => {
    const rows = [
      { id: "a", createdAt: new Date("2026-01-02T00:00:00.000Z") },
      { id: "b", createdAt: new Date("2026-01-02T00:00:00.000Z") },
      { id: "c", createdAt: new Date("2026-01-01T00:00:00.000Z") },
    ];
    const model = fakeModel(rows);
    const first = await paginate(model, {
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      limit: 2,
      cursorField: "createdAt",
      cursorValue: (row) => row.createdAt.toISOString(),
      parseCursorValue: (value) => new Date(value),
    });
    const second = await paginate(model, {
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      limit: 2,
      cursor: first.nextCursor ?? undefined,
      cursorField: "createdAt",
      cursorValue: (row) => row.createdAt.toISOString(),
      parseCursorValue: (value) => new Date(value),
    });

    expect(first.data.map((row) => row.id)).toEqual(["b", "a"]);
    expect(second.data.map((row) => row.id)).toEqual(["c"]);
    expect(new Set([...first.data, ...second.data].map((row) => row.id)).size).toBe(3);
  });

  it("continues from a legacy raw id cursor", async () => {
    const rows = [
      { id: "b", createdAt: new Date("2026-01-02T00:00:00.000Z") },
      { id: "a", createdAt: new Date("2026-01-01T00:00:00.000Z") },
    ];
    const page = await paginate(fakeModel(rows), {
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      limit: 1,
      cursor: "b",
      cursorField: "createdAt",
      cursorValue: (row) => row.createdAt.toISOString(),
      parseCursorValue: (value) => new Date(value),
    });
    expect(page.data.map((row) => row.id)).toEqual(["a"]);
  });

  it("keeps totals independent of the page cursor", async () => {
    const rows = [
      { id: "a", createdAt: new Date("2026-01-02T00:00:00.000Z") },
      { id: "b", createdAt: new Date("2026-01-01T00:00:00.000Z") },
    ];
    const page = await paginate(fakeModel(rows), {
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      limit: 1,
      withTotal: true,
      cursorField: "createdAt",
      cursorValue: (row) => row.createdAt.toISOString(),
      parseCursorValue: (value) => new Date(value),
    });
    expect(page.total).toBe(2);
    expect(page.nextCursor).toBeTruthy();

    const rawIdPage = await paginate(fakeModel(rows), {
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      limit: 1,
    });
    expect(rawIdPage.nextCursor).toBe("a");
    const rawIdNext = await paginate(fakeModel(rows), {
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      limit: 1,
      cursor: rawIdPage.nextCursor ?? undefined,
    });
    expect(rawIdNext.data.map((row) => row.id)).toEqual(["b"]);
  });
});
