import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  const idToken = req.cookies.get("id_token")?.value;

  const keycloakUrl = process.env.NEXT_PUBLIC_KEYCLOAK_URL ?? "http://localhost:8080";
  const realm = process.env.NEXT_PUBLIC_KEYCLOAK_REALM ?? "cap";

  const logoutUrl = new URL(`${keycloakUrl}/realms/${realm}/protocol/openid-connect/logout`);
  logoutUrl.searchParams.set("post_logout_redirect_uri", `${origin}/login`);
  logoutUrl.searchParams.set("client_id", process.env.NEXT_PUBLIC_KEYCLOAK_CLIENT_ID ?? "web");
  if (idToken) logoutUrl.searchParams.set("id_token_hint", idToken);

  const res = NextResponse.redirect(logoutUrl);
  res.cookies.delete("access_token");
  res.cookies.delete("refresh_token");
  res.cookies.delete("id_token");
  return res;
}
