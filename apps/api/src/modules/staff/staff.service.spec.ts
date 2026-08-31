import { Test } from "@nestjs/testing";
import { GoneException, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { StaffService } from "./staff.service";
import { StaffRepository } from "./staff.repository";
import { PasswordService } from "../../common/services/password.service";
import { NotificationsService } from "../notifications/notifications.service";

const repo = {
  findInvitationByToken: jest.fn(),
  create: jest.fn(),
  markInvitationAccepted: jest.fn(),
  findByIdWithPassword: jest.fn(),
  updatePasswordHash: jest.fn(),
};
const password = { hash: jest.fn(), verify: jest.fn() };
const notifications = { sendInvite: jest.fn() };

const INVITE = {
  id: "invite-1",
  email: "ana@cap.cv",
  role: "doctor",
  jobTitle: "Psicóloga",
  phone: null,
  specialtyCode: null,
  availability: null,
  acceptedAt: null,
  expiresAt: new Date(Date.now() + 60_000),
};

describe("StaffService — activateInvitation", () => {
  let service: StaffService;

  beforeEach(async () => {
    const mod = await Test.createTestingModule({
      providers: [
        StaffService,
        { provide: StaffRepository, useValue: repo },
        { provide: PasswordService, useValue: password },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();
    service = mod.get(StaffService);
    jest.clearAllMocks();
    repo.findInvitationByToken.mockResolvedValue(INVITE);
    password.hash.mockResolvedValue("$argon2id$hashed");
  });

  it("throws NotFoundException for an unknown or already-used invitation", async () => {
    repo.findInvitationByToken.mockResolvedValue(null);
    await expect(service.activateInvitation("tok", { fullName: "Ana Costa", password: "x" })).rejects.toThrow(
      NotFoundException
    );
  });

  it("throws GoneException for an expired invitation", async () => {
    repo.findInvitationByToken.mockResolvedValue({ ...INVITE, expiresAt: new Date(Date.now() - 1000) });
    await expect(service.activateInvitation("tok", { fullName: "Ana Costa", password: "x" })).rejects.toThrow(
      GoneException
    );
    expect(password.hash).not.toHaveBeenCalled();
  });

  it("hashes the chosen password, creates the local staff row, and marks the invitation accepted", async () => {
    repo.create.mockResolvedValue({ id: "staff-1", email: "ana@cap.cv" });

    const result = await service.activateInvitation("tok", { fullName: "Ana Costa", password: "S3cret!!!!" });

    expect(password.hash).toHaveBeenCalledWith("S3cret!!!!");
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ fullName: "Ana Costa", email: "ana@cap.cv", passwordHash: "$argon2id$hashed" })
    );
    expect(repo.markInvitationAccepted).toHaveBeenCalledWith("invite-1");
    expect(result).toEqual({ id: "staff-1", email: "ana@cap.cv" });
  });

  it("never stores the plaintext password anywhere in the create() call", async () => {
    repo.create.mockResolvedValue({ id: "staff-1" });
    await service.activateInvitation("tok", { fullName: "Ana Costa", password: "S3cret!!!!" });

    const createArg = repo.create.mock.calls[0][0];
    expect(JSON.stringify(createArg)).not.toContain("S3cret");
  });
});

describe("StaffService — changePassword", () => {
  let service: StaffService;

  beforeEach(async () => {
    const mod = await Test.createTestingModule({
      providers: [
        StaffService,
        { provide: StaffRepository, useValue: repo },
        { provide: PasswordService, useValue: password },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();
    service = mod.get(StaffService);
    jest.clearAllMocks();
  });

  it("verifies the current password before hashing and storing the new one", async () => {
    repo.findByIdWithPassword.mockResolvedValue({ id: "s1", passwordHash: "$argon2id$old" });
    password.verify.mockResolvedValue(true);
    password.hash.mockResolvedValue("$argon2id$new");

    await service.changePassword("s1", { currentPassword: "old-pw", newPassword: "NewPass123" });

    expect(password.verify).toHaveBeenCalledWith("$argon2id$old", "old-pw");
    expect(password.hash).toHaveBeenCalledWith("NewPass123");
    expect(repo.updatePasswordHash).toHaveBeenCalledWith("s1", "$argon2id$new");
  });

  it("rejects with UnauthorizedException when the current password is wrong, without changing anything", async () => {
    repo.findByIdWithPassword.mockResolvedValue({ id: "s1", passwordHash: "$argon2id$old" });
    password.verify.mockResolvedValue(false);

    await expect(
      service.changePassword("s1", { currentPassword: "wrong", newPassword: "NewPass123" })
    ).rejects.toThrow(UnauthorizedException);
    expect(repo.updatePasswordHash).not.toHaveBeenCalled();
  });

  it("throws NotFoundException for an unknown staff id", async () => {
    repo.findByIdWithPassword.mockResolvedValue(null);
    await expect(
      service.changePassword("ghost", { currentPassword: "x", newPassword: "NewPass123" })
    ).rejects.toThrow(NotFoundException);
  });
});
