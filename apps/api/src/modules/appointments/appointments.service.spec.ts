import { Test } from "@nestjs/testing";
import { ConflictException } from "@nestjs/common";
import { getQueueToken } from "@nestjs/bull";
import { AppointmentsService } from "./appointments.service";
import { AppointmentsRepository } from "./appointments.repository";
import { AppointmentsGateway } from "./appointments.gateway";
import { BillingService } from "../billing/billing.service";
import { NotificationsService } from "../notifications/notifications.service";
import { REDIS_CLIENT } from "../../common/redis/redis.module";

const repo = {
  findStaffAvailability: jest.fn(),
  findConfirmedInRange: jest.fn(),
  findById: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  deleteReminders: jest.fn(),
  createReminder: jest.fn(),
  createWaitlistEntry: jest.fn(),
  findWaitlist: jest.fn(),
};
const gateway = { emitAppointmentCreated: jest.fn(), emitAppointmentUpdated: jest.fn() };
const redis = { set: jest.fn(), del: jest.fn() };
const queue = { add: jest.fn(), getJob: jest.fn() };
const billingMock = { createDraft: jest.fn() };
const notifMock = { notifyConfirm: jest.fn(), notifyCancel: jest.fn(), isReminderEnabled: jest.fn() };

const STAFF_ID = "staff-1";
const TEST_DATE = "2026-07-01";

describe("AppointmentsService", () => {
  let service: AppointmentsService;

  beforeEach(async () => {
    const mod = await Test.createTestingModule({
      providers: [
        AppointmentsService,
        { provide: AppointmentsRepository, useValue: repo },
        { provide: AppointmentsGateway, useValue: gateway },
        { provide: BillingService, useValue: billingMock },
        { provide: NotificationsService, useValue: notifMock },
        { provide: getQueueToken("reminders"), useValue: queue },
        { provide: REDIS_CLIENT, useValue: redis },
      ],
    }).compile();
    service = mod.get(AppointmentsService);
    jest.clearAllMocks();
  });

  describe("getAvailability — slot generation", () => {
    it("returns empty when staff has no configured hours", async () => {
      repo.findStaffAvailability.mockResolvedValue([]);
      const slots = await service.getAvailability({ staffId: STAFF_ID, serviceId: "service-1", date: TEST_DATE });
      expect(slots).toEqual([]);
    });

    it("generates one 30-min slot per half-hour in the window", async () => {
      repo.findStaffAvailability.mockResolvedValue([
        { staffId: STAFF_ID, startTime: "09:00", endTime: "10:00" },
      ]);
      repo.findConfirmedInRange.mockResolvedValue([]);

      const slots = await service.getAvailability({ staffId: STAFF_ID, serviceId: "service-1", date: TEST_DATE });
      expect(slots).toHaveLength(2); // 09:00 and 09:30
      expect(slots.every((s) => s.available)).toBe(true);
    });

    it("marks slot unavailable when a booked appointment overlaps it", async () => {
      repo.findStaffAvailability.mockResolvedValue([
        { staffId: STAFF_ID, startTime: "09:00", endTime: "10:00" },
      ]);
      // Build the date the same way the service does, to avoid tz mismatch
      const booked = new Date(TEST_DATE);
      booked.setHours(9, 0, 0, 0);
      repo.findConfirmedInRange.mockResolvedValue([
        { scheduledAt: booked, durationMinutes: 30 },
      ]);

      const slots = await service.getAvailability({ staffId: STAFF_ID, serviceId: "service-1", date: TEST_DATE });
      expect(slots[0].available).toBe(false); // 09:00 blocked
      expect(slots[1].available).toBe(true);  // 09:30 free
    });
  });

  describe("create — conflict detection", () => {
    const DTO = {
      patientId: "patient-1",
      staffId: STAFF_ID,
      serviceId: "service-1",
      scheduledAt: "2026-07-01T10:00:00.000Z",
      source: "web" as const,
    };

    it("throws ConflictException when Redis slot lock is already held", async () => {
      redis.set.mockResolvedValue(null); // NX returned null → someone else holds the lock
      await expect(service.create(DTO)).rejects.toThrow(ConflictException);
    });

    it("throws ConflictException when an overlapping confirmed appointment exists", async () => {
      redis.set.mockResolvedValue("OK");
      redis.del.mockResolvedValue(1);
      const existing = new Date(DTO.scheduledAt);
      repo.findConfirmedInRange.mockResolvedValue([
        { scheduledAt: existing, durationMinutes: 30 },
      ]);
      await expect(service.create(DTO)).rejects.toThrow(ConflictException);
    });

    it("creates and emits when slot is free", async () => {
      redis.set.mockResolvedValue("OK");
      redis.del.mockResolvedValue(1);
      repo.findConfirmedInRange.mockResolvedValue([]);
      const created = { id: "appt-1", scheduledAt: new Date(DTO.scheduledAt) };
      repo.create.mockResolvedValue(created);
      queue.add.mockResolvedValue({ id: "job-1" });
      repo.createReminder.mockResolvedValue({});

      await service.create(DTO);
      expect(repo.create).toHaveBeenCalledTimes(1);
      expect(gateway.emitAppointmentCreated).toHaveBeenCalledWith(created);
    });
  });
});
