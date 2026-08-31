import { Test } from "@nestjs/testing";
import { REDIS_CLIENT } from "../../common/redis/redis.module";
import { SessionService, MAX_LOGIN_FAILURES } from "./session.service";

describe("SessionService", () => {
  const redis = {
    set: jest.fn(),
    get: jest.fn(),
    del: jest.fn(),
    expire: jest.fn(),
    incr: jest.fn(),
  };
  let service: SessionService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [SessionService, { provide: REDIS_CLIENT, useValue: redis }],
    }).compile();
    service = moduleRef.get(SessionService);
  });

  describe("create / get / destroy", () => {
    it("stores the session under a random key with a TTL and returns that id", async () => {
      redis.set.mockResolvedValue("OK");
      const id = await service.create({ staffId: "s1", email: "a@cap.cv", roles: ["admin"] });

      expect(id).toMatch(/^[0-9a-f]{64}$/); // 32 random bytes, hex-encoded
      expect(redis.set).toHaveBeenCalledWith(
        `session:${id}`,
        JSON.stringify({ staffId: "s1", email: "a@cap.cv", roles: ["admin"] }),
        "EX",
        expect.any(Number)
      );
    });

    it("returns the parsed session and slides the TTL on a hit", async () => {
      redis.get.mockResolvedValue(JSON.stringify({ staffId: "s1", email: "a@cap.cv", roles: ["admin"] }));
      const data = await service.get("abc123");

      expect(data).toEqual({ staffId: "s1", email: "a@cap.cv", roles: ["admin"] });
      expect(redis.expire).toHaveBeenCalledWith("session:abc123", expect.any(Number));
    });

    it("returns null and does not touch the TTL on a miss", async () => {
      redis.get.mockResolvedValue(null);
      const data = await service.get("missing");

      expect(data).toBeNull();
      expect(redis.expire).not.toHaveBeenCalled();
    });

    it("deletes the session key on destroy", async () => {
      await service.destroy("abc123");
      expect(redis.del).toHaveBeenCalledWith("session:abc123");
    });
  });

  describe("login lockout", () => {
    it("normalizes email case so failures from different casings accumulate together", async () => {
      redis.incr.mockResolvedValue(1);
      await service.recordFailure("User@CAP.cv");
      expect(redis.incr).toHaveBeenCalledWith("login:fail:user@cap.cv");
    });

    it("starts the failure-window expiry only on the first failure", async () => {
      redis.incr.mockResolvedValue(1);
      await service.recordFailure("a@cap.cv");
      expect(redis.expire).toHaveBeenCalledWith("login:fail:a@cap.cv", expect.any(Number));
    });

    it("does not reset the failure-window expiry on a later failure", async () => {
      redis.incr.mockResolvedValue(2);
      await service.recordFailure("a@cap.cv");
      expect(redis.expire).not.toHaveBeenCalled();
    });

    it(`locks the account once failures reach ${MAX_LOGIN_FAILURES}`, async () => {
      redis.incr.mockResolvedValue(MAX_LOGIN_FAILURES);
      await service.recordFailure("a@cap.cv");
      expect(redis.set).toHaveBeenCalledWith("login:lock:a@cap.cv", "1", "EX", expect.any(Number));
    });

    it("does not lock before the threshold", async () => {
      redis.incr.mockResolvedValue(MAX_LOGIN_FAILURES - 1);
      await service.recordFailure("a@cap.cv");
      expect(redis.set).not.toHaveBeenCalled();
    });

    it("reports locked when the lock key is present", async () => {
      redis.get.mockResolvedValue("1");
      await expect(service.isLocked("A@cap.cv")).resolves.toBe(true);
      expect(redis.get).toHaveBeenCalledWith("login:lock:a@cap.cv");
    });

    it("reports not locked when the lock key is absent", async () => {
      redis.get.mockResolvedValue(null);
      await expect(service.isLocked("a@cap.cv")).resolves.toBe(false);
    });

    it("clears both the failure counter and the lock on success", async () => {
      await service.clearFailures("a@cap.cv");
      expect(redis.del).toHaveBeenCalledWith("login:fail:a@cap.cv", "login:lock:a@cap.cv");
    });
  });

  describe("password reset tokens", () => {
    it("stores a random token mapped to the staff id, with a TTL, and returns it", async () => {
      const token = await service.createResetToken("s1");
      expect(token).toMatch(/^[0-9a-f]{64}$/);
      expect(redis.set).toHaveBeenCalledWith(`pwreset:${token}`, "s1", "EX", expect.any(Number));
    });

    it("returns the staff id and deletes the token on a valid consume", async () => {
      redis.get.mockResolvedValue("s1");
      await expect(service.consumeResetToken("tok")).resolves.toBe("s1");
      expect(redis.del).toHaveBeenCalledWith("pwreset:tok");
    });

    it("returns null and does not delete anything for an unknown/expired token", async () => {
      redis.get.mockResolvedValue(null);
      await expect(service.consumeResetToken("tok")).resolves.toBeNull();
      expect(redis.del).not.toHaveBeenCalled();
    });
  });
});
