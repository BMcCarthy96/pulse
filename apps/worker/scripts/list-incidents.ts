/** Dev helper: print recent incidents with their AI-summary state. */
import { prisma } from "@pulse/db";

const rows = await prisma.incident.findMany({
  orderBy: { openedAt: "desc" },
  take: 10,
  select: {
    id: true,
    title: true,
    status: true,
    severity: true,
    aiSummaryStatus: true,
    openedAt: true,
    connector: { select: { key: true } },
  },
});

for (const r of rows) {
  console.log(
    [r.id, r.connector.key, r.status, r.severity, `ai=${r.aiSummaryStatus}`, r.openedAt.toISOString(), r.title].join(
      " | ",
    ),
  );
}

await prisma.$disconnect();
