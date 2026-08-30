import { Test } from "@nestjs/testing";
import { GoneException, NotFoundException } from "@nestjs/common";
import { StaffService } from "./staff.service";
import { StaffRepository } from "./staff.repository";
import { KeycloakAdminService } from "../../common/services/keycloak-admin.service";
import { NotificationsService } from "../notifications/notifications.service";

const repo = {
  findInvitationByToken: jest.fn(),
  create: jest.fn(),
  markInvitationAccepted: jest.fn(),
};
const keycloak = { createUser: jest.fn(), deleteUser: jest.fn() };
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
        { provide: KeycloakAdminService, useValue: keycloak },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();
    service = mod.get(StaffService);
    jest.clearAllMocks();
    repo.findInvitationByToken.mockResolvedValue(INVITE);
    keycloak.createUser.mockResolvedValue("kc-user-1");
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
    expect(keycloak.createUser).not.toHaveBeenCalled();
  });

  it("creates the Keycloak user, the local staff row, and marks the invitation accepted, in that order", async () => {
    repo.create.mockResolvedValue({ id: "staff-1", keycloakId: "kc-user-1" });

    const result = await service.activateInvitation("tok", { fullName: "Ana Costa", password: "x" });

    expect(keycloak.createUser).toHaveBeenCalledWith(expect.objectContaining({ email: "ana@cap.cv" }));
    expect(repo.create).toHaveBeenCalledWith("kc-user-1", expect.objectContaining({ fullName: "Ana Costa" }));
    expect(repo.markInvitationAccepted).toHaveBeenCalledWith("invite-1");
    expect(result).toEqual({ id: "staff-1", keycloakId: "kc-user-1" });
  });

  it("deletes the just-created Keycloak user when the local staff row fails to create — no orphaned account", async () => {
    const dbError = new Error("connection reset");
    repo.create.mockRejectedValue(dbError);
    keycloak.deleteUser.mockResolvedValue(undefined);

    await expect(service.activateInvitation("tok", { fullName: "Ana Costa", password: "x" })).rejects.toBe(dbError);

    expect(keycloak.deleteUser).toHaveBeenCalledWith("kc-user-1");
    expect(repo.markInvitationAccepted).not.toHaveBeenCalled();
  });

  it("still surfaces the original DB error even if the Keycloak cleanup delete itself fails", async () => {
    const dbError = new Error("connection reset");
    repo.create.mockRejectedValue(dbError);
    keycloak.deleteUser.mockRejectedValue(new Error("keycloak unreachable"));

    await expect(service.activateInvitation("tok", { fullName: "Ana Costa", password: "x" })).rejects.toBe(dbError);
  });
});
