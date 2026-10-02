import { Test } from "@nestjs/testing";
import { ConflictException, NotFoundException, UnauthorizedException, BadRequestException, ForbiddenException } from "@nestjs/common";
import { StaffService } from "./staff.service";
import { StaffRepository } from "./staff.repository";
import { PasswordService } from "../../common/services/password.service";

const repo = {
  create: jest.fn(),
  findByEmail: jest.fn(),
  findByIdWithPassword: jest.fn(),
  updatePasswordHash: jest.fn(),
  createLeaveRequest: jest.fn(),
  findLeaveRequestsByStaffId: jest.fn(),
  findPendingLeaveRequests: jest.fn(),
  findLeaveRequestById: jest.fn(),
  updateLeaveRequestStatus: jest.fn(),
  createApprovedBlock: jest.fn(),
  deleteLeaveRequest: jest.fn(),
  findById: jest.fn(),
  softDelete: jest.fn(),
};
const password = { hash: jest.fn(), verify: jest.fn(), generateTemporary: jest.fn() };

async function makeService() {
  const mod = await Test.createTestingModule({
    providers: [
      StaffService,
      { provide: StaffRepository, useValue: repo },
      { provide: PasswordService, useValue: password },
    ],
  }).compile();
  return mod.get(StaffService);
}

describe("StaffService — create (temporary password)", () => {
  let service: StaffService;
  const DTO = { fullName: "  Ana Costa ", email: "ana@cap.cv", role: "doctor" as const, jobTitle: "Psicóloga" };

  beforeEach(async () => {
    service = await makeService();
    jest.clearAllMocks();
    repo.findByEmail.mockResolvedValue(null);
    password.generateTemporary.mockReturnValue("Tmp-Pass#1234");
    password.hash.mockResolvedValue("$argon2id$hashed");
    repo.create.mockResolvedValue({ id: "staff-1", fullName: "Ana Costa", email: "ana@cap.cv" });
  });

  it("throws ConflictException when the email already belongs to a user, without creating anything", async () => {
    repo.findByEmail.mockResolvedValue({ id: "x" });
    await expect(service.create(DTO)).rejects.toThrow(ConflictException);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it("creates the user with the hashed temporary password and mustChangePassword set", async () => {
    await service.create(DTO);

    expect(password.hash).toHaveBeenCalledWith("Tmp-Pass#1234");
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        fullName: "Ana Costa",
        email: "ana@cap.cv",
        role: "doctor",
        passwordHash: "$argon2id$hashed",
        mustChangePassword: true,
      })
    );
  });

  it("returns the plaintext temporary password once, and never passes it to the repository", async () => {
    const result = await service.create(DTO);

    expect(result).toEqual({ staffId: "staff-1", fullName: "Ana Costa", email: "ana@cap.cv", temporaryPassword: "Tmp-Pass#1234" });
    expect(JSON.stringify(repo.create.mock.calls[0][0])).not.toContain("Tmp-Pass#1234");
  });
});

describe("StaffService — resetPassword", () => {
  let service: StaffService;

  beforeEach(async () => {
    service = await makeService();
    jest.clearAllMocks();
    password.generateTemporary.mockReturnValue("Tmp-Pass#5678");
    password.hash.mockResolvedValue("$argon2id$hashed");
  });

  it("throws NotFoundException for an unknown staff id, without touching the password", async () => {
    repo.findById.mockResolvedValue(null);
    await expect(service.resetPassword("ghost")).rejects.toThrow(NotFoundException);
    expect(repo.updatePasswordHash).not.toHaveBeenCalled();
  });

  it("stores a fresh hashed temporary password flagged mustChangePassword and returns the plaintext once", async () => {
    repo.findById.mockResolvedValue({ id: "s1", fullName: "Ana Costa", email: "ana@cap.cv" });

    const result = await service.resetPassword("s1");

    expect(repo.updatePasswordHash).toHaveBeenCalledWith("s1", "$argon2id$hashed", true);
    expect(result).toEqual({ staffId: "s1", fullName: "Ana Costa", email: "ana@cap.cv", temporaryPassword: "Tmp-Pass#5678" });
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

  it("rejects a new password identical to the current (temporary) one, without changing anything", async () => {
    repo.findByIdWithPassword.mockResolvedValue({ id: "s1", passwordHash: "$argon2id$old" });
    password.verify.mockResolvedValue(true);

    await expect(
      service.changePassword("s1", { currentPassword: "Tmp-Pass#1234", newPassword: "Tmp-Pass#1234" })
    ).rejects.toThrow(BadRequestException);
    expect(password.hash).not.toHaveBeenCalled();
    expect(repo.updatePasswordHash).not.toHaveBeenCalled();
  });

  it("throws NotFoundException for an unknown staff id", async () => {
    repo.findByIdWithPassword.mockResolvedValue(null);
    await expect(
      service.changePassword("ghost", { currentPassword: "x", newPassword: "NewPass123" })
    ).rejects.toThrow(NotFoundException);
  });
});

describe("StaffService — leave requests", () => {
  let service: StaffService;

  beforeEach(async () => {
    const mod = await Test.createTestingModule({
      providers: [
        StaffService,
        { provide: StaffRepository, useValue: repo },
        { provide: PasswordService, useValue: password },
      ],
    }).compile();
    service = mod.get(StaffService);
    jest.clearAllMocks();
  });

  it("creates a leave request for the requesting staff member", async () => {
    repo.createLeaveRequest.mockResolvedValue({ id: "lr-1", status: "pending" });
    await service.createLeaveRequest("s1", { startDate: "2026-09-10", endDate: "2026-09-12" });
    expect(repo.createLeaveRequest).toHaveBeenCalledWith("s1", { startDate: "2026-09-10", endDate: "2026-09-12" });
  });

  it("approves a pending leave request", async () => {
    repo.findLeaveRequestById.mockResolvedValue({ id: "lr-1", status: "pending" });
    repo.updateLeaveRequestStatus.mockResolvedValue({ id: "lr-1", status: "approved" });

    await service.decideLeaveRequest("lr-1", { status: "approved" });

    expect(repo.updateLeaveRequestStatus).toHaveBeenCalledWith("lr-1", "approved");
  });

  it("throws BadRequestException when the leave request was already decided", async () => {
    repo.findLeaveRequestById.mockResolvedValue({ id: "lr-1", status: "approved" });
    await expect(service.decideLeaveRequest("lr-1", { status: "rejected" })).rejects.toThrow(BadRequestException);
    expect(repo.updateLeaveRequestStatus).not.toHaveBeenCalled();
  });

  it("throws NotFoundException for an unknown leave request id", async () => {
    repo.findLeaveRequestById.mockResolvedValue(null);
    await expect(service.decideLeaveRequest("ghost", { status: "approved" })).rejects.toThrow(NotFoundException);
  });
});

describe("StaffService — availability blocks (calendar tab)", () => {
  let service: StaffService;

  beforeEach(async () => {
    const mod = await Test.createTestingModule({
      providers: [
        StaffService,
        { provide: StaffRepository, useValue: repo },
        { provide: PasswordService, useValue: password },
      ],
    }).compile();
    service = mod.get(StaffService);
    jest.clearAllMocks();
  });

  it("creates an immediately-approved block when a doctor blocks their own calendar", async () => {
    repo.createApprovedBlock.mockResolvedValue({ id: "b1", status: "approved" });
    await service.createBlock("s1", "s1", ["doctor"], { startDate: "2026-09-10", endDate: "2026-09-12" });
    expect(repo.createApprovedBlock).toHaveBeenCalledWith("s1", { startDate: "2026-09-10", endDate: "2026-09-12" });
  });

  it("creates an immediately-approved block when admin blocks someone else's calendar", async () => {
    repo.createApprovedBlock.mockResolvedValue({ id: "b1", status: "approved" });
    await service.createBlock("s1", "admin-1", ["admin"], { startDate: "2026-09-10", endDate: "2026-09-12" });
    expect(repo.createApprovedBlock).toHaveBeenCalledWith("s1", { startDate: "2026-09-10", endDate: "2026-09-12" });
  });

  it("throws ForbiddenException when a non-admin tries to block someone else's calendar", async () => {
    await expect(
      service.createBlock("s1", "s2", ["doctor"], { startDate: "2026-09-10", endDate: "2026-09-12" })
    ).rejects.toThrow(ForbiddenException);
    expect(repo.createApprovedBlock).not.toHaveBeenCalled();
  });

  it("lists a staff member's own leave requests/blocks", async () => {
    repo.findLeaveRequestsByStaffId.mockResolvedValue([{ id: "lr-1" }]);
    await service.listLeaveRequestsForStaff("s1", "s1", ["doctor"]);
    expect(repo.findLeaveRequestsByStaffId).toHaveBeenCalledWith("s1");
  });

  it("lets admin list any staff member's leave requests/blocks", async () => {
    repo.findLeaveRequestsByStaffId.mockResolvedValue([{ id: "lr-1" }]);
    await service.listLeaveRequestsForStaff("s1", "admin-1", ["admin"]);
    expect(repo.findLeaveRequestsByStaffId).toHaveBeenCalledWith("s1");
  });

  it("throws ForbiddenException when a non-admin requests someone else's leave requests", async () => {
    await expect(service.listLeaveRequestsForStaff("s1", "s2", ["doctor"])).rejects.toThrow(ForbiddenException);
    expect(repo.findLeaveRequestsByStaffId).not.toHaveBeenCalled();
  });

  it("removes a block when the requester owns it", async () => {
    repo.findLeaveRequestById.mockResolvedValue({ id: "lr-1", staffId: "s1" });
    repo.deleteLeaveRequest.mockResolvedValue({ id: "lr-1" });
    await service.removeBlock("lr-1", "s1", ["doctor"]);
    expect(repo.deleteLeaveRequest).toHaveBeenCalledWith("lr-1");
  });

  it("lets admin remove any block", async () => {
    repo.findLeaveRequestById.mockResolvedValue({ id: "lr-1", staffId: "s1" });
    repo.deleteLeaveRequest.mockResolvedValue({ id: "lr-1" });
    await service.removeBlock("lr-1", "admin-1", ["admin"]);
    expect(repo.deleteLeaveRequest).toHaveBeenCalledWith("lr-1");
  });

  it("throws ForbiddenException when a non-admin tries to remove someone else's block", async () => {
    repo.findLeaveRequestById.mockResolvedValue({ id: "lr-1", staffId: "s1" });
    await expect(service.removeBlock("lr-1", "s2", ["doctor"])).rejects.toThrow(ForbiddenException);
    expect(repo.deleteLeaveRequest).not.toHaveBeenCalled();
  });

  it("throws NotFoundException when the block doesn't exist", async () => {
    repo.findLeaveRequestById.mockResolvedValue(null);
    await expect(service.removeBlock("ghost", "s1", ["doctor"])).rejects.toThrow(NotFoundException);
  });
});

describe("StaffService — softDelete (deactivation)", () => {
  let service: StaffService;

  beforeEach(async () => {
    const mod = await Test.createTestingModule({
      providers: [
        StaffService,
        { provide: StaffRepository, useValue: repo },
        { provide: PasswordService, useValue: password },
      ],
    }).compile();
    service = mod.get(StaffService);
    jest.clearAllMocks();
  });

  it("deactivates an existing staff member", async () => {
    repo.findById.mockResolvedValue({ id: "s1", fullName: "Dr. Carlos Silva" });
    repo.softDelete.mockResolvedValue({ id: "s1", deletedAt: new Date() });
    await service.softDelete("s1", "admin-1");
    expect(repo.softDelete).toHaveBeenCalledWith("s1");
  });

  it("throws NotFoundException for a nonexistent staff member, without deactivating anything", async () => {
    repo.findById.mockResolvedValue(null);
    await expect(service.softDelete("ghost", "admin-1")).rejects.toThrow(NotFoundException);
    expect(repo.softDelete).not.toHaveBeenCalled();
  });

  it("throws ForbiddenException when an admin tries to deactivate their own account", async () => {
    await expect(service.softDelete("admin-1", "admin-1")).rejects.toThrow(ForbiddenException);
    expect(repo.findById).not.toHaveBeenCalled();
    expect(repo.softDelete).not.toHaveBeenCalled();
  });
});
