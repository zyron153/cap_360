import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  Inject,
} from "@nestjs/common";
import { InjectQueue } from "@nestjs/bull";
import { Queue } from "bull";
import type { Redis } from "ioredis";
import { REDIS_CLIENT } from "../../common/redis/redis.module";
import { PrismaService } from "../../prisma/prisma.service";
import { Prisma } from "@cap/database";
import { AppointmentsRepository } from "./appointments.repository";
import { AppointmentsGateway } from "./appointments.gateway";
import { BillingService } from "../billing/billing.service";
import { NotificationsService } from "../notifications/notifications.service";
import {
  CreateAppointmentDto,
  CreateAppointmentSeriesDto,
  UpdateAppointmentStatusDto,
  RescheduleAppointmentDto,
  AvailabilityQuery,
  JoinWaitlistDto,
  TimeSlot,
  AppointmentCalendarQuery,
} from "@cap/types";

const SLOT_MINUTES = 30;
const SLOT_LOCK_TTL_MS = 30_000;

// JS Date#getDay() is 0=Sunday..6=Saturday — matches the day order in ClinicSettings.hours
const DAY_NAMES = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"];

interface ClinicHour { day: string; open: string; close: string; active: boolean }

// A bare "YYYY-MM-DD" query param has no timezone of its own — it means "this calendar date in
// the clinic's own local time" (exactly how ClinicHour/StaffAvailability's bare "HH:MM" strings
// are already interpreted). Parsing it with `new Date("YYYY-MM-DD")` instead anchors it to UTC
// midnight, which silently shifts to the wrong local calendar day — and the wrong weekday — on
// any server whose OS timezone isn't UTC+0 (Cabo Verde itself is UTC-1). Building the Date from
// explicit local components sidesteps that entirely.
function parseLocalDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Same local parsing as parseLocalDate, but anchored to the end of that calendar day — so an
 * occurrence at any time-of-day on the end date itself still counts as "on or before" it. */
function parseLocalDateEndOfDay(dateStr: string): Date {
  const d = parseLocalDate(dateStr);
  d.setHours(23, 59, 59, 999);
  return d;
}

@Injectable()
export class AppointmentsService {
  constructor(
    private readonly repo: AppointmentsRepository,
    private readonly gateway: AppointmentsGateway,
    private readonly billingService: BillingService,
    private readonly notifService: NotificationsService,
    private readonly prisma: PrismaService,
    @InjectQueue("reminders") private readonly remindersQueue: Queue,
    @Inject(REDIS_CLIENT) private readonly redis: Redis
  ) {}

  // Clinic-wide operating hours (Configurações → Clínica) for this date. Not yet configured, or
  // no entry for this weekday, is unrestricted; an entry marked inactive means closed all day.
  private async getBusinessWindow(date: Date): Promise<{ open: string; close: string } | "closed" | null> {
    const row = await this.prisma.setting.findUnique({ where: { key: "clinic" } });
    const hours = (row?.value as { hours?: ClinicHour[] } | undefined)?.hours;
    if (!hours?.length) return null;

    const today = hours.find((h) => h.day === DAY_NAMES[date.getDay()]);
    if (!today) return null;
    if (!today.active) return "closed";
    return { open: today.open, close: today.close };
  }

  /** A `recurring` holiday repeats every year on the same month/day — the stored year is
   * irrelevant to the match. A non-recurring one is a one-off, matched on the exact date. */
  private isPublicHoliday(date: Date, holidays: { date: Date; recurring: boolean }[]): boolean {
    return holidays.some((h) =>
      h.recurring
        ? h.date.getUTCMonth() === date.getUTCMonth() && h.date.getUTCDate() === date.getUTCDate()
        : h.date.getUTCFullYear() === date.getUTCFullYear() &&
          h.date.getUTCMonth() === date.getUTCMonth() &&
          h.date.getUTCDate() === date.getUTCDate()
    );
  }

  /** Everything that can make a whole day unbookable for this staff member: a public holiday,
   * the clinic's own weekly schedule marking the day closed, or that staff member's own approved
   * leave. Returns a user-facing reason (for create() to throw) plus the open/close window (for
   * getAvailability() to clip individual slots against) so both call sites share one source of
   * truth instead of drifting — the original bug was exactly this: create() checked hours,
   * getAvailability() didn't, so the booking UI could offer a slot that got rejected on submit. */
  private async loadBookingConstraints(staffId: string, date: Date) {
    const [holidays, leave, window] = await Promise.all([
      this.repo.findPublicHolidays(),
      staffId ? this.repo.findApprovedLeave(staffId, date) : null,
      this.getBusinessWindow(date),
    ]);

    const blockReason = this.isPublicHoliday(date, holidays)
      ? "A clínica está encerrada — feriado nacional"
      : leave
      ? "O profissional está de licença nesta data"
      : window === "closed"
      ? `A clínica está encerrada à ${DAY_NAMES[date.getDay()]}`
      : null;

    return { blockReason, window: window === "closed" ? null : window };
  }

  private isWithinWindow(start: Date, end: Date, window: { open: string; close: string } | null): boolean {
    if (!window) return true;
    const [openH, openM] = window.open.split(":").map(Number);
    const [closeH, closeM] = window.close.split(":").map(Number);
    const dayStart = new Date(start);
    dayStart.setHours(openH, openM, 0, 0);
    const dayEnd = new Date(start);
    dayEnd.setHours(closeH, closeM, 0, 0);
    return start >= dayStart && end <= dayEnd;
  }

  async getAvailability(query: AvailabilityQuery): Promise<TimeSlot[]> {
    const date = parseLocalDate(query.date);
    const dayOfWeek = date.getDay();

    const { blockReason, window } = await this.loadBookingConstraints(query.staffId ?? "", date);
    if (blockReason) return [];

    const availabilityRows = await this.repo.findStaffAvailability(
      query.staffId ?? "",
      dayOfWeek
    );
    if (!availabilityRows.length) return [];

    const bookedSlots = await this.repo.findConfirmedInRange(
      query.staffId ?? "",
      date
    );

    const slots: TimeSlot[] = [];

    for (const avail of availabilityRows) {
      const [startH, startM] = avail.startTime.split(":").map(Number);
      const [endH, endM] = avail.endTime.split(":").map(Number);

      const cursor = new Date(date);
      cursor.setHours(startH, startM, 0, 0);
      const end = new Date(date);
      end.setHours(endH, endM, 0, 0);

      while (cursor < end) {
        const slotEnd = new Date(cursor.getTime() + SLOT_MINUTES * 60_000);
        const isBooked = bookedSlots.some((b) => {
          const bStart = new Date(b.scheduledAt);
          const bEnd = new Date(
            bStart.getTime() + b.durationMinutes * 60_000
          );
          return cursor < bEnd && slotEnd > bStart;
        });

        slots.push({
          start: cursor.toISOString(),
          end: slotEnd.toISOString(),
          staffId: avail.staffId,
          staffName: "",
          available: !isBooked && this.isWithinWindow(cursor, slotEnd, window),
        });

        cursor.setMinutes(cursor.getMinutes() + SLOT_MINUTES);
      }
    }

    return slots;
  }

  async create(dto: CreateAppointmentDto, seriesLink?: { seriesId: string; seriesIndex: number }) {
    // Checked first, before any locking or conflict check: a retried request (double-click,
    // client timeout retry) must replay the original booking, not re-run booking logic that
    // could now see a different (already-booked-by-itself) world.
    if (dto.idempotencyKey) {
      const existing = await this.repo.findByIdempotencyKey(dto.idempotencyKey);
      if (existing) return existing;
    }

    const scheduledAt = new Date(dto.scheduledAt);
    const slotEnd = new Date(scheduledAt.getTime() + SLOT_MINUTES * 60_000);

    const { blockReason, window } = await this.loadBookingConstraints(dto.staffId, scheduledAt);
    if (blockReason) throw new BadRequestException(blockReason);
    if (!this.isWithinWindow(scheduledAt, slotEnd, window)) {
      throw new BadRequestException(
        `Fora do horário de funcionamento da clínica (${window!.open}–${window!.close})`
      );
    }

    // A non-grid-aligned start time (e.g. 10:15) spans two 30-min buckets — lock every bucket
    // the appointment touches, not just its exact start, so two overlapping-but-not-identical
    // requests (10:00–10:30 vs 10:15–10:45) actually contend for a shared key. A room is locked
    // the same way when one is assigned — a room can be double-booked by two different staff
    // members just as easily as one staff member double-books themselves.
    const lockKeys = await this.acquireSlotLocks([
      ...this.slotBucketKeys(`staff:${dto.staffId}`, scheduledAt, slotEnd),
      ...(dto.roomId ? this.slotBucketKeys(`room:${dto.roomId}`, scheduledAt, slotEnd) : []),
    ]);

    try {
      const conflicts = await this.repo.findConfirmedInRange(dto.staffId, scheduledAt);
      if (this.hasOverlap(conflicts, scheduledAt, slotEnd)) {
        throw new ConflictException("This time slot is already booked");
      }

      if (dto.roomId) {
        const roomConflicts = await this.repo.findConfirmedInRangeForRoom(dto.roomId, scheduledAt);
        if (this.hasOverlap(roomConflicts, scheduledAt, slotEnd)) {
          throw new ConflictException("This room is already booked for this time slot");
        }
      }

      const appointment = await this.repo.create({
        patient: { connect: { id: dto.patientId } },
        staff: { connect: { id: dto.staffId } },
        service: { connect: { id: dto.serviceId } },
        ...(dto.roomId ? { room: { connect: { id: dto.roomId } } } : {}),
        scheduledAt,
        source: dto.source,
        notes: dto.notes,
        idempotencyKey: dto.idempotencyKey,
        ...(seriesLink
          ? { series: { connect: { id: seriesLink.seriesId } }, seriesIndex: seriesLink.seriesIndex }
          : {}),
      });

      await this.enqueueReminders(appointment.id, scheduledAt);
      await this.notifService.notifyConfirm(appointment.id);
      this.gateway.emitAppointmentCreated(appointment);

      return appointment;
    } finally {
      await Promise.all(lockKeys.map((key) => this.redis.del(key)));
    }
  }

  /** Every occurrence date for a recurring series, stepping by `interval` × `frequency` from
   * `start`, stopping at whichever of `endDate`/`occurrenceCount` the caller provided (the DTO's
   * own validation already guarantees exactly one of them is set). The hard cap is a safety net,
   * not the primary limit — occurrenceCount's own Zod max is lower. */
  private computeOccurrenceDates(
    start: Date,
    frequency: "daily" | "weekly" | "monthly",
    interval: number,
    endDate?: Date,
    occurrenceCount?: number
  ): Date[] {
    const HARD_CAP = 104;
    const dates: Date[] = [];
    const cursor = new Date(start);

    while (dates.length < HARD_CAP) {
      if (endDate && cursor > endDate) break;
      dates.push(new Date(cursor));
      if (occurrenceCount && dates.length >= occurrenceCount) break;

      if (frequency === "daily") cursor.setDate(cursor.getDate() + interval);
      else if (frequency === "weekly") cursor.setDate(cursor.getDate() + interval * 7);
      else cursor.setMonth(cursor.getMonth() + interval);
    }

    return dates;
  }

  /** Pre-generates every occurrence as a normal Appointment (via create(), so each one gets the
   * exact same business-hours/holiday/leave/conflict checks as a manually-booked one) linked back
   * to one AppointmentSeries row. Best-effort: an occurrence that fails its own booking checks
   * (e.g. lands on a holiday, or a slot that's since been taken) is skipped and reported, rather
   * than aborting the whole series over one distant conflict. */
  async createSeries(dto: CreateAppointmentSeriesDto) {
    // Checked first, same reasoning as create()'s own idempotency check: a retried request
    // (double-click, slow-network retry) must replay the original series, not generate a second.
    if (dto.idempotencyKey) {
      const existing = await this.repo.findSeriesByIdempotencyKey(dto.idempotencyKey);
      if (existing) return { seriesId: existing.id, created: existing.appointments, skipped: [] };
    }

    const firstDate = new Date(dto.scheduledAt);
    const dates = this.computeOccurrenceDates(
      firstDate,
      dto.frequency,
      dto.interval,
      dto.endDate ? parseLocalDateEndOfDay(dto.endDate) : undefined,
      dto.occurrenceCount
    );

    let series;
    try {
      series = await this.repo.createSeries({
        patient: { connect: { id: dto.patientId } },
        staff: { connect: { id: dto.staffId } },
        service: { connect: { id: dto.serviceId } },
        ...(dto.roomId ? { room: { connect: { id: dto.roomId } } } : {}),
        frequency: dto.frequency,
        interval: dto.interval,
        endDate: dto.endDate ? parseLocalDate(dto.endDate) : null,
        occurrenceCount: dto.occurrenceCount ?? null,
        idempotencyKey: dto.idempotencyKey,
      });
    } catch (err) {
      // The pre-check above is a friendly fast path, not a guarantee — two concurrent requests
      // with the same key can both pass it and race to the DB's unique constraint. Whoever loses
      // the race gets the winner's series back instead of an unhandled 500.
      if (dto.idempotencyKey && err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        const raced = await this.repo.findSeriesByIdempotencyKey(dto.idempotencyKey);
        if (raced) return { seriesId: raced.id, created: raced.appointments, skipped: [] };
      }
      throw err;
    }

    const created: Awaited<ReturnType<AppointmentsService["create"]>>[] = [];
    const skipped: { date: string; reason: string }[] = [];

    for (const [i, date] of dates.entries()) {
      try {
        const appointment = await this.create(
          {
            patientId: dto.patientId,
            staffId: dto.staffId,
            serviceId: dto.serviceId,
            roomId: dto.roomId,
            scheduledAt: date.toISOString(),
            source: dto.source,
            notes: dto.notes,
          },
          { seriesId: series.id, seriesIndex: i + 1 }
        );
        created.push(appointment);
      } catch (err) {
        skipped.push({ date: date.toISOString(), reason: err instanceof Error ? err.message : "Unknown error" });
      }
    }

    return { seriesId: series.id, created, skipped };
  }

  /** Every SLOT_MINUTES-aligned bucket the half-open interval [start, end) touches, for a given
   * resource key (e.g. "staff:<id>" or "room:<id>") — the caller picks which resource. */
  private slotBucketKeys(resourceKey: string, start: Date, end: Date): string[] {
    const keys: string[] = [];
    const cursor = new Date(start);
    cursor.setSeconds(0, 0);
    cursor.setMinutes(Math.floor(cursor.getMinutes() / SLOT_MINUTES) * SLOT_MINUTES);
    while (cursor < end) {
      keys.push(`slot:${resourceKey}:${cursor.toISOString()}`);
      cursor.setMinutes(cursor.getMinutes() + SLOT_MINUTES);
    }
    return keys;
  }

  private hasOverlap(bookings: { scheduledAt: Date; durationMinutes: number }[], start: Date, end: Date): boolean {
    return bookings.some((b) => {
      const bStart = new Date(b.scheduledAt);
      const bEnd = new Date(bStart.getTime() + b.durationMinutes * 60_000);
      return start < bEnd && end > bStart;
    });
  }

  /** Acquires every key or none — rolls back whatever it already grabbed before throwing. */
  private async acquireSlotLocks(keys: string[]): Promise<string[]> {
    const acquired: string[] = [];
    for (const key of keys) {
      const locked = await this.redis.set(key, "1", "PX", SLOT_LOCK_TTL_MS, "NX");
      if (!locked) {
        await Promise.all(acquired.map((k) => this.redis.del(k)));
        throw new ConflictException("This time slot is temporarily locked — please retry");
      }
      acquired.push(key);
    }
    return acquired;
  }

  async findById(id: string) {
    const appointment = await this.repo.findById(id);
    if (!appointment) throw new NotFoundException(`Appointment ${id} not found`);
    return appointment;
  }

  async findCalendar(query: AppointmentCalendarQuery) {
    return this.repo.findMany({
      where: {
        deletedAt: null,
        scheduledAt: {
          gte: new Date(query.from),
          lte: new Date(`${query.to}T23:59:59Z`),
        },
        ...(query.staffId ? { staffId: query.staffId } : {}),
        ...(query.patientId ? { patientId: query.patientId } : {}),
      },
      include: {
        patient: { select: { id: true, fullName: true } },
        staff: { select: { id: true, fullName: true } },
        service: { select: { id: true, name: true, durationMinutes: true } },
      },
      orderBy: { scheduledAt: "asc" },
    });
  }

  async updateStatus(id: string, dto: UpdateAppointmentStatusDto) {
    const appointment = await this.repo.findById(id);
    if (!appointment) throw new NotFoundException(`Appointment ${id} not found`);

    const data: Record<string, unknown> = { status: dto.status };
    if (dto.cancellationReason)
      data.cancellationReason = dto.cancellationReason;
    if (dto.status === "checked_in") data.checkedInAt = new Date();
    if (dto.status === "completed") data.completedAt = new Date();

    const updated = await this.repo.update(id, data);
    this.gateway.emitAppointmentUpdated(updated);

    if (dto.status === "cancelled") {
      await this.cancelPendingReminders(id);
      await this.notifService.notifyCancel(id);
    }

    if (dto.status === "completed" && appointment.service) {
      const unitPrice = Number(appointment.service.price);
      if (unitPrice > 0) {
        await this.billingService.createDraft({
          patientId: appointment.patientId,
          appointmentId: id,
          serviceId: appointment.serviceId,
          serviceName: appointment.service.name,
          unitPrice,
        }).catch((err: unknown) => {
          console.error(`[billing] auto-invoice failed for appointment ${id}:`, err);
        });
      }
    }

    return updated;
  }

  async reschedule(id: string, dto: RescheduleAppointmentDto) {
    const appointment = await this.repo.findById(id);
    if (!appointment) throw new NotFoundException(`Appointment ${id} not found`);
    if (!["pending", "confirmed"].includes(appointment.status)) {
      throw new BadRequestException("Only pending/confirmed appointments can be rescheduled");
    }

    const newTime = new Date(dto.scheduledAt);
    await this.cancelPendingReminders(id);

    const updated = await this.repo.update(id, {
      scheduledAt: newTime,
      status: "pending",
    });
    await this.enqueueReminders(id, newTime);
    this.gateway.emitAppointmentUpdated(updated);
    return updated;
  }

  /** Deletes an appointment's pending reminder rows and removes their BullMQ jobs — shared by
   * reschedule() (which re-enqueues fresh ones after) and updateStatus()'s cancel branch (which
   * doesn't: a cancelled appointment should never fire its 48h/24h/2h reminders). */
  private async cancelPendingReminders(id: string): Promise<void> {
    const existingReminders = await this.repo.deleteReminders(id);
    await Promise.all(
      existingReminders
        .filter((r) => r.bullJobId)
        .map(async (r) => {
          const job = await this.remindersQueue.getJob(r.bullJobId!);
          await job?.remove();
        })
    );
  }

  async joinWaitlist(dto: JoinWaitlistDto) {
    return this.repo.createWaitlistEntry({
      patient: { connect: { id: dto.patientId } },
      service: { connect: { id: dto.serviceId } },
      ...(dto.staffId ? { staffId: dto.staffId } : {}),
      preferredDateFrom: dto.preferredDateFrom
        ? new Date(dto.preferredDateFrom)
        : undefined,
      preferredDateTo: dto.preferredDateTo
        ? new Date(dto.preferredDateTo)
        : undefined,
      notes: dto.notes,
    });
  }

  getWaitlist(serviceId?: string) {
    return this.repo.findWaitlist(serviceId);
  }

  private async enqueueReminders(appointmentId: string, scheduledAt: Date) {
    if (!(await this.notifService.isReminderEnabled())) return;
    const offsets = [48 * 60, 24 * 60, 2 * 60];

    for (const offsetMin of offsets) {
      const delay = scheduledAt.getTime() - Date.now() - offsetMin * 60_000;
      if (delay <= 0) continue;

      const job = await this.remindersQueue.add(
        "send-reminder",
        { appointmentId, offsetMin },
        { delay, attempts: 3, backoff: { type: "exponential", delay: 5000 } }
      );

      await this.repo.createReminder({
        appointment: { connect: { id: appointmentId } },
        channel: "whatsapp",
        scheduledFor: new Date(scheduledAt.getTime() - offsetMin * 60_000),
        bullJobId: String(job.id),
      });
    }
  }
}
