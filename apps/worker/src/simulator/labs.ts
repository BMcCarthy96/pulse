import { Hono } from "hono";
import { faker } from "@faker-js/faker";
import { applyChaos } from "./chaos.js";
import { emitWebhook } from "./webhooks.js";

const CONNECTOR_KEY = "lab-results";

const PANELS: {
  name: string;
  results: { code: string; name: string; unit: string; range: [number, number] }[];
}[] = [
  {
    name: "Basic Metabolic Panel",
    results: [
      { code: "2345-7", name: "Glucose", unit: "mg/dL", range: [65, 220] },
      { code: "2951-2", name: "Sodium", unit: "mmol/L", range: [130, 150] },
    ],
  },
  {
    name: "CBC",
    results: [
      { code: "6690-2", name: "WBC", unit: "10^3/uL", range: [3, 15] },
      { code: "789-8", name: "RBC", unit: "10^6/uL", range: [3.5, 6] },
    ],
  },
  {
    name: "Lipid Panel",
    results: [
      { code: "2093-3", name: "Total Cholesterol", unit: "mg/dL", range: [120, 260] },
      { code: "2571-8", name: "Triglycerides", unit: "mg/dL", range: [50, 250] },
    ],
  },
];

function labResultPayload() {
  const panel = faker.helpers.arrayElement(PANELS);
  return {
    patientRef: `PAT-${faker.number.int({ min: 1000, max: 9999 })}`,
    orderId: `ORD-${faker.number.int({ min: 100000, max: 999999 })}`,
    panel: panel.name,
    results: panel.results.map((r) => ({
      code: r.code,
      name: r.name,
      value: String(faker.number.int({ min: r.range[0], max: r.range[1] })),
      unit: r.unit,
    })),
    observedAt: new Date().toISOString(),
  };
}

export const labsApp = new Hono();

labsApp.post("/labs/emit", async (c) => {
  const chaos = await applyChaos(CONNECTOR_KEY, c);
  if (chaos.response) return chaos.response;

  const body = await c.req.json().catch(() => ({}) as { count?: number });
  const count = Math.min(Math.max(Number(body.count ?? 1), 1), 50);

  for (let i = 0; i < count; i++) {
    const delayMs = i * faker.number.int({ min: 200, max: 800 });
    setTimeout(() => {
      void emitWebhook(CONNECTOR_KEY, "lab.result.created", labResultPayload());
    }, delayMs);
  }

  return c.json({ scheduled: count });
});
