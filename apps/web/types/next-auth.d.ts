import type { RoleName } from "@pulse/shared";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      orgId: string;
      role: RoleName;
      name: string;
      email: string;
      demoSessionId?: string;
      sessionVersion: number;
    };
  }

  interface User {
    id: string;
    orgId: string;
    role: RoleName;
    demoSessionId?: string;
    sessionVersion: number;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userId: string;
    orgId: string;
    role: RoleName;
    demoSessionId?: string;
    sessionVersion: number;
  }
}
