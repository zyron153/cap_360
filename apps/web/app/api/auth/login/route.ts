import { NextRequest, NextResponse } from "next/server";
import { randomBytes, createHash } from "crypto";

const COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: 300, // 5 minutes — only needs to survive the Keycloak redirect round-trip
};

export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  const next = req.nextUrl.searchParams.get("next") ?? "/dashboard";

  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = randomBytes(16).toString("base64url");

  const keycloakUrl = process.env.NEXT_PUBLIC_KEYCLOAK_URL ?? "http://localhost:8080";
  const realm = process.env.NEXT_PUBLIC_KEYCLOAK_REALM ?? "cap";
  const clientId = process.env.NEXT_PUBLIC_KEYCLOAK_CLIENT_ID ?? "web";

  const authUrl = new URL(`${keycloakUrl}/realms/${realm}/protocol/openid-connect/auth`);
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", `${origin}/api/auth/callback`);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", "openid");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("code_challenge", challenge);
  authUrl.searchParams.set("code_challenge_method", "S256");

  const res = NextResponse.redirect(authUrl);
  res.cookies.set("pkce_verifier", verifier, COOKIE_OPTS);
  res.cookies.set("oauth_state", state, COOKIE_OPTS);
  res.cookies.set("oauth_next", next, COOKIE_OPTS);
  return res;
}
