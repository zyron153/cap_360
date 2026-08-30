import { KeycloakAdminService } from "./keycloak-admin.service";

const originalFetch = global.fetch;

function jsonResponse(body: unknown, init: Partial<{ status: number; headers: Record<string, string> }> = {}) {
  return {
    ok: (init.status ?? 200) < 400,
    status: init.status ?? 200,
    headers: { get: (k: string) => init.headers?.[k] ?? null },
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response;
}

describe("KeycloakAdminService.createUser — MFA enrollment", () => {
  let fetchMock: jest.Mock;
  let service: KeycloakAdminService;

  beforeEach(() => {
    service = new KeycloakAdminService();
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes("/protocol/openid-connect/token")) {
        return Promise.resolve(jsonResponse({ access_token: "tok", expires_in: 300 }));
      }
      if (init?.method === "POST" && url.endsWith("/users")) {
        return Promise.resolve(jsonResponse({}, { status: 201, headers: { Location: "https://kc/admin/realms/cap/users/new-user-id" } }));
      }
      if (url.includes("/roles/")) {
        const role = url.split("/roles/")[1];
        return Promise.resolve(jsonResponse({ id: `role-${role}`, name: role }));
      }
      if (url.includes("/role-mappings/realm")) {
        return Promise.resolve(jsonResponse({}));
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  function createUserPayload() {
    return JSON.parse(
      (fetchMock.mock.calls.find(([url, init]: [string, RequestInit]) => init?.method === "POST" && url.endsWith("/users"))?.[1] as RequestInit).body as string
    );
  }

  it.each(["admin", "doctor", "corporate_hr"])(
    "requires CONFIGURE_TOTP on account creation for the mandatory-MFA role %s",
    async (role) => {
      await service.createUser({ email: "a@cap.cv", firstName: "A", lastName: "B", password: "pw", role });
      expect(createUserPayload().requiredActions).toContain("CONFIGURE_TOTP");
    }
  );

  it.each(["receptionist", "nurse", "lab_tech"])(
    "does not force CONFIGURE_TOTP for the MFA-recommended-only role %s",
    async (role) => {
      await service.createUser({ email: "a@cap.cv", firstName: "A", lastName: "B", password: "pw", role });
      expect(createUserPayload().requiredActions ?? []).not.toContain("CONFIGURE_TOTP");
    }
  );
});

describe("KeycloakAdminService.deleteUser", () => {
  let fetchMock: jest.Mock;
  let service: KeycloakAdminService;

  beforeEach(() => {
    service = new KeycloakAdminService();
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes("/protocol/openid-connect/token")) {
        return Promise.resolve(jsonResponse({ access_token: "tok", expires_in: 300 }));
      }
      if (init?.method === "DELETE" && url.endsWith("/users/kc-user-1")) {
        return Promise.resolve(jsonResponse({}, { status: 204 }));
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("sends a DELETE to the user's admin endpoint", async () => {
    await service.deleteUser("kc-user-1");
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/users/kc-user-1"),
      expect.objectContaining({ method: "DELETE" })
    );
  });
});
