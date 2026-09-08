import { Test } from "@nestjs/testing";
import { PublicService } from "./public.service";
import { AppointmentsService } from "../appointments/appointments.service";
import { PatientsService } from "../patients/patients.service";
import { ServicesService } from "../services/services.service";
import { StaffService } from "../staff/staff.service";

const patientsService = { findOrCreateByPhone: jest.fn() };
const appointmentsService = { getAvailability: jest.fn(), create: jest.fn() };
const servicesService = { findAll: jest.fn() };
const staffService = { findAll: jest.fn(), getPublicInvitation: jest.fn(), activateInvitation: jest.fn() };

describe("PublicService", () => {
  let service: PublicService;

  beforeEach(async () => {
    const mod = await Test.createTestingModule({
      providers: [
        PublicService,
        { provide: PatientsService, useValue: patientsService },
        { provide: AppointmentsService, useValue: appointmentsService },
        { provide: ServicesService, useValue: servicesService },
        { provide: StaffService, useValue: staffService },
      ],
    }).compile();
    service = mod.get(PublicService);
    jest.clearAllMocks();
  });

  it("getServices delegates to ServicesService.findAll", async () => {
    servicesService.findAll.mockResolvedValue([{ id: "s1" }]);
    await expect(service.getServices()).resolves.toEqual([{ id: "s1" }]);
  });

  it("getAvailability delegates to AppointmentsService", async () => {
    appointmentsService.getAvailability.mockResolvedValue([]);
    const q = { serviceId: "s1", date: "2026-09-10" } as never;
    await service.getAvailability(q);
    expect(appointmentsService.getAvailability).toHaveBeenCalledWith(q);
  });

  it("getStaff projects only the public-safe fields", async () => {
    staffService.findAll.mockResolvedValue([
      { id: "st1", fullName: "Dra. Ana", specialtyCode: "PSY", role: "doctor", email: "ana@cap.cv", availability: [{ dayOfWeek: 1 }] },
    ]);
    await expect(service.getStaff()).resolves.toEqual([
      { id: "st1", fullName: "Dra. Ana", specialtyCode: "PSY", availability: [{ dayOfWeek: 1 }] },
    ]);
  });

  it("getInvitation / activateInvitation delegate to StaffService", async () => {
    staffService.getPublicInvitation.mockResolvedValue({ email: "x@cap.cv" });
    await service.getInvitation("tok");
    expect(staffService.getPublicInvitation).toHaveBeenCalledWith("tok");

    staffService.activateInvitation.mockResolvedValue({ ok: true });
    await service.activateInvitation("tok", { fullName: "X", password: "p" } as never);
    expect(staffService.activateInvitation).toHaveBeenCalledWith("tok", { fullName: "X", password: "p" });
  });

  describe("createBooking", () => {
    const dto = {
      fullName: "João Silva",
      phone: "+2389912345",
      dateOfBirth: "1990-01-01",
      email: "joao@cap.cv",
      gender: "male",
      consentGiven: true,
      serviceId: "svc1",
      staffId: "stf1",
      scheduledAt: "2026-09-10T09:00:00.000Z",
      notes: "primeira consulta",
    } as never as Parameters<PublicService["createBooking"]>[0];

    it("finds-or-creates the patient by phone, passing consent through", async () => {
      patientsService.findOrCreateByPhone.mockResolvedValue({ id: "pat1" });
      appointmentsService.create.mockResolvedValue({ id: "abcdef12-3456-7890-abcd-ef1234567890", scheduledAt: "2026-09-10T09:00:00.000Z", status: "pending" });

      await service.createBooking(dto);

      expect(patientsService.findOrCreateByPhone).toHaveBeenCalledWith({
        fullName: "João Silva",
        phone: "+2389912345",
        dateOfBirth: "1990-01-01",
        email: "joao@cap.cv",
        gender: "male",
        consentGiven: true,
      });
      expect(appointmentsService.create).toHaveBeenCalledWith({
        patientId: "pat1",
        staffId: "stf1",
        serviceId: "svc1",
        scheduledAt: "2026-09-10T09:00:00.000Z",
        notes: "primeira consulta",
        source: "web",
      });
    });

    it("returns a booking reference from the first 8 chars of the appointment id, uppercased", async () => {
      patientsService.findOrCreateByPhone.mockResolvedValue({ id: "pat1" });
      appointmentsService.create.mockResolvedValue({ id: "abcdef12-3456-7890-abcd-ef1234567890", scheduledAt: "2026-09-10T09:00:00.000Z", status: "pending" });

      const result = await service.createBooking(dto);

      expect(result).toEqual({
        bookingId: "abcdef12-3456-7890-abcd-ef1234567890",
        bookingReference: "ABCDEF12",
        patientId: "pat1",
        scheduledAt: "2026-09-10T09:00:00.000Z",
        status: "pending",
      });
    });
  });
});
