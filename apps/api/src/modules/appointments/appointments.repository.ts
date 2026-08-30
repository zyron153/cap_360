import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { Prisma } from "@cap/database";

@Injectable()
export class AppointmentsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findMany(args: Prisma.AppointmentFindManyArgs) {
    return this.prisma.appointment.findMany(args);
  }

  count(args: Prisma.AppointmentCountArgs) {
    return this.prisma.appointment.count(args);
  }

  findById(id: string) {
    return this.prisma.appointment.findFirst({
      where: { id, deletedAt: null },
      include: {
        patient: { select: { id: true, fullName: true, phone: true } },
        staff: { select: { id: true, fullName: true, role: true } },
        service: { select: { id: true, name: true, durationMinutes: true, price: true } },
        room: { select: { id: true, name: true } },
      },
    });
  }

  /** A retried "create appointment" request (double-click, timeout retry) with the same
   * client-supplied key returns the original appointment instead of creating a duplicate. */
  findByIdempotencyKey(idempotencyKey: string) {
    return this.prisma.appointment.findUnique({
      where: { idempotencyKey },
      include: {
        patient: { select: { id: true, fullName: true, phone: true } },
        staff: { select: { id: true, fullName: true } },
        service: { select: { id: true, name: true } },
      },
    });
  }

  create(data: Prisma.AppointmentCreateInput) {
    return this.prisma.appointment.create({
      data,
      include: {
        patient: { select: { id: true, fullName: true, phone: true } },
        staff: { select: { id: true, fullName: true } },
        service: { select: { id: true, name: true } },
      },
    });
  }

  update(id: string, data: Prisma.AppointmentUpdateInput) {
    return this.prisma.appointment.update({ where: { id }, data });
  }

  createSeries(data: Prisma.AppointmentSeriesCreateInput) {
    return this.prisma.appointmentSeries.create({ data });
  }

  /** A retried "create series" request (double-click, slow-network retry) with the same
   * client-supplied key returns the original series instead of creating a duplicate. */
  findSeriesByIdempotencyKey(idempotencyKey: string) {
    return this.prisma.appointmentSeries.findUnique({
      where: { idempotencyKey },
      include: { appointments: true },
    });
  }

  private dayBounds(date: Date) {
    const dayStart = new Date(date);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(date);
    dayEnd.setHours(23, 59, 59, 999);
    return { dayStart, dayEnd };
  }

  findConfirmedInRange(staffId: string, date: Date) {
    const { dayStart, dayEnd } = this.dayBounds(date);
    return this.prisma.appointment.findMany({
      where: {
        staffId,
        scheduledAt: { gte: dayStart, lte: dayEnd },
        status: { in: ["pending", "confirmed", "checked_in"] },
        deletedAt: null,
      },
      select: { scheduledAt: true, durationMinutes: true },
    });
  }

  /** Same shape as findConfirmedInRange, filtered by room instead of staff — a room can be
   * double-booked by two different staff members just as easily as one staff member double-books
   * themselves, so this needs its own conflict check. */
  findConfirmedInRangeForRoom(roomId: string, date: Date) {
    const { dayStart, dayEnd } = this.dayBounds(date);
    return this.prisma.appointment.findMany({
      where: {
        roomId,
        scheduledAt: { gte: dayStart, lte: dayEnd },
        status: { in: ["pending", "confirmed", "checked_in"] },
        deletedAt: null,
      },
      select: { scheduledAt: true, durationMinutes: true },
    });
  }

  findStaffAvailability(staffId: string, dayOfWeek: number) {
    return this.prisma.staffAvailability.findMany({
      where: { staffId, dayOfWeek, active: true },
    });
  }

  /** Whole-day block: an approved leave request covering this date for this staff member. */
  findApprovedLeave(staffId: string, date: Date) {
    return this.prisma.leaveRequest.findFirst({
      where: { staffId, status: "approved", startDate: { lte: date }, endDate: { gte: date } },
    });
  }

  /** Small, rarely-changing table — fetch all of them and let the caller match month/day for
   * `recurring` holidays (they repeat every year, so a stored year is irrelevant to the match). */
  findPublicHolidays(countryCode = "CV") {
    return this.prisma.publicHoliday.findMany({ where: { countryCode } });
  }

  findStaffShift(staffId: string, date: Date) {
    return this.prisma.staffShift.findUnique({
      where: { staffId_shiftDate: { staffId, shiftDate: date } },
    });
  }

  createReminder(data: Prisma.AppointmentReminderCreateInput) {
    return this.prisma.appointmentReminder.create({ data });
  }

  deleteReminders(appointmentId: string) {
    return this.prisma.appointmentReminder.findMany({
      where: { appointmentId },
    });
  }

  createWaitlistEntry(data: Prisma.WaitlistCreateInput) {
    return this.prisma.waitlist.create({ data });
  }

  findWaitlist(serviceId?: string) {
    return this.prisma.waitlist.findMany({
      where: {
        status: "waiting",
        ...(serviceId ? { serviceId } : {}),
      },
      include: {
        patient: { select: { id: true, fullName: true, phone: true } },
        service: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "asc" },
    });
  }
}
