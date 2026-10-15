import { createHash } from "crypto";
import { EFaturaAuthService, OAUTH_SCOPES } from "./efatura-auth.service";
import { EFaturaError } from "./efatura.errors";

/** ioredis, reduced to the calls the service makes (SET with EX/PX/NX, GET, DEL). */
function fakeRedis() {
  const m = new Map<string, string>();
  return {
    m,
    get: async (k: string) => m.get(k) ?? null,
    del: async (k: string) => void m.delete(k),
    set: jest.fn(async (k: string, v: string, ...args: unknown[]) => {
      if (args.includes("NX") && m.has(k)) return null;
      m.set(k, v);
      return "OK";
    }),
  };
}

const CLIENT = { clientId: "cap-360", clientSecret: "shh", redirectUri: "https://app.cap.cv/api/efatura/oauth/callback" };
let refreshToken: string | null;
const config = {
  getOAuthClient: jest.fn(),
  getRefreshToken: jest.fn(),
  saveRefreshToken: jest.fn(),
  markConnected: jest.fn(),
};

const tokenResponse = (body: object, status = 200) => ({ ok: status < 400, status, json: async () => body }) as unknown as Response;
let fetchMock: jest.SpyInstance;
let redis: ReturnType<typeof fakeRedis>;
let svc: EFaturaAuthService;

beforeEach(() => {
  jest.clearAllMocks();
  redis = fakeRedis();
  refreshToken = "refresh-1";
  config.getOAuthClient.mockResolvedValue(CLIENT);
  config.getRefreshToken.mockImplementation(async () => refreshToken);
  config.saveRefreshToken.mockImplementation(async (t: string | null) => void (refreshToken = t));
  config.markConnected.mockImplementation(async (t: string) => void (refreshToken = t));
  fetchMock = jest.spyOn(global, "fetch");
  svc = new EFaturaAuthService(config as never, redis as never);
});
afterEach(() => fetchMock.mockRestore());

describe("authorizeUrl (Authorization Code + PKCE)", () => {
  it("builds the consent URL with S256 challenge, the scopes and a one-time state bound to the admin", async () => {
    const url = new URL(await svc.authorizeUrl("admin-1"));
    const q = url.searchParams;

    expect(url.origin + url.pathname).toBe("https://iam.efatura.cv/auth/realms/taxpayers/protocol/openid-connect/auth");
    expect(q.get("response_type")).toBe("code");
    expect(q.get("client_id")).toBe("cap-360");
    expect(q.get("redirect_uri")).toBe(CLIENT.redirectUri);
    expect(q.get("scope")).toBe(OAUTH_SCOPES);
    expect(OAUTH_SCOPES).toEqual(expect.stringContaining("offline_access"));
    expect(q.get("code_challenge_method")).toBe("S256");

    const stored = JSON.parse(redis.m.get(`efatura:oauth:${q.get("state")}`) as string);
    expect(stored.userId).toBe("admin-1");
    expect(q.get("code_challenge")).toBe(createHash("sha256").update(stored.verifier).digest("base64url"));
    expect(stored.verifier.length).toBeGreaterThanOrEqual(43); // RFC 7636 minimum
  });

  it("refuses to start before the client is configured", async () => {
    config.getOAuthClient.mockResolvedValue(null);
    await expect(svc.authorizeUrl("a")).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
  });
});

describe("handleCallback", () => {
  async function start() {
    return new URL(await svc.authorizeUrl("admin-1")).searchParams.get("state") as string;
  }

  it("exchanges the code (with the PKCE verifier) and stores the refresh token", async () => {
    const state = await start();
    const verifier = JSON.parse(redis.m.get(`efatura:oauth:${state}`) as string).verifier;
    fetchMock.mockResolvedValue(tokenResponse({ access_token: "at", expires_in: 300, refresh_token: "rt-new" }));

    await svc.handleCallback("the-code", state, "admin-1");

    const body = new URLSearchParams(fetchMock.mock.calls[0][1].body);
    expect(Object.fromEntries(body)).toMatchObject({
      grant_type: "authorization_code", code: "the-code", code_verifier: verifier, client_id: "cap-360", client_secret: "shh", redirect_uri: CLIENT.redirectUri,
    });
    expect(config.markConnected).toHaveBeenCalledWith("rt-new");
    expect(JSON.parse(redis.m.get("efatura:access-token") as string).token).toBe("at");
  });

  it("the state is single-use", async () => {
    const state = await start();
    fetchMock.mockResolvedValue(tokenResponse({ access_token: "at", expires_in: 300, refresh_token: "rt" }));
    await svc.handleCallback("c", state, "admin-1");
    await expect(svc.handleCallback("c", state, "admin-1")).rejects.toMatchObject({ code: "OAUTH_STATE" });
  });

  it("rejects an unknown state and a state started by another user", async () => {
    await expect(svc.handleCallback("c", "nope", "admin-1")).rejects.toMatchObject({ code: "OAUTH_STATE" });
    const state = await start();
    await expect(svc.handleCallback("c", state, "someone-else")).rejects.toMatchObject({ code: "OAUTH_STATE" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails clearly when the platform grants no refresh token", async () => {
    const state = await start();
    fetchMock.mockResolvedValue(tokenResponse({ access_token: "at", expires_in: 300 }));
    await expect(svc.handleCallback("c", state, "admin-1")).rejects.toMatchObject({ code: "OAUTH_NO_REFRESH" });
    expect(config.markConnected).not.toHaveBeenCalled();
  });
});

describe("getAccessToken", () => {
  it("returns the cached token without calling the platform", async () => {
    redis.m.set("efatura:access-token", JSON.stringify({ token: "cached" }));
    expect(await svc.getAccessToken()).toBe("cached");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refreshes when nothing is cached, caches the new token, and releases the lock", async () => {
    fetchMock.mockResolvedValue(tokenResponse({ access_token: "fresh", expires_in: 300 }));
    expect(await svc.getAccessToken()).toBe("fresh");
    const body = Object.fromEntries(new URLSearchParams(fetchMock.mock.calls[0][1].body));
    expect(body).toMatchObject({ grant_type: "refresh_token", refresh_token: "refresh-1", client_id: "cap-360", client_secret: "shh" });
    expect(JSON.parse(redis.m.get("efatura:access-token") as string).token).toBe("fresh");
    expect(redis.m.has("efatura:refresh-lock")).toBe(false);
  });

  it("persists a rotated refresh token", async () => {
    fetchMock.mockResolvedValue(tokenResponse({ access_token: "a", expires_in: 300, refresh_token: "rotated" }));
    await svc.getAccessToken();
    expect(config.markConnected).toHaveBeenCalledWith("rotated");
  });

  it("a revoked grant disconnects and tells the admin to authorize again (non-retryable)", async () => {
    fetchMock.mockResolvedValue(tokenResponse({ error: "invalid_grant" }, 400));
    await expect(svc.getAccessToken()).rejects.toMatchObject({ code: "AUTH_REQUIRED", retryable: false });
    expect(config.saveRefreshToken).toHaveBeenCalledWith(null);
  });

  it("a platform outage while refreshing is retryable and keeps the connection", async () => {
    fetchMock.mockResolvedValue(tokenResponse({}, 503));
    await expect(svc.getAccessToken()).rejects.toMatchObject({ retryable: true });
    expect(config.saveRefreshToken).not.toHaveBeenCalled();
  });

  it("a network failure is retryable", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNRESET"));
    await expect(svc.getAccessToken()).rejects.toMatchObject({ code: "OAUTH_NETWORK", retryable: true });
  });

  it("requires a consent to have been given", async () => {
    refreshToken = null;
    await expect(svc.getAccessToken()).rejects.toMatchObject({ code: "AUTH_REQUIRED", retryable: false });
  });

  it("a second caller waits for the refresh in progress instead of redeeming the token twice", async () => {
    redis.m.set("efatura:refresh-lock", "1"); // another worker is refreshing
    setTimeout(() => redis.m.set("efatura:access-token", JSON.stringify({ token: "from-other-worker" })), 50);
    expect(await svc.getAccessToken()).toBe("from-other-worker");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("invalidate() and disconnect() drop the cached token", async () => {
    redis.m.set("efatura:access-token", JSON.stringify({ token: "x" }));
    await svc.invalidate();
    expect(redis.m.has("efatura:access-token")).toBe(false);
    redis.m.set("efatura:access-token", JSON.stringify({ token: "x" }));
    await svc.disconnect();
    expect(redis.m.has("efatura:access-token")).toBe(false);
    expect(config.saveRefreshToken).toHaveBeenCalledWith(null);
  });

  it("surfaces EFaturaError instances", async () => {
    fetchMock.mockRejectedValue(new Error("x"));
    await expect(svc.getAccessToken()).rejects.toBeInstanceOf(EFaturaError);
  });
});
