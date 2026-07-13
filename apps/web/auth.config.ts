import type { NextAuthConfig } from "next-auth";

// Edge-safe base config: no Credentials provider (which pulls in bcrypt + Prisma).
// middleware.ts uses this directly; auth.ts extends it with the real provider for
// route handlers and server components (which run in the Node.js runtime).
export const authConfig = {
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  trustHost: true,
  providers: [],
  callbacks: {
    jwt: ({ token, user }) => {
      if (user) {
        token.userId = user.id as string;
        token.orgId = (user as { orgId: string }).orgId;
        token.role = (user as { role: string }).role as never;
      }
      return token;
    },
    session: ({ session, token }) => {
      session.user.id = token.userId as string;
      session.user.orgId = token.orgId as string;
      session.user.role = token.role as never;
      return session;
    },
  },
} satisfies NextAuthConfig;
