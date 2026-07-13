import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@pulse/db";
import type { RoleName } from "@pulse/shared";

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  trustHost: true,
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (credentials) => {
        const email = typeof credentials?.email === "string" ? credentials.email : undefined;
        const password = typeof credentials?.password === "string" ? credentials.password : undefined;
        if (!email || !password) return null;

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) return null;

        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) return null;

        return {
          id: user.id,
          orgId: user.orgId,
          role: user.role as RoleName,
          name: user.name,
          email: user.email,
        };
      },
    }),
  ],
  callbacks: {
    jwt: ({ token, user }) => {
      if (user) {
        token.userId = user.id as string;
        token.orgId = (user as { orgId: string }).orgId;
        token.role = (user as { role: RoleName }).role;
      }
      return token;
    },
    session: ({ session, token }) => {
      session.user.id = token.userId as string;
      session.user.orgId = token.orgId as string;
      session.user.role = token.role as RoleName;
      return session;
    },
  },
});
