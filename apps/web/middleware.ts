import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "./auth.config";

// Edge-safe: only reads/verifies the JWT session cookie, no Credentials provider.
const { auth } = NextAuth(authConfig);

const PUBLIC_API_PREFIXES = ["/api/webhooks", "/api/auth", "/api/v1/health"];
const PUBLIC_PAGES = new Set(["/login", "/recruiter"]);

export default auth((req) => {
  const { nextUrl } = req;
  const isLoggedIn = !!req.auth;
  const isLoginPage = nextUrl.pathname === "/login";
  const isPublicPage = PUBLIC_PAGES.has(nextUrl.pathname);
  const isPublicApi = PUBLIC_API_PREFIXES.some((p) => nextUrl.pathname.startsWith(p));

  if (isPublicApi) {
    return NextResponse.next();
  }

  if (!isLoggedIn && nextUrl.pathname === "/") {
    return NextResponse.redirect(new URL("/recruiter", nextUrl));
  }

  if (isLoggedIn && isLoginPage) {
    return NextResponse.redirect(new URL("/", nextUrl));
  }

  if (isPublicPage) {
    return NextResponse.next();
  }

  if (!isLoggedIn) {
    const loginUrl = new URL("/login", nextUrl);
    loginUrl.searchParams.set("callbackUrl", `${nextUrl.pathname}${nextUrl.search}`);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
