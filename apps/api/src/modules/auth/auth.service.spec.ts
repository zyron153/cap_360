import { Test } from "@nestjs/testing";
import { GoneException, UnauthorizedException } from "@nestjs/common";
import { AuthService } from "./auth.service";
import { SessionService } from "./session.service";
import { PasswordService } from "../../common/services/password.service";
import { StaffRepository } from "../staff/staff.repository";
import { NotificationsService } from "../notifications/notifications.service";

const sessions = {
  isLocked: jest.fn(),
  recordFailure: jest.fn(),
  clearFailures: jest.fn(),
  create: jest.fn(),
  destroy: jest.fn(),
  createResetToken: jest.fn(),
  consumeResetToken: jest.fn(),
};
const password = { hash: jest.fn(), verify: jest.fn() };
const staffRepo = {
  findByEmailWithPassword: jest.fn(),
  findByEmail: jest.fn(),
  updatePasswordHash: jest.fn(),
};
const notifications = { sendPasswordReset: jest.fn() };

const STAFF = {
  id: "staff-1",
  email: "ana@cap.cv",
  fullName: "Ana Costa",
  role: "doctor",
  passwordHash: "$argon2id$real-hash",
};

describe("AuthService", () => {
  let service: AuthService;

  beforeEach(async () => {
    const mod = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: SessionService, useValue: sessions },
        { provide: PasswordService, useValue: password },
        { provide: StaffRepository, useValue: staffRepo },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();
    service = mod.get(AuthService);
    jest.clearAllMocks();
    sessions.isLocked.mockResolvedValue(false);
  });

  describe("login", () => {
    it("rejects immediately when the account is locked, without checking the password", async () => {
      sessions.isLocked.mockResolvedValue(true);
      await expect(service.login({ email: "ana@cap.cv", password: "x" })).rejects.toThrow(UnauthorizedException);
      expect(password.verify).not.toHaveBeenCalled();
      expect(staffRepo.findByEmailWithPassword).not.toHaveBeenCalled();
    });

    it("creates a session and clears failures on a correct password", async () => {
      staffRepo.findByEmailWithPassword.mockResolvedValue(STAFF);
      password.verify.mockResolvedValue(true);
      sessions.create.mockResolvedValue("sess-abc");

      const result = await service.login({ email: "ana@cap.cv", password: "correct" });

      expect(sessions.clearFailures).toHaveBeenCalledWith("ana@cap.cv");
      expect(sessions.create).toHaveBeenCalledWith({ staffId: "staff-1", email: "ana@cap.cv", roles: ["doctor"] });
      expect(result).toEqual({
        sessionId: "sess-abc",
        staff: { id: "staff-1", email: "ana@cap.cv", fullName: "Ana Costa", role: "doctor" },
      });
    });

    it("records a failure and rejects on a wrong password", async () => {
      staffRepo.findByEmailWithPassword.mockResolvedValue(STAFF);
      password.verify.mockResolvedValue(false);

      await expect(service.login({ email: "ana@cap.cv", password: "wrong" })).rejects.toThrow(UnauthorizedException);
      expect(sessions.recordFailure).toHaveBeenCalledWith("ana@cap.cv");
      expect(sessions.create).not.toHaveBeenCalled();
    });

    it("records a failure and rejects with the same error for an unknown email (no user enumeration)", async () => {
      staffRepo.findByEmailWithPassword.mockResolvedValue(null);

      await expect(service.login({ email: "nobody@cap.cv", password: "x" })).rejects.toThrow(UnauthorizedException);
      expect(sessions.recordFailure).toHaveBeenCalledWith("nobody@cap.cv");
      // Still runs a real argon2 verify against a dummy hash — timing shouldn't reveal the user is missing.
      expect(password.verify).toHaveBeenCalled();
    });
  });

  describe("logout", () => {
    it("destroys the session", async () => {
      await service.logout("sess-abc");
      expect(sessions.destroy).toHaveBeenCalledWith("sess-abc");
    });
  });

  describe("forgotPassword", () => {
    it("creates a reset token and emails it when the account exists", async () => {
      staffRepo.findByEmail.mockResolvedValue(STAFF);
      sessions.createResetToken.mockResolvedValue("reset-tok");

      await service.forgotPassword("ana@cap.cv");

      expect(sessions.createResetToken).toHaveBeenCalledWith("staff-1");
      expect(notifications.sendPasswordReset).toHaveBeenCalledWith("ana@cap.cv", "Ana Costa", "reset-tok");
    });

    it("silently no-ops for an unknown email (no user enumeration)", async () => {
      staffRepo.findByEmail.mockResolvedValue(null);
      await service.forgotPassword("nobody@cap.cv");
      expect(sessions.createResetToken).not.toHaveBeenCalled();
      expect(notifications.sendPasswordReset).not.toHaveBeenCalled();
    });
  });

  describe("resetPassword", () => {
    it("hashes and stores the new password for a valid token", async () => {
      sessions.consumeResetToken.mockResolvedValue("staff-1");
      password.hash.mockResolvedValue("$argon2id$new-hash");

      await service.resetPassword({ token: "tok", password: "NewPass123" });

      expect(password.hash).toHaveBeenCalledWith("NewPass123");
      expect(staffRepo.updatePasswordHash).toHaveBeenCalledWith("staff-1", "$argon2id$new-hash");
    });

    it("throws GoneException for an invalid/expired token", async () => {
      sessions.consumeResetToken.mockResolvedValue(null);
      await expect(service.resetPassword({ token: "bad", password: "NewPass123" })).rejects.toThrow(GoneException);
      expect(staffRepo.updatePasswordHash).not.toHaveBeenCalled();
    });
  });
});
