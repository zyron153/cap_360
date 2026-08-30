import { Test } from "@nestjs/testing";
import { ConflictException, BadRequestException } from "@nestjs/common";
import { getQueueToken } from "@nestjs/bull";
import { Prisma } from "@cap/database";
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
  findApprovedLeave: jest.fn(),
  findPublicHolidays: jest.fn(),
  findConfirmedInRangeForRoom: jest.fn(),
  createSeries: jest.fn(),
  findSeriesByIdempotencyKey: jest.fn(),
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
    // clearAllMocks resets call history but NOT a mockResolvedValue set by an earlier test —
    // without these, whichever test last configured prisma.setting.findUnique leaks its value
    // into every test declared after it in the file, regardless of describe-block boundaries.
    prisma.setting.findUnique.mockResolvedValue(null);
    repo.findApprovedLeave.mockResolvedValue(null);
    repo.findPublicHolidays.mockResolvedValue([]);
    repo.findConfirmedInRangeForRoom.mockResolvedValue([]);
    repo.findSeriesByIdempotencyKey.mockResolvedValue(null);
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
      // Build the date the same way the service does (local Y/M/D components — TEST_DATE is
      // "2026-07-01") to avoid a tz mismatch: `new Date(TEST_DATE)` anchors to UTC midnight,
      // which the service no longer does after the parseLocalDate fix.
      const booked = new Date(2026, 6, 1);
      booked.setHours(9, 0, 0, 0);
      repo.findConfirmedInRange.mockResolvedValue([
        { scheduledAt: booked, durationMinutes: 30 },
      ]);

      const slots = await service.getAvailability({ staffId: STAFF_ID, serviceId: "service-1", date: TEST_DATE });
      expect(slots[0].available).toBe(false); // 09:00 blocked
      expect(slots[1].available).toBe(true);  // 09:30 free
    });
  });

  describe("getAvailability — clinic hours, holidays, and leave", () => {
    beforeEach(() => {
      repo.findStaffAvailability.mockResolvedValue([
        { staffId: STAFF_ID, startTime: "09:00", endTime: "10:00" },
      ]);
      repo.findConfirmedInRange.mockResolvedValue([]);
    });

    it("returns no slots on a non-recurring public holiday matching the exact date", async () => {
      repo.findPublicHolidays.mockResolvedValue([
        { date: new Date(TEST_DATE), recurring: false },
      ]);
      const slots = await service.getAvailability({ staffId: STAFF_ID, serviceId: "service-1", date: TEST_DATE });
      expect(slots).toEqual([]);
    });

    it("returns no slots on a recurring holiday matching month+day regardless of year", async () => {
      // TEST_DATE is 2026-07-01 — a recurring holiday stored against a totally different year
      // must still match, since "recurring" means "every year on this month/day"
      repo.findPublicHolidays.mockResolvedValue([
        { date: new Date("2019-07-01"), recurring: true },
      ]);
      const slots = await service.getAvailability({ staffId: STAFF_ID, serviceId: "service-1", date: TEST_DATE });
      expect(slots).toEqual([]);
    });

    it("does not block on a holiday for an unrelated date", async () => {
      repo.findPublicHolidays.mockResolvedValue([
        { date: new Date("2026-12-25"), recurring: true },
      ]);
      const slots = await service.getAvailability({ staffId: STAFF_ID, serviceId: "service-1", date: TEST_DATE });
      expect(slots.length).toBeGreaterThan(0);
    });

    it("returns no slots when the staff member has approved leave covering this date", async () => {
      repo.findApprovedLeave.mockResolvedValue({ id: "leave-1", status: "approved" });
      const slots = await service.getAvailability({ staffId: STAFF_ID, serviceId: "service-1", date: TEST_DATE });
      expect(slots).toEqual([]);
    });

    it("returns no slots when the clinic itself is marked closed that weekday, even if the staff's own weekly availability includes it", async () => {
      // TEST_DATE 2026-07-01 is a Wednesday
      prisma.setting.findUnique.mockResolvedValue({
        value: { hours: [{ day: "Quarta-feira", active: false, open: "", close: "" }] },
      });
      const slots = await service.getAvailability({ staffId: STAFF_ID, serviceId: "service-1", date: TEST_DATE });
      expect(slots).toEqual([]);
    });

    it("marks a slot unavailable when it falls outside the clinic's configured hours, even if StaffAvailability allows it", async () => {
      // Staff availability is 09:00-10:00, but the clinic only opens at 09:30
      prisma.setting.findUnique.mockResolvedValue({
        value: { hours: [{ day: "Quarta-feira", active: true, open: "09:30", close: "18:00" }] },
      });
      const slots = await service.getAvailability({ staffId: STAFF_ID, serviceId: "service-1", date: TEST_DATE });
      expect(slots[0].available).toBe(false); // 09:00 — before clinic opens
      expect(slots[1].available).toBe(true);  // 09:30 — within clinic hours
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

  describe("create — room/equipment conflict detection", () => {
    const ROOM_ID = "room-1";
    const DTO = {
      patientId: "patient-1",
      staffId: STAFF_ID,
      serviceId: "service-1",
      roomId: ROOM_ID,
      scheduledAt: "2026-07-01T10:00:00.000Z",
      source: "web" as const,
    };

    beforeEach(() => {
      redis.set.mockResolvedValue("OK");
      redis.del.mockResolvedValue(1);
      repo.findConfirmedInRange.mockResolvedValue([]);
      repo.create.mockResolvedValue({ id: "appt-1", scheduledAt: new Date(DTO.scheduledAt) });
      queue.add.mockResolvedValue({ id: "job-1" });
      repo.createReminder.mockResolvedValue({});
    });

    it("throws ConflictException when the room is already booked, even if the staff member is free", async () => {
      repo.findConfirmedInRangeForRoom.mockResolvedValue([
        { scheduledAt: new Date(DTO.scheduledAt), durationMinutes: 30 },
      ]);
      await expect(service.create(DTO)).rejects.toThrow(ConflictException);
      expect(repo.create).not.toHaveBeenCalled();
    });

    it("skips the room-conflict check entirely when no room is assigned", async () => {
      await service.create({ ...DTO, roomId: undefined });
      expect(repo.findConfirmedInRangeForRoom).not.toHaveBeenCalled();
    });

    it("locks the room's time buckets too, not just the staff member's", async () => {
      await service.create({ ...DTO, scheduledAt: "2026-07-01T10:15:00.000Z" });

      const lockedKeys = redis.set.mock.calls.map((c) => c[0]);
      expect(lockedKeys).toEqual(
        expect.arrayContaining([
          expect.stringContaining(ROOM_ID),
          expect.stringContaining(STAFF_ID),
        ])
      );
    });

    it("rejects and releases every already-acquired lock (staff and room) when the room's bucket is contended", async () => {
      // Both staff buckets acquire fine, then the room's single bucket loses the race.
      redis.set
        .mockResolvedValueOnce("OK") // staff bucket 1
        .mockResolvedValueOnce("OK") // staff bucket 2
        .mockResolvedValueOnce(null); // room bucket — contended

      await expect(service.create({ ...DTO, scheduledAt: "2026-07-01T10:15:00.000Z" })).rejects.toThrow(
        ConflictException
      );
      expect(redis.del).toHaveBeenCalledTimes(2); // rolls back both staff locks it did acquire
      expect(repo.create).not.toHaveBeenCalled();
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

  describe("create — public holidays and staff leave", () => {
    const WED_10AM = new Date(2026, 6, 1, 10, 0, 0).toISOString();
    const BASE_DTO = {
      patientId: "patient-1",
      staffId: STAFF_ID,
      serviceId: "service-1",
      scheduledAt: WED_10AM,
      source: "web" as const,
    };

    beforeEach(() => {
      prisma.setting.findUnique.mockResolvedValue(null);
      redis.set.mockResolvedValue("OK");
      redis.del.mockResolvedValue(1);
      repo.findConfirmedInRange.mockResolvedValue([]);
      repo.create.mockResolvedValue({ id: "appt-1", scheduledAt: new Date(WED_10AM) });
      queue.add.mockResolvedValue({ id: "job-1" });
      repo.createReminder.mockResolvedValue({});
    });

    it("throws BadRequestException on a public holiday", async () => {
      repo.findPublicHolidays.mockResolvedValue([{ date: new Date(2026, 6, 1), recurring: false }]);
      await expect(service.create(BASE_DTO)).rejects.toThrow(BadRequestException);
      expect(repo.create).not.toHaveBeenCalled();
    });

    it("throws BadRequestException when the assigned staff has approved leave covering this date", async () => {
      repo.findApprovedLeave.mockResolvedValue({ id: "leave-1", status: "approved" });
      await expect(service.create(BASE_DTO)).rejects.toThrow(BadRequestException);
      expect(repo.create).not.toHaveBeenCalled();
    });

    it("does not acquire the Redis slot lock when rejected for a holiday or leave", async () => {
      repo.findApprovedLeave.mockResolvedValue({ id: "leave-1", status: "approved" });
      await expect(service.create(BASE_DTO)).rejects.toThrow(BadRequestException);
      expect(redis.set).not.toHaveBeenCalled();
    });

    it("creates normally when there is no holiday or leave in the way", async () => {
      await expect(service.create(BASE_DTO)).resolves.toBeDefined();
      expect(repo.create).toHaveBeenCalledTimes(1);
    });
  });

  describe("createSeries — recurring appointments", () => {
    // 2026-07-01 10:00 local, a Wednesday.
    const FIRST = new Date(2026, 6, 1, 10, 0, 0).toISOString();
    const BASE_DTO = {
      patientId: "patient-1",
      staffId: STAFF_ID,
      serviceId: "service-1",
      scheduledAt: FIRST,
      source: "web" as const,
    };

    beforeEach(() => {
      redis.set.mockResolvedValue("OK");
      redis.del.mockResolvedValue(1);
      repo.findConfirmedInRange.mockResolvedValue([]);
      queue.add.mockResolvedValue({ id: "job-1" });
      repo.createReminder.mockResolvedValue({});
      repo.createSeries.mockResolvedValue({ id: "series-1" });
      // Every occurrence's repo.create call gets its own fake row echoing back whatever data it
      // was given, so assertions can inspect exactly what each occurrence was created with.
      repo.create.mockImplementation((data) => Promise.resolve({ id: `appt-${data.scheduledAt}`, ...data }));
    });

    it("creates the series record once, then one appointment per weekly occurrence", async () => {
      const result = await service.createSeries({ ...BASE_DTO, frequency: "weekly", interval: 1, occurrenceCount: 3 });

      expect(repo.createSeries).toHaveBeenCalledTimes(1);
      expect(result.created).toHaveLength(3);
      expect(result.seriesId).toBe("series-1");

      const dates = result.created.map((a: { scheduledAt: string | Date }) => new Date(a.scheduledAt).getDate());
      expect(dates).toEqual([1, 8, 15]); // July 1, 8, 15 — 7 days apart
    });

    it("links each created occurrence to the series with a 1-based index", async () => {
      await service.createSeries({ ...BASE_DTO, frequency: "weekly", interval: 1, occurrenceCount: 2 });

      const calls = repo.create.mock.calls.map((c) => c[0]);
      expect(calls[0]).toMatchObject({ series: { connect: { id: "series-1" } }, seriesIndex: 1 });
      expect(calls[1]).toMatchObject({ series: { connect: { id: "series-1" } }, seriesIndex: 2 });
    });

    it("steps by the given interval — every 2 days", async () => {
      const result = await service.createSeries({ ...BASE_DTO, frequency: "daily", interval: 2, occurrenceCount: 3 });
      const dates = result.created.map((a: { scheduledAt: string | Date }) => new Date(a.scheduledAt).getDate());
      expect(dates).toEqual([1, 3, 5]);
    });

    it("stops generating once the end date is passed, for a monthly recurrence", async () => {
      // Starts July 1, monthly, ends Sep 15 — should produce Jul 1, Aug 1, Sep 1 (3 occurrences),
      // not a 4th on Oct 1.
      const result = await service.createSeries({
        ...BASE_DTO, frequency: "monthly", interval: 1, endDate: "2026-09-15",
      });
      expect(result.created).toHaveLength(3);
    });

    it("skips an occurrence that lands on a public holiday and reports it, without aborting the rest of the series", async () => {
      // Weekly Jul 1 / 8 / 15 — a one-off holiday on Jul 8 should skip just that one.
      repo.findPublicHolidays.mockResolvedValue([{ date: new Date(2026, 6, 8), recurring: false }]);

      const result = await service.createSeries({ ...BASE_DTO, frequency: "weekly", interval: 1, occurrenceCount: 3 });

      expect(result.created).toHaveLength(2);
      expect(result.skipped).toHaveLength(1);
      expect(new Date(result.skipped[0].date).getDate()).toBe(8);
      expect(result.skipped[0].reason).toMatch(/feriado/i);
    });

    it("passes roomId through to every occurrence when one is assigned", async () => {
      await service.createSeries({ ...BASE_DTO, roomId: "room-1", frequency: "weekly", interval: 1, occurrenceCount: 2 });
      const calls = repo.create.mock.calls.map((c) => c[0]);
      expect(calls[0]).toMatchObject({ room: { connect: { id: "room-1" } } });
      expect(calls[1]).toMatchObject({ room: { connect: { id: "room-1" } } });
    });

    it("replays the existing series without creating a new one when the idempotency key was already used", async () => {
      const existing = { id: "series-existing", appointments: [{ id: "appt-a" }, { id: "appt-b" }] };
      repo.findSeriesByIdempotencyKey.mockResolvedValue(existing);

      const result = await service.createSeries({
        ...BASE_DTO, frequency: "weekly", interval: 1, occurrenceCount: 3, idempotencyKey: "key-1",
      });

      expect(result).toEqual({ seriesId: "series-existing", created: existing.appointments, skipped: [] });
      expect(repo.createSeries).not.toHaveBeenCalled();
      expect(repo.create).not.toHaveBeenCalled();
    });

    it("returns the concurrently-created series instead of throwing when two requests race on the same idempotency key", async () => {
      // Pre-check sees nothing yet (both requests passed it), then createSeries hits the unique
      // constraint because the other request won the race — look the real one up and return it.
      repo.findSeriesByIdempotencyKey
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: "series-raced", appointments: [{ id: "appt-a" }] });
      repo.createSeries.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError("Unique constraint failed on the fields: (`idempotencyKey`)", {
          code: "P2002",
          clientVersion: "6.19.3",
          meta: { target: ["idempotencyKey"] },
        })
      );

      const result = await service.createSeries({
        ...BASE_DTO, frequency: "weekly", interval: 1, occurrenceCount: 3, idempotencyKey: "key-1",
      });

      expect(result).toEqual({ seriesId: "series-raced", created: [{ id: "appt-a" }], skipped: [] });
      expect(repo.create).not.toHaveBeenCalled();
    });
  });
});
