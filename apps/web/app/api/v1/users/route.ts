import { NextResponse } from "next/server";
import { prisma } from "@pulse/db";
import { handleApiError, requireRole } from "@/lib/authz";

export const GET = handleApiError("users.list", async () => {
  const session = await requireRole("ADMIN");

  // Read-only (doc 05). `passwordHash` is never selected — not even to discard it later.
  const users = await prisma.user.findMany({
    where: { orgId: session.user.orgId },
    select: { id: true, name: true, email: true, role: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({ data: users });
});
