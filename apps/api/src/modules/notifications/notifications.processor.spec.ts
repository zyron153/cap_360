import { Test } from "@nestjs/testing";
import * as nodemailer from "nodemailer";
import { NotificationsProcessor } from "./notifications.processor";
import { PrismaService } from "../../prisma/prisma.service";

jest.mock("nodemailer");

const sendMail = jest.fn();
(nodemailer.createTransport as jest.Mock).mockReturnValue({ sendMail });

const prisma = {
  setting: { findUnique: jest.fn() },
  invoice: { updateMany: jest.fn(), findMany: jest.fn() },
  staff: { findMany: jest.fn() },
  appointment: { findUnique: jest.fn() },
};

const SMTP_CONFIGURED = { host: "smtp.cap.cv", port: "587", username: "u", password: "p", fromName: "CAP" };
const WA_CONFIGURED = { phoneNumberId: "123", accessToken: "tok" };

const APPT = {
  scheduledAt: new Date("2026-09-01T09:00:00Z"),
  patient: { fullName: "Ana Costa", phone: "+2389912345", consentGiven: true },
  service: { name: "Consulta Geral" },
};

describe("NotificationsProcessor — overdue-invoices job", () => {
  let processor: NotificationsProcessor;

  beforeEach(async () => {
    const mod = await Test.createTestingModule({
      providers: [NotificationsProcessor, { provide: PrismaService, useValue: prisma }],
    }).compile();
    processor = mod.get(NotificationsProcessor);
    jest.clearAllMocks();
    prisma.invoice.findMany.mockResolvedValue([]);
    prisma.staff.findMany.mockResolvedValue([]);
  });

  it("marks issued/partially_paid invoices past their due date as overdue", async () => {
    prisma.setting.findUnique.mockResolvedValue(null); // email not configured
    await processor.handleOverdueInvoices({} as never);

    expect(prisma.invoice.updateMany).toHaveBeenCalledWith({
      where: { status: { in: ["issued", "partially_paid"] }, dueDate: { lt: expect.any(Date) } },
      data: { status: "overdue" },
    });
  });

  it("marks overdue invoices even when email notifications aren't configured — it's a data-correctness fix, not a notification", async () => {
    prisma.setting.findUnique.mockResolvedValue(null);
    await processor.handleOverdueInvoices({} as never);
    expect(prisma.invoice.updateMany).toHaveBeenCalledTimes(1);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("still sends the digest email for invoices already marked overdue, after the marking step", async () => {
    prisma.setting.findUnique.mockResolvedValue({ value: SMTP_CONFIGURED });
    prisma.invoice.findMany.mockResolvedValue([
      { invoiceNumber: "INV-1", total: "1000", amountPaid: "0", issuedAt: new Date(), patient: { fullName: "Ana Costa" } },
    ]);
    prisma.staff.findMany.mockResolvedValue([{ email: "admin@cap.cv" }]);

    await processor.handleOverdueInvoices({} as never);

    expect(prisma.invoice.updateMany).toHaveBeenCalled();
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: "admin@cap.cv" }));
  });
});

describe("NotificationsProcessor — WhatsApp confirm/cancel consent gate", () => {
  let processor: NotificationsProcessor;
  let fetchSpy: jest.SpyInstance;

  beforeEach(async () => {
    const mod = await Test.createTestingModule({
      providers: [NotificationsProcessor, { provide: PrismaService, useValue: prisma }],
    }).compile();
    processor = mod.get(NotificationsProcessor);
    jest.clearAllMocks();
    prisma.setting.findUnique.mockResolvedValue({ value: WA_CONFIGURED });
    fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue({ ok: true } as Response);
  });

  afterEach(() => fetchSpy.mockRestore());

  it("sends the confirmation when the patient has given consent", async () => {
    prisma.appointment.findUnique.mockResolvedValue(APPT);
    await processor.handleConfirm({ data: { appointmentId: "a1" } } as never);
    expect(fetchSpy).toHaveBeenCalled();
  });

  it("does NOT send a confirmation once consent has been withdrawn", async () => {
    prisma.appointment.findUnique.mockResolvedValue({ ...APPT, patient: { ...APPT.patient, consentGiven: false } });
    await processor.handleConfirm({ data: { appointmentId: "a1" } } as never);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does NOT send a cancellation notice once consent has been withdrawn", async () => {
    prisma.appointment.findUnique.mockResolvedValue({ ...APPT, patient: { ...APPT.patient, consentGiven: false } });
    await processor.handleCancel({ data: { appointmentId: "a1" } } as never);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("still sends a cancellation notice when consent is given", async () => {
    prisma.appointment.findUnique.mockResolvedValue(APPT);
    await processor.handleCancel({ data: { appointmentId: "a1" } } as never);
    expect(fetchSpy).toHaveBeenCalled();
  });
});
