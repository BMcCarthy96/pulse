import { NextResponse } from "next/server";
import { auth } from "@/auth";

const PUBLIC_API_PREFIXES = ["/api/webhooks", "/api/auth", "/api/v1/health"];

export default auth((req) => {
  const { nextUrl } = req;
  const isLoggedIn = !!req.auth;
  const isLoginPage = nextUrl.pathname === "/login";
  const isPublicApi = PUBLIC_API_PREFIXES.some((p) => nextUrl.pathname.startsWith(p));

  if (isPublicApi) {
    return NextResponse.next();
  }

  if (!isLoggedIn && !isLoginPage) {
    const loginUrl = new URL("/login", nextUrl);
    return NextResponse.redirect(loginUrl);
  }

  if (isLoggedIn && isLoginPage) {
    return NextResponse.redirect(new URL("/", nextUrl));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
