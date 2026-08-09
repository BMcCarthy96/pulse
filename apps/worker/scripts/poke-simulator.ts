/**
 * Manual test aid for phase 3 acceptance: hits every simulator endpoint against
 * SIMULATOR_BASE_URL and prints results. Run with:
 *   pnpm --filter @pulse/worker exec tsx --env-file=.env scripts/poke-simulator.ts
 */
const BASE_URL = process.env.SIMULATOR_BASE_URL ?? "http://localhost:4001";

async function main() {
  console.log(`Poking simulator at ${BASE_URL}\n`);

  console.log("== EHR FHIR Patient pagination ==");
  let page = 1;
  let next: string | undefined = `/ehr/fhir/Patient?_page=1&_count=5`;
  let pages = 0;
  while (next && pages < 10) {
    const res = await fetch(`${BASE_URL}${next}`);
    const json = (await res.json()) as { entry?: unknown[]; link?: { next?: string } };
    console.log(
      `  page ${page}: status=${res.status} entries=${json.entry?.length ?? 0} next=${json.link?.next ?? "none"}`,
    );
    next = json.link?.next;
    page++;
    pages++;
  }

  console.log("\n== Claim submission ==");
  const claimRes = await fetch(`${BASE_URL}/clearinghouse/claims`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      patientRef: "PAT-1234",
      payerId: "PAYER-1",
      amountCents: 12000,
      procedureCodes: ["99213"],
    }),
  });
  console.log(`  status=${claimRes.status} body=${JSON.stringify(await claimRes.json())}`);

  console.log("\n== Eligibility check ==");
  const eligRes = await fetch(`${BASE_URL}/eligibility/check`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ memberId: "MEM-1", payerId: "PAYER-1" }),
  });
  console.log(`  status=${eligRes.status} body=${JSON.stringify(await eligRes.json())}`);

  console.log("\n== Labs emit ==");
  const labsRes = await fetch(`${BASE_URL}/labs/emit`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ count: 3 }),
  });
  console.log(`  status=${labsRes.status} body=${JSON.stringify(await labsRes.json())}`);
  console.log(
    "  (webhook delivery attempts logged by the worker process — 404/refused is fine until phase 5)",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
