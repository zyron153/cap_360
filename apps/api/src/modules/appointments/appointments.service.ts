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
import { AppointmentsRepository } from "./appointments.repository";
import { AppointmentsGateway } from "./appointments.gateway";
import { BillingService } from "../billing/billing.service";
import { NotificationsService } from "../notifications/notifications.service";
import {
  CreateAppointmentDto,
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

  // Clinic-wide operating hours (Configurações → Clínica). Not yet configured, or no entry
  // for this weekday, is treated as unrestricted rather than blocking every booking.
  private async assertWithinBusinessHours(scheduledAt: Date, durationMinutes: number) {
    const row = await this.prisma.setting.findUnique({ where: { key: "clinic" } });
    const hours = (row?.value as { hours?: ClinicHour[] } | undefined)?.hours;
    if (!hours?.length) return;

    const today = hours.find((h) => h.day === DAY_NAMES[scheduledAt.getDay()]);
    if (!today) return;

    if (!today.active) {
      throw new BadRequestException(`A clínica está encerrada à ${today.day}`);
    }

    const [openH, openM] = today.open.split(":").map(Number);
    const [closeH, closeM] = today.close.split(":").map(Number);
    const dayStart = new Date(scheduledAt);
    dayStart.setHours(openH, openM, 0, 0);
    const dayEnd = new Date(scheduledAt);
    dayEnd.setHours(closeH, closeM, 0, 0);
    const apptEnd = new Date(scheduledAt.getTime() + durationMinutes * 60_000);

    if (scheduledAt < dayStart || apptEnd > dayEnd) {
      throw new BadRequestException(
        `Fora do horário de funcionamento da clínica (${today.open}–${today.close})`
      );
    }
  }

  async getAvailability(query: AvailabilityQuery): Promise<TimeSlot[]> {
    const date = new Date(query.date);
    const dayOfWeek = date.getDay();

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
          available: !isBooked,
        });

        cursor.setMinutes(cursor.getMinutes() + SLOT_MINUTES);
      }
    }

    return slots;
  }

  async create(dto: CreateAppointmentDto) {
    const scheduledAt = new Date(dto.scheduledAt);
    const slotEnd = new Date(scheduledAt.getTime() + SLOT_MINUTES * 60_000);

    await this.assertWithinBusinessHours(scheduledAt, SLOT_MINUTES);

    const lockKey = `slot:${dto.staffId}:${scheduledAt.toISOString()}`;
    const locked = await this.redis.set(lockKey, "1", "PX", SLOT_LOCK_TTL_MS, "NX");
    if (!locked) {
      throw new ConflictException("This time slot is temporarily locked — please retry");
    }

    try {
      const conflicts = await this.repo.findConfirmedInRange(dto.staffId, scheduledAt);
      const hasConflict = conflicts.some((b) => {
        const bStart = new Date(b.scheduledAt);
        const bEnd = new Date(bStart.getTime() + b.durationMinutes * 60_000);
        return scheduledAt < bEnd && slotEnd > bStart;
      });
      if (hasConflict) {
        throw new ConflictException("This time slot is already booked");
      }

      const appointment = await this.repo.create({
        patient: { connect: { id: dto.patientId } },
        staff: { connect: { id: dto.staffId } },
        service: { connect: { id: dto.serviceId } },
        ...(dto.roomId ? { room: { connect: { id: dto.roomId } } } : {}),
        scheduledAt,
        source: dto.source,
        notes: dto.notes,
      });

      await this.enqueueReminders(appointment.id, scheduledAt);
      await this.notifService.notifyConfirm(appointment.id);
      this.gateway.emitAppointmentCreated(appointment);

      return appointment;
    } finally {
      await this.redis.del(lockKey);
    }
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

    // Cancel existing reminder jobs — parallel to avoid N+1 queue lookups
    const existingReminders = await this.repo.deleteReminders(id);
    await Promise.all(
      existingReminders
        .filter((r) => r.bullJobId)
        .map(async (r) => {
          const job = await this.remindersQueue.getJob(r.bullJobId!);
          await job?.remove();
        })
    );

    const updated = await this.repo.update(id, {
      scheduledAt: newTime,
      status: "pending",
    });
    await this.enqueueReminders(id, newTime);
    this.gateway.emitAppointmentUpdated(updated);
    return updated;
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
