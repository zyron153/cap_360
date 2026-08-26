import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { Prisma } from "@cap/database";

@Injectable()
export class PatientsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findMany(args: Prisma.PatientFindManyArgs) {
    return this.prisma.patient.findMany(args);
  }

  count(args: Prisma.PatientCountArgs) {
    return this.prisma.patient.count(args);
  }

  findById(id: string) {
    return this.prisma.patient.findFirst({ where: { id, deletedAt: null } });
  }

  findByPhone(phone: string) {
    return this.prisma.patient.findFirst({ where: { phone, deletedAt: null } });
  }

  findByNif(nif: string) {
    return this.prisma.patient.findFirst({ where: { nif, deletedAt: null } });
  }

  create(data: Prisma.PatientCreateInput) {
    return this.prisma.patient.create({ data });
  }

  update(id: string, data: Prisma.PatientUpdateInput) {
    return this.prisma.patient.update({ where: { id }, data });
  }

  softDelete(id: string) {
    return this.prisma.patient.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  createNote(data: Prisma.PatientNoteCreateInput) {
    return this.prisma.patientNote.create({ data });
  }

  findNotesForPatient(patientId: string) {
    return this.prisma.patientNote.findMany({
      where: { patientId },
      orderBy: { createdAt: "desc" },
    });
  }

  findTimelineEvents(patientId: string) {
    return Promise.all([
      this.prisma.appointment.findMany({
        where: { patientId, deletedAt: null },
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
        where: { patientId },
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
        where: { patientId },
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
  }
}
