"use client";

import { useSession } from "next-auth/react";
import { roleAtLeast, type RoleName } from "@pulse/shared";

export function RoleGate({ minRole, children }: { minRole: RoleName; children: React.ReactNode }) {
  const { data: session } = useSession();
  if (!session?.user || !roleAtLeast(session.user.role, minRole)) return null;
  return <>{children}</>;
}
