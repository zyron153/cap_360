import { NextRequest, NextResponse } from "next/server";

const PUBLIC_PATHS = ["/login", "/activate"];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Our own OAuth route handlers manage cookies directly — never touch them here
  if (pathname.startsWith("/api/auth/")) return NextResponse.next();

  const accessToken = req.cookies.get("access_token")?.value;

  // Calls proxied to the backend API (see next.config.ts rewrites) — attach the bearer token
  if (pathname.startsWith("/api/")) {
    if (!accessToken) return NextResponse.next(); // let it through; API will 401 on its own
    const headers = new Headers(req.headers);
    headers.set("Authorization", `Bearer ${accessToken}`);
    return NextResponse.next({ request: { headers } });
  }

  // Protect the app shell
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (!isPublic && !accessToken) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
