import { Test } from "@nestjs/testing";
import { BadGatewayException, BadRequestException } from "@nestjs/common";
import { WhatsappService } from "./whatsapp.service";
import { PrismaService } from "../../prisma/prisma.service";
import { EncryptionService } from "../../common/services/encryption.service";
import { AppointmentsService } from "../appointments/appointments.service";
import { WhatsappGateway } from "./whatsapp.gateway";
import { sendWhatsAppText } from "./whatsapp-api";

jest.mock("./whatsapp-api", () => ({ ...jest.requireActual("./whatsapp-api"), sendWhatsAppText: jest.fn() }));

const prisma = {
  setting: { findUnique: jest.fn() },
  patient: { findFirst: jest.fn() },
  appointment: { findMany: jest.fn() },
  communicationLog: { create: jest.fn() },
  whatsappConversation: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  whatsappMessage: { findUnique: jest.fn(), findUniqueOrThrow: jest.fn(), create: jest.fn(), update: jest.fn() },
  $transaction: jest.fn(),
};
const encryption = { encrypt: (s: string) => `enc(${s})`, decrypt: (s: string) => s.replace(/^enc\((.*)\)$/, "$1") };
const gateway = { emitUpdated: jest.fn() };
const appointments = { updateStatus: jest.fn() };
const sendMock = sendWhatsAppText as jest.Mock;

const CONFIG = { phoneNumberId: "123", accessToken: "tok" };
const inbound = (over: Partial<{ id: string; from: string; type: string; text: { body: string } }> = {}) => ({
  id: "wamid.1",
  from: "2389876543",
  type: "text",
  text: { body: "olá" },
  ...over,
});

describe("WhatsappService", () => {
  let service: WhatsappService;

  beforeEach(async () => {
    const mod = await Test.createTestingModule({
      providers: [
        WhatsappService,
        { provide: PrismaService, useValue: prisma },
        { provide: EncryptionService, useValue: encryption },
        { provide: WhatsappGateway, useValue: gateway },
        { provide: AppointmentsService, useValue: appointments },
      ],
    }).compile();
    service = mod.get(WhatsappService);
    jest.resetAllMocks();
    prisma.$transaction.mockImplementation((fn: (tx: typeof prisma) => unknown) => fn(prisma));
    prisma.whatsappMessage.findUnique.mockResolvedValue(null);
    prisma.whatsappConversation.findUnique.mockResolvedValue(null);
    prisma.whatsappConversation.create.mockResolvedValue({ id: "conv-1" });
    prisma.patient.findFirst.mockResolvedValue(null);
    prisma.setting.findUnique.mockResolvedValue({ value: CONFIG });
  });

  describe("ingestInbound", () => {
    it("ignores a message id it has already stored (Meta retry)", async () => {
      prisma.whatsappMessage.findUnique.mockResolvedValue({ id: "m" });
      await service.ingestInbound(inbound());
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it("links the patient by normalized +238 phone and stores the body encrypted", async () => {
      prisma.patient.findFirst.mockResolvedValue({ id: "p-1" });
      await service.ingestInbound(inbound());

      expect(prisma.patient.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { phone: "+2389876543", deletedAt: null } }));
      expect(prisma.whatsappConversation.create.mock.calls[0][0].data).toMatchObject({ phone: "+2389876543", patientId: "p-1" });
      expect(prisma.whatsappMessage.create.mock.calls[0][0].data).toMatchObject({ direction: "inbound", body: "enc(olá)", externalId: "wamid.1" });
      expect(prisma.communicationLog.create).toHaveBeenCalledTimes(1);
      expect(gateway.emitUpdated).toHaveBeenCalledWith("conv-1");
    });

    it("keeps an unmatched number unlinked, without a communication_log row", async () => {
      await service.ingestInbound(inbound({ from: "351912345678" }));
      expect(prisma.whatsappConversation.create.mock.calls[0][0].data).toMatchObject({ phone: "+351912345678", patientId: null });
      expect(prisma.communicationLog.create).not.toHaveBeenCalled();
    });

    it("reopens an existing conversation and bumps its unread count", async () => {
      prisma.whatsappConversation.findUnique.mockResolvedValue({ id: "conv-9", patientId: null });
      prisma.whatsappConversation.update.mockResolvedValue({ id: "conv-9" });
      await service.ingestInbound(inbound());
      expect(prisma.whatsappConversation.update.mock.calls[0][0].data).toMatchObject({ status: "open", unreadCount: { increment: 1 } });
    });

    it("stores a placeholder for non-text messages", async () => {
      await service.ingestInbound(inbound({ type: "image", text: undefined }));
      expect(prisma.whatsappMessage.create.mock.calls[0][0].data.body).toBe("enc([image])");
    });
  });

  describe("reminder replies", () => {
    beforeEach(() => {
      prisma.patient.findFirst.mockResolvedValue({ id: "p-1" });
      prisma.whatsappConversation.findUnique.mockImplementation(({ where }: { where: { id?: string } }) =>
        Promise.resolve(where.id ? { id: "conv-1", phone: "+2389876543", windowExpiresAt: new Date(Date.now() + 1000) } : null),
      );
      prisma.whatsappMessage.create.mockResolvedValue({ id: "out-1" });
      prisma.whatsappMessage.update.mockResolvedValue({ id: "out-1" });
      prisma.whatsappConversation.update.mockResolvedValue({});
      sendMock.mockResolvedValue("wamid.out");
    });

    it.each(["SIM", "sim!", "1"])("confirms the single pending appointment on %p", async (reply) => {
      prisma.appointment.findMany.mockResolvedValue([{ id: "a-1" }]);
      await service.ingestInbound(inbound({ text: { body: reply } }));
      expect(appointments.updateStatus).toHaveBeenCalledWith("a-1", { status: "confirmed" });
    });

    it("leaves several pending appointments for a human", async () => {
      prisma.appointment.findMany.mockResolvedValue([{ id: "a-1" }, { id: "a-2" }]);
      await service.ingestInbound(inbound({ text: { body: "SIM" } }));
      expect(appointments.updateStatus).not.toHaveBeenCalled();
    });

    it("never auto-cancels on a decline", async () => {
      await service.ingestInbound(inbound({ text: { body: "NÃO" } }));
      expect(prisma.appointment.findMany).not.toHaveBeenCalled();
      expect(appointments.updateStatus).not.toHaveBeenCalled();
    });

    it("does nothing for an unlinked sender", async () => {
      prisma.patient.findFirst.mockResolvedValue(null);
      await service.ingestInbound(inbound({ text: { body: "SIM" } }));
      expect(appointments.updateStatus).not.toHaveBeenCalled();
    });
  });

  describe("send", () => {
    const open = { id: "conv-1", phone: "+2389876543", assignedToId: "s-1", windowExpiresAt: new Date(Date.now() + 60_000) };

    beforeEach(() => {
      prisma.whatsappConversation.findUnique.mockResolvedValue(open);
      prisma.whatsappConversation.update.mockResolvedValue({});
      prisma.whatsappMessage.create.mockResolvedValue({ id: "out-1" });
    });

    it("rejects free text once the 24h window has closed", async () => {
      prisma.whatsappConversation.findUnique.mockResolvedValue({ ...open, windowExpiresAt: new Date(Date.now() - 1000) });
      await expect(service.send("conv-1", { body: "oi" }, "s-1")).rejects.toBeInstanceOf(BadRequestException);
      expect(sendMock).not.toHaveBeenCalled();
    });

    it("replays a prior message for a repeated idempotency key without sending again", async () => {
      prisma.whatsappMessage.findUnique.mockResolvedValue({ id: "old", body: "enc(oi)" });
      const res = await service.send("conv-1", { body: "oi", idempotencyKey: "0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b" }, "s-1");
      expect(res).toMatchObject({ id: "old", body: "oi" });
      expect(sendMock).not.toHaveBeenCalled();
    });

    it("records the Meta message id on success", async () => {
      sendMock.mockResolvedValue("wamid.out");
      prisma.whatsappMessage.update.mockResolvedValue({ id: "out-1", status: "sent" });
      const res = await service.send("conv-1", { body: "oi" }, "s-1");
      expect(prisma.whatsappMessage.create.mock.calls[0][0].data.body).toBe("enc(oi)");
      expect(prisma.whatsappMessage.update).toHaveBeenCalledWith({ where: { id: "out-1" }, data: { status: "sent", externalId: "wamid.out" } });
      expect(res).toMatchObject({ status: "sent", body: "oi" });
    });

    it("marks the row failed, frees the key, and throws when Meta rejects", async () => {
      sendMock.mockRejectedValue(new Error("boom"));
      prisma.whatsappMessage.update.mockResolvedValue({});
      await expect(service.send("conv-1", { body: "oi" }, "s-1")).rejects.toBeInstanceOf(BadGatewayException);
      expect(prisma.whatsappMessage.update).toHaveBeenCalledWith({ where: { id: "out-1" }, data: { status: "failed", idempotencyKey: null } });
    });

    it("refuses to send when the integration isn't configured", async () => {
      prisma.setting.findUnique.mockResolvedValue(null);
      await expect(service.send("conv-1", { body: "oi" }, "s-1")).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe("updateDeliveryStatus", () => {
    it("advances sent -> delivered", async () => {
      prisma.whatsappMessage.findUnique.mockResolvedValue({ id: "m", direction: "outbound", status: "sent", conversationId: "c" });
      await service.updateDeliveryStatus({ id: "wamid", status: "delivered" });
      expect(prisma.whatsappMessage.update).toHaveBeenCalledWith({ where: { id: "m" }, data: { status: "delivered" } });
    });

    it("never regresses read -> delivered", async () => {
      prisma.whatsappMessage.findUnique.mockResolvedValue({ id: "m", direction: "outbound", status: "read", conversationId: "c" });
      await service.updateDeliveryStatus({ id: "wamid", status: "delivered" });
      expect(prisma.whatsappMessage.update).not.toHaveBeenCalled();
    });

    it("ignores an unknown message id", async () => {
      await service.updateDeliveryStatus({ id: "nope", status: "read" });
      expect(prisma.whatsappMessage.update).not.toHaveBeenCalled();
    });
  });
});
