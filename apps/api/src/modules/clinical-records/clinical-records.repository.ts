import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { Prisma } from "@cap/database";

const NOTE_SELECT = { author: { select: { fullName: true } } } as const;
const NOTE_WITH_PATIENT_SELECT = { ...NOTE_SELECT, patient: { select: { fullName: true } } } as const;

@Injectable()
export class ClinicalRecordsRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Clinical Notes ────────────────────────────────────────────────────────

  createNote(data: Prisma.ClinicalNoteCreateInput) {
    return this.prisma.clinicalNote.create({ data, include: NOTE_SELECT });
  }

  findNoteById(id: string) {
    return this.prisma.clinicalNote.findUnique({ where: { id }, include: NOTE_SELECT });
  }

  findNotesByPatientId(patientId: string) {
    return this.prisma.clinicalNote.findMany({
      where: { patientId },
      include: NOTE_SELECT,
      orderBy: { createdAt: "desc" },
    });
  }

  /** Every note across every patient — for the "my recent notes" worklist. Callers filter by
   * authorship themselves (same as findNotesByPatientId) since admin needs the unfiltered set too. */
  findAllNotes() {
    return this.prisma.clinicalNote.findMany({
      include: NOTE_WITH_PATIENT_SELECT,
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  }

  updateNote(id: string, data: Prisma.ClinicalNoteUpdateInput) {
    return this.prisma.clinicalNote.update({ where: { id }, data, include: NOTE_SELECT });
  }

  // ─── Prescriptions ─────────────────────────────────────────────────────────

  createPrescription(data: {
    patientId: string;
    clinicalNoteId?: string;
    prescribedByStaffId: string;
    notes?: string;
    items: { drugName: string; dosage: string; frequency: string; durationDays?: number; instructions?: string }[];
  }) {
    const { items, ...rest } = data;
    return this.prisma.prescription.create({
      data: { ...rest, items: { create: items } },
      include: { items: true, prescribedBy: { select: { fullName: true } } },
    });
  }

  findPrescriptionsByPatientId(patientId: string) {
    return this.prisma.prescription.findMany({
      where: { patientId },
      include: { items: true, prescribedBy: { select: { fullName: true } } },
      orderBy: { issuedAt: "desc" },
    });
  }

  // ─── Referrals ─────────────────────────────────────────────────────────────

  createReferral(data: Prisma.ReferralCreateInput) {
    return this.prisma.referral.create({
      data,
      include: {
        referredBy: { select: { fullName: true } },
        targetStaff: { select: { fullName: true } },
      },
    });
  }

  findReferralById(id: string) {
    return this.prisma.referral.findUnique({ where: { id } });
  }

  findReferralsByPatientId(patientId: string) {
    return this.prisma.referral.findMany({
      where: { patientId },
      include: {
        referredBy: { select: { fullName: true } },
        targetStaff: { select: { fullName: true } },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  updateReferralStatus(id: string, status: string) {
    return this.prisma.referral.update({
      where: { id },
      data: { status: status as never },
      include: {
        referredBy: { select: { fullName: true } },
        targetStaff: { select: { fullName: true } },
      },
    });
  }
}
