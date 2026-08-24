import { beforeEach, describe, expect, it, vi } from "vitest";

const redisMock = vi.hoisted(() => ({
  status: "ready",
  connect: vi.fn<() => Promise<void>>(),
  eval: vi.fn<(...args: unknown[]) => Promise<[number, string]>>(),
  incrbyfloat: vi.fn<(key: string, amount: number) => Promise<string>>(),
}));

vi.mock("ioredis", () => ({
  Redis: class {
    get status() {
      return redisMock.status;
    }

    connect() {
      return redisMock.connect();
    }

    eval(...args: unknown[]) {
      return redisMock.eval(...args);
    }

    incrbyfloat(key: string, amount: number) {
      return redisMock.incrbyfloat(key, amount);
    }
  },
}));

const {
  AiBudgetUnavailableError,
  investigationRunBudgetUsd,
  reserveAiSpend,
  reserveInvestigationSpend,
  settleAiSpend,
  settleInvestigationSpend,
} = await import("../src/ai-budget.js");

beforeEach(() => {
  vi.clearAllMocks();
  redisMock.status = "ready";
  redisMock.connect.mockResolvedValue(undefined);
  redisMock.eval.mockResolvedValue([1, "0.2"]);
  redisMock.incrbyfloat.mockResolvedValue("0.05");
  delete process.env.AI_DAILY_BUDGET_USD;
  delete process.env.AI_INVESTIGATION_MAX_COST_USD;
  delete process.env.AI_INVESTIGATION_DAILY_BUDGET_USD;
});

describe("AI spend reservations", () => {
  it("skips Redis for zero, negative, and non-finite reservations", async () => {
    await expect(reserveAiSpend("org-1", 0)).resolves.toEqual({ allowed: true, reservedUsd: 0 });
    await expect(reserveAiSpend("org-1", -1)).resolves.toEqual({ allowed: true, reservedUsd: 0 });
    await expect(reserveAiSpend("org-1", Number.NaN)).resolves.toEqual({
      allowed: true,
      reservedUsd: 0,
    });
    expect(redisMock.eval).not.toHaveBeenCalled();
  });

  it("returns the atomic Redis decision and normalizes invalid budget settings", async () => {
    redisMock.status = "wait";
    redisMock.connect.mockImplementationOnce(async () => {
      redisMock.status = "ready";
    });
    redisMock.eval.mockResolvedValueOnce([1, "0.125"]).mockResolvedValueOnce([0, "5"]);

    await expect(reserveAiSpend("org-1", 0.125, Number.NaN)).resolves.toEqual({
      allowed: true,
      reservedUsd: 0.125,
      usedUsd: 0.125,
    });
    await expect(reserveAiSpend("org-1", 0.5, 5)).resolves.toEqual({
      allowed: false,
      reservedUsd: 0,
      usedUsd: 5,
    });
    expect(redisMock.eval.mock.calls[0]?.slice(-2)).toEqual(["0.125000", "5.000000"]);
    process.env.AI_DAILY_BUDGET_USD = "invalid";
    await reserveAiSpend("org-1", 0.1);
    expect(redisMock.eval.mock.calls[2]?.at(-1)).toBe("5.000000");
  });

  it("fails closed when reservation storage is unavailable", async () => {
    redisMock.eval.mockRejectedValueOnce(new Error("redis unavailable"));

    await expect(reserveAiSpend("org-1", 0.2)).rejects.toBeInstanceOf(AiBudgetUnavailableError);
  });

  it("settles only the measured delta and keeps refunds best-effort", async () => {
    await settleAiSpend("org-1", 0.2, 0.05);
    expect(redisMock.incrbyfloat).toHaveBeenCalledWith(expect.stringContaining("org-1"), -0.15);

    redisMock.incrbyfloat.mockRejectedValueOnce(new Error("redis unavailable"));
    await expect(settleAiSpend("org-1", 0.2, 0.1)).resolves.toBeUndefined();
    await settleAiSpend("org-1", 0.2, 0.2);
    await settleInvestigationSpend(0.2, 0.2);
    expect(redisMock.incrbyfloat).toHaveBeenCalledTimes(2);
  });

  it("caps every investigation reservation at twenty cents", async () => {
    process.env.AI_INVESTIGATION_MAX_COST_USD = "9";
    process.env.AI_INVESTIGATION_DAILY_BUDGET_USD = "2";

    expect(investigationRunBudgetUsd()).toBe(0.2);
    process.env.AI_INVESTIGATION_MAX_COST_USD = "invalid";
    expect(investigationRunBudgetUsd()).toBe(0.2);
    process.env.AI_INVESTIGATION_MAX_COST_USD = "9";
    await reserveInvestigationSpend();
    expect(redisMock.eval).toHaveBeenCalledWith(
      expect.any(String),
      1,
      expect.stringContaining("deployment:investigation"),
      "0.200000",
      "2.000000",
    );
  });
});
