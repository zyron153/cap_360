import { NextRequest, NextResponse } from "next/server";

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  id_token: string;
  expires_in: number;
  refresh_expires_in: number;
}

export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");

  const verifier = req.cookies.get("pkce_verifier")?.value;
  const expectedState = req.cookies.get("oauth_state")?.value;
  const next = req.cookies.get("oauth_next")?.value ?? "/dashboard";

  if (!code || !state || !verifier || state !== expectedState) {
    return NextResponse.redirect(new URL("/login?error=invalid_state", origin));
  }

  const keycloakUrl = process.env.NEXT_PUBLIC_KEYCLOAK_URL ?? "http://localhost:8080";
  const realm = process.env.NEXT_PUBLIC_KEYCLOAK_REALM ?? "maissaude";
  const clientId = process.env.NEXT_PUBLIC_KEYCLOAK_CLIENT_ID ?? "web";

  const tokenRes = await fetch(`${keycloakUrl}/realms/${realm}/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: `${origin}/api/auth/callback`,
      client_id: clientId,
      code_verifier: verifier,
    }),
  });

  if (!tokenRes.ok) {
    return NextResponse.redirect(new URL("/login?error=token_exchange_failed", origin));
  }

  const tokens = (await tokenRes.json()) as TokenResponse;

  const res = NextResponse.redirect(new URL(next, origin));
  const secure = process.env.NODE_ENV === "production";
  res.cookies.set("access_token", tokens.access_token, { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: tokens.expires_in });
  res.cookies.set("refresh_token", tokens.refresh_token, { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: tokens.refresh_expires_in || 604_800 });
  res.cookies.set("id_token", tokens.id_token, { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: tokens.refresh_expires_in || 604_800 });
  res.cookies.delete("pkce_verifier");
  res.cookies.delete("oauth_state");
  res.cookies.delete("oauth_next");
  return res;
}
