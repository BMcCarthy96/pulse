export const ROLE_RANK = { VIEWER: 0, OPS: 1, ADMIN: 2 } as const;

export type RoleName = keyof typeof ROLE_RANK;

export function roleAtLeast(role: string, minimum: RoleName): boolean {
  const r = ROLE_RANK[role as RoleName];
  return r !== undefined && r >= ROLE_RANK[minimum];
}
