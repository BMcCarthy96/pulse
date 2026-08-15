import NextAuth from "next-auth";
import {
  NextResponse,
  type NextFetchEvent,
  type NextMiddleware,
  type NextRequest,
} from "next/server";
import { authConfig } from "./auth.config";

// Edge-safe: only reads/verifies the JWT session cookie, no Credentials provider.
const { auth } = NextAuth(authConfig);

const PUBLIC_API_PREFIXES = ["/api/webhooks", "/api/auth", "/api/v1/health"];
const ALWAYS_PUBLIC_PAGES = new Set(["/recruiter", "/livez", "/readyz"]);

const authenticatedMiddleware = auth((req) => {
  const { nextUrl } = req;
  const isLoggedIn = !!req.auth;
  const isLoginPage = nextUrl.pathname === "/login";

  if (!isLoggedIn && nextUrl.pathname === "/") {
    return NextResponse.redirect(new URL("/recruiter", nextUrl));
  }

  if (isLoginPage) {
    return isLoggedIn ? NextResponse.redirect(new URL("/", nextUrl)) : NextResponse.next();
  }

  if (!isLoggedIn) {
    const loginUrl = new URL("/login", nextUrl);
    loginUrl.searchParams.set("callbackUrl", `${nextUrl.pathname}${nextUrl.search}`);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}) as unknown as NextMiddleware;

export default function middleware(req: NextRequest, event: NextFetchEvent) {
  const { pathname } = req.nextUrl;
  const isPublicApi = PUBLIC_API_PREFIXES.some((prefix) => pathname.startsWith(prefix));

  // These routes never inspect req.auth. Bypassing Auth.js also prevents a late public response
  // from rotating an old JWT after the sign-out response has expired it.
  if (isPublicApi || ALWAYS_PUBLIC_PAGES.has(pathname)) {
    return NextResponse.next();
  }

  return authenticatedMiddleware(req, event);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
