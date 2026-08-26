import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import type { TimelineEvent } from "@cap/types";

@Injectable()
export class BffService {
  constructor(private readonly prisma: PrismaService) {}

  async getPatientScreen(id: string) {
    const [patient, appointments, comms, invoices] = await Promise.all([
      this.prisma.patient.findFirst({
        where: { id, deletedAt: null },
        include: { healthPlan: { select: { planNumber: true, product: { select: { name: true } } } } },
      }),
      this.prisma.appointment.findMany({
        where: { patientId: id, deletedAt: null },
        select: {
          id: true,
          scheduledAt: true,
          status: true,
          service: { select: { name: true } },
          staff: { select: { fullName: true } },
        },
        orderBy: { scheduledAt: "desc" },
        take: 20,
      }),
      this.prisma.communicationLog.findMany({
        where: { patientId: id },
        select: {
          id: true,
          channel: true,
          direction: true,
          subject: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
        take: 20,
      }),
      this.prisma.invoice.findMany({
        where: { patientId: id },
        select: {
          id: true,
          invoiceNumber: true,
          total: true,
          status: true,
          issuedAt: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
        take: 20,
      }),
    ]);

    if (!patient) throw new NotFoundException(`Patient ${id} not found`);

    const timeline: TimelineEvent[] = [
      ...appointments.map((a) => ({
        id: a.id,
        type: "appointment" as const,
        title: a.service.name,
        description: `${a.staff.fullName} — ${a.status}`,
        date: a.scheduledAt.toISOString(),
        metadata: { status: a.status },
      })),
      ...comms.map((c) => ({
        id: c.id,
        type: "communication" as const,
        title: c.subject ?? `${c.channel} ${c.direction}`,
        date: c.createdAt.toISOString(),
        metadata: { channel: c.channel, direction: c.direction },
      })),
      ...invoices.map((i) => ({
        id: i.id,
        type: "invoice" as const,
        title: `Fatura ${i.invoiceNumber}`,
        description: `${Number(i.total).toFixed(2)} CVE — ${i.status}`,
        date: (i.issuedAt ?? i.createdAt).toISOString(),
        metadata: { status: i.status, total: i.total },
      })),
    ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    return { patient, timeline };
  }

  getStaffList() {
    return this.prisma.staff.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        fullName: true,
        email: true,
        role: true,
        jobTitle: true,
        phone: true,
        specialtyCode: true,
        availability: {
          where: { active: true },
          select: { dayOfWeek: true, startTime: true, endTime: true },
          orderBy: { dayOfWeek: "asc" },
        },
      },
      orderBy: { fullName: "asc" },
    });
  }

  async getBillingSummary() {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [issuedCount, collected, overdueCount] = await Promise.all([
      this.prisma.invoice.count({
        where: { status: "issued", createdAt: { gte: startOfMonth } },
      }),
      this.prisma.invoice.aggregate({
        where: { status: "paid", createdAt: { gte: startOfMonth } },
        _sum: { amountPaid: true },
      }),
      this.prisma.invoice.count({ where: { status: "overdue" } }),
    ]);

    return {
      issuedCount,
      collectedAmount: Number(collected._sum.amountPaid ?? 0),
      overdueCount,
    };
  }
}
