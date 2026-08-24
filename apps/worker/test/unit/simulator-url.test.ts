import { describe, expect, it } from "vitest";
import { resolveSimulatorBaseUrl } from "../../src/simulator-url.js";

describe("resolveSimulatorBaseUrl", () => {
  it("uses Railway's assigned port when a stale local URL is configured", () => {
    expect(
      resolveSimulatorBaseUrl({ PORT: "8080", SIMULATOR_BASE_URL: "http://localhost:4001" }),
    ).toBe("http://127.0.0.1:8080");
  });

  it("accepts values copied with wrapping quotes", () => {
    expect(
      resolveSimulatorBaseUrl({ PORT: "8080", SIMULATOR_BASE_URL: '"http://localhost:4001"' }),
    ).toBe("http://127.0.0.1:8080");
  });

  it("keeps an explicitly configured non-loopback simulator URL", () => {
    expect(
      resolveSimulatorBaseUrl({
        PORT: "8080",
        SIMULATOR_BASE_URL: "https://simulator.example.test/",
      }),
    ).toBe("https://simulator.example.test/");
  });

  it("uses the local simulator port outside Railway", () => {
    expect(resolveSimulatorBaseUrl({ SIMULATOR_PORT: "4001" })).toBe("http://127.0.0.1:4001");
  });
});
