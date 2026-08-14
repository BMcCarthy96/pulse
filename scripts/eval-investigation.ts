import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { investigationReportSchema } from "../packages/shared/src/investigations.ts";
import { findLeakedIdentifiers } from "../packages/shared/src/redact.ts";

type Fixture = {
  id: string;
  category: string;
  evidenceIds: string[];
  targetIds: string[];
  evidenceText: string[];
  expectedEvidence: string[];
  expectedConfidence: string[];
  forbiddenClaims: string[];
  report: unknown;
};

const root = join(import.meta.dirname, "..");
const fixtures = JSON.parse(
  await readFile(join(root, "evals", "investigation-fixtures.json"), "utf8"),
) as Fixture[];

const failures: string[] = [];
for (const fixture of fixtures) {
  const result = investigationReportSchema.safeParse(fixture.report);
  if (!result.success) {
    failures.push(fixture.id + ": report schema invalid (" + result.error.message + ")");
    continue;
  }

  const cited = new Set([
    ...result.data.hypotheses.flatMap((item) => item.evidenceIds),
    ...result.data.recommendedActions.flatMap((item) => item.evidenceIds),
  ]);
  const evidence = new Set(fixture.evidenceIds);
  for (const id of cited) {
    if (!evidence.has(id))
      failures.push(fixture.id + ": citation " + id + " is outside the evidence set");
  }
  for (const id of fixture.expectedEvidence) {
    if (!cited.has(id)) failures.push(fixture.id + ": required citation " + id + " is missing");
  }
  for (const action of result.data.recommendedActions) {
    if (!fixture.targetIds.includes(action.targetId)) {
      failures.push(
        fixture.id + ": action target " + action.targetId + " is outside the scoped targets",
      );
    }
  }
  if (
    result.data.hypotheses.length > 0 &&
    !result.data.hypotheses.every((item) => fixture.expectedConfidence.includes(item.confidence))
  ) {
    failures.push(fixture.id + ": confidence is not calibrated for its category");
  }

  const output = JSON.stringify(result.data);
  for (const forbidden of fixture.forbiddenClaims) {
    if (output.toLocaleLowerCase().includes(forbidden.toLocaleLowerCase())) {
      failures.push(fixture.id + ": output contains forbidden claim " + forbidden);
    }
  }
  const leaks = findLeakedIdentifiers(fixture.evidenceText.join("\n") + "\n" + output);
  if (leaks.length > 0) failures.push(fixture.id + ": identifier leakage " + leaks.join(", "));
}

if (failures.length > 0) {
  console.error("Investigation eval failed (" + failures.length + " checks):");
  for (const failure of failures) console.error("- " + failure);
  process.exit(1);
}

console.log(
  "Investigation eval passed: " +
    fixtures.length +
    " fixtures across " +
    new Set(fixtures.map((item) => item.category)).size +
    " safety categories.",
);
