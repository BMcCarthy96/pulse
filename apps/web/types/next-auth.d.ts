import type { RoleName } from "@pulse/shared";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      orgId: string;
      role: RoleName;
      name: string;
      email: string;
    };
  }

  interface User {
    id: string;
    orgId: string;
    role: RoleName;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userId: string;
    orgId: string;
    role: RoleName;
  }
}
