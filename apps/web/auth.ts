import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { createHash } from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@pulse/db";
import type { RoleName } from "@pulse/shared";
import { authConfig } from "./auth.config";
import { provisionDemoSession } from "./lib/demo-session";
import {
  enforceRateLimit,
  rateLimitClientKey,
  RateLimitExceededError,
  RateLimitUnavailableError,
} from "./lib/rate-limit";

function demoRateLimitKey(request: Request) {
  const salt = process.env.AUTH_SECRET ?? "pulse-local-demo-rate-limit";
  return createHash("sha256")
    .update(`${salt}:${rateLimitClientKey(request.headers)}`)
    .digest("hex")
    .slice(0, 24);
}

function loginRateLimitKey(request: Request, organization: string, email: string) {
  const salt = process.env.AUTH_SECRET ?? "pulse-local-login-rate-limit";
  return createHash("sha256")
    .update(
      `${salt}:${rateLimitClientKey(request.headers)}:${organization || "unspecified"}:${email}`,
    )
    .digest("hex")
    .slice(0, 32);
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  logger: {
    // Rejected credentials are a normal, user-visible outcome (and are deliberately covered by
    // E2E). Auth.js otherwise prints a full stack for every bad password, obscuring real errors.
    error(error) {
      if (error instanceof CredentialsSignin) return;
      console.error("[auth][error]", error);
    },
  },
  providers: [
    Credentials({
      credentials: {
        organization: { label: "Organization", type: "text" },
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (credentials, request) => {
        const organization =
          typeof credentials?.organization === "string"
            ? credentials.organization.trim().toLowerCase()
            : "";
        const email =
          typeof credentials?.email === "string"
            ? credentials.email.trim().toLowerCase()
            : undefined;
        const password =
          typeof credentials?.password === "string" ? credentials.password : undefined;
        if (!email || !password) return null;

        try {
          await enforceRateLimit({
            key: `login:${loginRateLimitKey(request, organization, email)}`,
            capacity: 8,
            refillPerMinute: 8 / 60,
            failClosed: true,
          });
        } catch (error) {
          if (error instanceof RateLimitExceededError) return null;
          if (error instanceof RateLimitUnavailableError) {
            const authError = new CredentialsSignin();
            authError.code = "auth_unavailable";
            throw authError;
          }
          throw error;
        }

        const users = await prisma.user.findMany({
          where: {
            email,
            ...(organization ? { org: { slug: organization } } : {}),
          },
          take: 2,
        });
        // Email addresses are tenant-scoped. Without an organization hint, only authenticate
        // when the address resolves unambiguously so a shared address can never enter the wrong
        // tenant. Existing single-tenant demo personas remain one-click compatible.
        if (users.length !== 1) return null;
        const user = users[0];

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
    Credentials({
      id: "demo",
      name: "Guided demo",
      credentials: { demo: { label: "Demo", type: "text" } },
      authorize: async (credentials, request) => {
        if (process.env.DEMO_MODE !== "true" || credentials?.demo !== "1") return null;
        try {
          await enforceRateLimit({
            key: `demo:provision:${demoRateLimitKey(request)}`,
            capacity: 5,
            refillPerMinute: 5 / 60,
            failClosed: true,
          });
        } catch (error) {
          if (
            error instanceof RateLimitExceededError ||
            error instanceof RateLimitUnavailableError
          ) {
            const rateError = new CredentialsSignin();
            rateError.code = "demo_rate_limit";
            throw rateError;
          }
          throw error;
        }
        let provisioned;
        try {
          provisioned = await provisionDemoSession();
        } catch (error) {
          if (error instanceof Error && error.message === "DEMO_CAPACITY") {
            const capacityError = new CredentialsSignin();
            capacityError.code = "demo_capacity";
            throw capacityError;
          }
          throw error;
        }
        if (!provisioned) return null;
        return {
          id: provisioned.user.id,
          orgId: provisioned.orgId,
          role: "OPS" as RoleName,
          name: provisioned.user.name,
          email: provisioned.user.email,
          demoSessionId: provisioned.id,
        };
      },
    }),
  ],
  session: { strategy: "jwt", maxAge: 60 * 60 },
});
