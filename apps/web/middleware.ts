import { NextRequest, NextResponse } from "next/server";

const PUBLIC_PATHS = ["/login", "/activate", "/forgot-password", "/reset-password"];
const SESSION_COOKIE = "cap_session";

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // /api/* is proxied straight to the API by next.config.ts's rewrite — the session cookie
  // travels with the request automatically (same browser-facing origin), and SessionAuthGuard
  // enforces auth server-side. Nothing for this middleware to add here.
  if (pathname.startsWith("/api/")) return NextResponse.next();

  const hasSession = Boolean(req.cookies.get(SESSION_COOKIE)?.value);

  // ponytail: mirrors SessionAuthGuard's own dev-only bypass so `pnpm dev` doesn't require a
  // real login. Fail-safe by default: requires explicit opt-in, not just an unset var.
  const devBypass = process.env.NODE_ENV !== "production" && process.env.AUTH_BYPASS === "true";
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (!isPublic && !hasSession && !devBypass) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
