import { Test } from "@nestjs/testing";
import { ConflictException, BadRequestException } from "@nestjs/common";
import { getQueueToken } from "@nestjs/bull";
import { AppointmentsService } from "./appointments.service";
import { AppointmentsRepository } from "./appointments.repository";
import { AppointmentsGateway } from "./appointments.gateway";
import { BillingService } from "../billing/billing.service";
import { NotificationsService } from "../notifications/notifications.service";
import { PrismaService } from "../../prisma/prisma.service";
import { REDIS_CLIENT } from "../../common/redis/redis.module";

const prisma = { setting: { findUnique: jest.fn() } };
const repo = {
  findStaffAvailability: jest.fn(),
  findConfirmedInRange: jest.fn(),
  findById: jest.fn(),
  findByIdempotencyKey: jest.fn(),
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
        { provide: PrismaService, useValue: prisma },
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

    it("locks every 30-min grid bucket the appointment spans, not just its exact start time", async () => {
      // 10:15 isn't grid-aligned — a 30-min appointment starting here touches both the
      // [10:00,10:30) and [10:30,11:00) buckets, so a request for either must contend with it.
      redis.set.mockResolvedValue("OK");
      redis.del.mockResolvedValue(1);
      repo.findConfirmedInRange.mockResolvedValue([]);
      repo.create.mockResolvedValue({ id: "appt-1", scheduledAt: new Date("2026-07-01T10:15:00.000Z") });
      queue.add.mockResolvedValue({ id: "job-1" });
      repo.createReminder.mockResolvedValue({});

      await service.create({ ...DTO, scheduledAt: "2026-07-01T10:15:00.000Z" });

      const lockedKeys = redis.set.mock.calls.map((c) => c[0]);
      expect(lockedKeys).toEqual(
        expect.arrayContaining([
          expect.stringContaining("2026-07-01T10:00:00"),
          expect.stringContaining("2026-07-01T10:30:00"),
        ])
      );
    });

    it("rejects and releases already-acquired locks when only one of the spanned buckets is held", async () => {
      // First bucket free, second already locked by someone else — must not leave the first
      // bucket's lock dangling for its full TTL just because a sibling bucket lost the race.
      redis.set.mockResolvedValueOnce("OK").mockResolvedValueOnce(null);
      redis.del.mockResolvedValue(1);

      await expect(service.create({ ...DTO, scheduledAt: "2026-07-01T10:15:00.000Z" })).rejects.toThrow(ConflictException);
      expect(redis.del).toHaveBeenCalledTimes(1); // rolls back the one lock it did acquire
      expect(repo.create).not.toHaveBeenCalled();
    });

    it("returns the original appointment without creating again when the idempotency key was already used", async () => {
      const original = { id: "appt-original", scheduledAt: new Date(DTO.scheduledAt) };
      repo.findByIdempotencyKey.mockResolvedValue(original);

      const result = await service.create({ ...DTO, idempotencyKey: "key-abc" });

      expect(result).toBe(original);
      expect(redis.set).not.toHaveBeenCalled(); // never even attempts to lock a slot for a replay
      expect(repo.create).not.toHaveBeenCalled();
    });

    it("creates normally and stores the key when it hasn't been used before", async () => {
      repo.findByIdempotencyKey.mockResolvedValue(null);
      redis.set.mockResolvedValue("OK");
      redis.del.mockResolvedValue(1);
      repo.findConfirmedInRange.mockResolvedValue([]);
      repo.create.mockResolvedValue({ id: "appt-1", scheduledAt: new Date(DTO.scheduledAt) });
      queue.add.mockResolvedValue({ id: "job-1" });
      repo.createReminder.mockResolvedValue({});

      await service.create({ ...DTO, idempotencyKey: "key-new" });

      expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: "key-new" }));
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

  describe("create — business hours validation", () => {
    // 2026-07-01 is a Wednesday ("Quarta-feira"); 2026-07-05 is a Sunday ("Domingo")
    const WED_10AM = new Date(2026, 6, 1, 10, 0, 0).toISOString();
    const BASE_DTO = {
      patientId: "patient-1",
      staffId: STAFF_ID,
      serviceId: "service-1",
      scheduledAt: WED_10AM,
      source: "web" as const,
    };

    beforeEach(() => {
      redis.set.mockResolvedValue("OK");
      redis.del.mockResolvedValue(1);
      repo.findConfirmedInRange.mockResolvedValue([]);
      repo.create.mockResolvedValue({ id: "appt-1", scheduledAt: new Date(WED_10AM) });
      queue.add.mockResolvedValue({ id: "job-1" });
      repo.createReminder.mockResolvedValue({});
    });

    it("allows scheduling when no clinic hours are configured yet (permissive default)", async () => {
      prisma.setting.findUnique.mockResolvedValue(null);
      await expect(service.create(BASE_DTO)).resolves.toBeDefined();
    });

    it("allows scheduling when that weekday has no matching hours entry", async () => {
      prisma.setting.findUnique.mockResolvedValue({
        value: { hours: [{ day: "Segunda-feira", active: true, open: "08:00", close: "18:00" }] },
      });
      await expect(service.create(BASE_DTO)).resolves.toBeDefined();
    });

    it("throws BadRequestException when the clinic is marked closed that day", async () => {
      prisma.setting.findUnique.mockResolvedValue({
        value: { hours: [{ day: "Domingo", active: false, open: "", close: "" }] },
      });
      const sunday = new Date(2026, 6, 5, 10, 0, 0).toISOString();
      await expect(service.create({ ...BASE_DTO, scheduledAt: sunday })).rejects.toThrow(BadRequestException);
    });

    it("throws BadRequestException when scheduledAt is before the opening time", async () => {
      prisma.setting.findUnique.mockResolvedValue({
        value: { hours: [{ day: "Quarta-feira", active: true, open: "09:00", close: "18:00" }] },
      });
      const early = new Date(2026, 6, 1, 8, 0, 0).toISOString();
      await expect(service.create({ ...BASE_DTO, scheduledAt: early })).rejects.toThrow(BadRequestException);
    });

    it("throws BadRequestException when the appointment would end after closing time", async () => {
      prisma.setting.findUnique.mockResolvedValue({
        value: { hours: [{ day: "Quarta-feira", active: true, open: "08:00", close: "17:00" }] },
      });
      const late = new Date(2026, 6, 1, 16, 45, 0).toISOString(); // ends 17:15, past 17:00 close
      await expect(service.create({ ...BASE_DTO, scheduledAt: late })).rejects.toThrow(BadRequestException);
    });

    it("creates successfully when fully within the configured hours", async () => {
      prisma.setting.findUnique.mockResolvedValue({
        value: { hours: [{ day: "Quarta-feira", active: true, open: "08:00", close: "18:00" }] },
      });
      await expect(service.create(BASE_DTO)).resolves.toBeDefined();
      expect(repo.create).toHaveBeenCalledTimes(1);
    });

    it("does not acquire the Redis slot lock when rejected for being outside business hours", async () => {
      prisma.setting.findUnique.mockResolvedValue({
        value: { hours: [{ day: "Domingo", active: false, open: "", close: "" }] },
      });
      const sunday = new Date(2026, 6, 5, 10, 0, 0).toISOString();
      await expect(service.create({ ...BASE_DTO, scheduledAt: sunday })).rejects.toThrow(BadRequestException);
      expect(redis.set).not.toHaveBeenCalled();
    });
  });
});
