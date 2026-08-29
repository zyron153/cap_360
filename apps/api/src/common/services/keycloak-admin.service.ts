import { Injectable, ConflictException, InternalServerErrorException } from "@nestjs/common";

interface NewKeycloakUser {
  email: string;
  firstName: string;
  lastName: string;
  password: string;
  role: string;
}

// SECURITY.md §2.3 — MFA is mandatory for these roles, recommended (not enforced) for the rest.
const MFA_MANDATORY_ROLES = new Set(["admin", "doctor", "corporate_hr"]);

@Injectable()
export class KeycloakAdminService {
  private readonly baseUrl = process.env.KEYCLOAK_URL ?? "http://localhost:8080";
  private readonly realm = process.env.KEYCLOAK_REALM ?? "cap";
  private cachedToken: { value: string; expiresAt: number } | null = null;

  // client_credentials grant against the confidential "api" client (serviceAccountsEnabled in the realm)
  private async getServiceToken(): Promise<string> {
    if (this.cachedToken && this.cachedToken.expiresAt > Date.now() + 5_000) {
      return this.cachedToken.value;
    }

    const res = await fetch(`${this.baseUrl}/realms/${this.realm}/protocol/openid-connect/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: process.env.KEYCLOAK_CLIENT_ID ?? "api",
        client_secret: process.env.KEYCLOAK_CLIENT_SECRET ?? "",
      }),
    });
    if (!res.ok) throw new InternalServerErrorException("Failed to authenticate with Keycloak admin API");

    const data = (await res.json()) as { access_token: string; expires_in: number };
    this.cachedToken = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
    return data.access_token;
  }

  private async adminFetch(path: string, init: RequestInit = {}): Promise<Response> {
    const token = await this.getServiceToken();
    return fetch(`${this.baseUrl}/admin/realms/${this.realm}${path}`, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });
  }

  /** Creates an enabled, email-verified Keycloak user with a permanent password and assigns the realm role. Returns the new user's id. */
  async createUser(user: NewKeycloakUser): Promise<string> {
    const createRes = await this.adminFetch("/users", {
      method: "POST",
      body: JSON.stringify({
        username: user.email,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        enabled: true,
        emailVerified: true,
        credentials: [{ type: "password", value: user.password, temporary: false }],
        ...(MFA_MANDATORY_ROLES.has(user.role) ? { requiredActions: ["CONFIGURE_TOTP"] } : {}),
      }),
    });
    if (createRes.status === 409) throw new ConflictException(`A Keycloak user with email ${user.email} already exists`);
    if (!createRes.ok) throw new InternalServerErrorException(`Keycloak user creation failed: ${await createRes.text()}`);

    const location = createRes.headers.get("Location");
    const userId = location?.split("/").pop();
    if (!userId) throw new InternalServerErrorException("Keycloak did not return a user id");

    const roleRes = await this.adminFetch(`/roles/${user.role}`);
    if (!roleRes.ok) throw new InternalServerErrorException(`Keycloak realm role "${user.role}" not found`);
    const role = (await roleRes.json()) as { id: string; name: string };

    const assignRes = await this.adminFetch(`/users/${userId}/role-mappings/realm`, {
      method: "POST",
      body: JSON.stringify([{ id: role.id, name: role.name }]),
    });
    if (!assignRes.ok) throw new InternalServerErrorException(`Failed to assign role "${user.role}" to new user`);

    return userId;
  }
}
