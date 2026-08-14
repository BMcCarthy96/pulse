import { Hono } from "hono";
import { faker } from "@faker-js/faker";
import { applyChaos } from "./chaos.js";

const CONNECTOR_KEY = "ehr-fhir";
const PAGE_SIZE_DEFAULT = 15;
const TOTAL_PAGES = 4;

function hashSeed(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (Math.imul(31, h) + input.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}

function patientBundle(page: number, count: number) {
  faker.seed(hashSeed(`ehr-fhir:Patient:${page}`));
  const entry = Array.from({ length: count }, () => ({
    resource: {
      resourceType: "Patient",
      id: `PAT-${faker.number.int({ min: 1000, max: 9999 })}`,
      name: [{ family: faker.person.lastName(), given: [faker.person.firstName()] }],
      birthDate: faker.date.birthdate().toISOString().slice(0, 10),
      gender: faker.helpers.arrayElement(["male", "female", "other"]),
    },
  }));
  return {
    resourceType: "Bundle" as const,
    entry,
    link: page < TOTAL_PAGES ? { next: `/ehr/fhir/Patient?_page=${page + 1}&_count=${count}` } : {},
  };
}

function appointmentBundle(page: number, count: number) {
  faker.seed(hashSeed(`ehr-fhir:Appointment:${page}`));
  const entry = Array.from({ length: count }, () => ({
    resource: {
      resourceType: "Appointment",
      id: `APT-${faker.number.int({ min: 100000, max: 999999 })}`,
      status: faker.helpers.arrayElement(["booked", "fulfilled", "cancelled"]),
      start: faker.date.soon({ days: 14 }).toISOString(),
      participant: [
        { actor: { reference: `Patient/PAT-${faker.number.int({ min: 1000, max: 9999 })}` } },
      ],
    },
  }));
  return {
    resourceType: "Bundle" as const,
    entry,
    link:
      page < TOTAL_PAGES ? { next: `/ehr/fhir/Appointment?_page=${page + 1}&_count=${count}` } : {},
  };
}

export const ehrApp = new Hono();

ehrApp.get("/ehr/fhir/Patient", async (c) => {
  const chaos = await applyChaos(CONNECTOR_KEY, c, { orgId: c.req.header("x-pulse-org-id") });
  if (chaos.response) return chaos.response;

  const page = Number(c.req.query("_page") ?? 1);
  const count = Number(c.req.query("_count") ?? PAGE_SIZE_DEFAULT);

  if (chaos.mode === "BAD_PAYLOAD") {
    return c.json({ resourceType: "Bundle" }); // missing required `entry`
  }
  return c.json(patientBundle(page, count));
});

ehrApp.get("/ehr/fhir/Appointment", async (c) => {
  const chaos = await applyChaos(CONNECTOR_KEY, c, { orgId: c.req.header("x-pulse-org-id") });
  if (chaos.response) return chaos.response;

  const page = Number(c.req.query("_page") ?? 1);
  const count = Number(c.req.query("_count") ?? PAGE_SIZE_DEFAULT);

  if (chaos.mode === "BAD_PAYLOAD") {
    return c.json({ resourceType: "Bundle" });
  }
  return c.json(appointmentBundle(page, count));
});
