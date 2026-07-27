/**
 * Prints the exact redacted context that would be sent to the Anthropic API for an incident,
 * and fails if any identifier or seeded name survived. This is the phase-8 acceptance check
 * ("the stored context contains zero PAT-/CLM- tokens or seeded names — grep to confirm") in
 * runnable form, and it works without an API key.
 *
 *   pnpm --filter @pulse/worker exec tsx src/scripts/dump-incident-context.ts [incidentId]
 */
import { prisma } from "@pulse/db";
import { buildIncidentContext } from "../ai/context.js";
import { findLeakedIdentifiers } from "../ai/redact.js";

async function main() {
  const arg = process.argv[2];
  const incident = arg
    ? await prisma.incident.findUnique({ where: { id: arg } })
    : await prisma.incident.findFirst({ orderBy: { openedAt: "desc" } });

  if (!incident) {
    console.error("no incident found");
    process.exit(1);
  }

  const { markdown, truncated } = await buildIncidentContext(incident.id);

  console.log("─".repeat(70));
  console.log(markdown);
  console.log("─".repeat(70));
  console.log(`incident: ${incident.id}`);
  console.log(`context:  ${markdown.length} chars${truncated ? " (truncated)" : ""}`);

  const users = await prisma.user.findMany({ select: { name: true } });
  const seededNames = users.map((u) => u.name).filter((n): n is string => !!n);

  const leaks = findLeakedIdentifiers(markdown);
  const nameHits = seededNames.filter((n) => new RegExp(`\\b${n}\\b`, "i").test(markdown));

  console.log(`identifier leaks: ${leaks.length === 0 ? "none" : leaks.join(", ")}`);
  console.log(`seeded-name leaks: ${nameHits.length === 0 ? "none" : nameHits.join(", ")}`);

  await prisma.$disconnect();
  process.exit(leaks.length === 0 && nameHits.length === 0 ? 0 : 1);
}

void main();
