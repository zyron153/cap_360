import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { EncryptionService } from "../../common/services/encryption.service";
import { Prisma } from "@cap/database";

const NOTE_SELECT = { author: { select: { fullName: true } } } as const;
const NOTE_WITH_PATIENT_SELECT = { ...NOTE_SELECT, patient: { select: { fullName: true } } } as const;

type NoteTextFields = {
  presentingConcerns: string;
  observations: string;
  assessment: string;
  plan: string;
  riskNotes: string | null;
};
type PartialNoteTextFields = Partial<Pick<NoteTextFields, "presentingConcerns" | "observations" | "assessment" | "plan">> & {
  riskNotes?: string | null;
};
type ItemTextFields = { drugName: string; dosage: string; frequency: string; instructions: string | null };

@Injectable()
export class ClinicalRecordsRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
  ) {}

  // ─── Encryption helpers ────────────────────────────────────────────────────
  // Same posture as PatientsRepository's nif/dateOfBirth: AES-256-GCM at the application layer,
  // encrypted on every write, decrypted on every read — no blind index needed here since nothing
  // does an exact-match lookup on clinical text (unlike nif's uniqueness check).

  private encryptNoteFields<T extends PartialNoteTextFields>(data: T): T {
    return {
      ...data,
      ...(data.presentingConcerns !== undefined && { presentingConcerns: this.encryption.encrypt(data.presentingConcerns) }),
      ...(data.observations !== undefined && { observations: this.encryption.encrypt(data.observations) }),
      ...(data.assessment !== undefined && { assessment: this.encryption.encrypt(data.assessment) }),
      ...(data.plan !== undefined && { plan: this.encryption.encrypt(data.plan) }),
      ...(data.riskNotes && { riskNotes: this.encryption.encrypt(data.riskNotes) }),
    };
  }

  private decryptNote<T extends NoteTextFields>(note: T): T {
    return {
      ...note,
      presentingConcerns: this.encryption.decrypt(note.presentingConcerns),
      observations: this.encryption.decrypt(note.observations),
      assessment: this.encryption.decrypt(note.assessment),
      plan: this.encryption.decrypt(note.plan),
      riskNotes: note.riskNotes ? this.encryption.decrypt(note.riskNotes) : note.riskNotes,
    };
  }

  private decryptNotes<T extends NoteTextFields>(notes: T[]): T[] {
    return notes.map((n) => this.decryptNote(n));
  }

  private decryptItem<T extends ItemTextFields>(item: T): T {
    return {
      ...item,
      drugName: this.encryption.decrypt(item.drugName),
      dosage: this.encryption.decrypt(item.dosage),
      frequency: this.encryption.decrypt(item.frequency),
      instructions: item.instructions ? this.encryption.decrypt(item.instructions) : item.instructions,
    };
  }

  private decryptPrescription<T extends { notes: string | null; items: ItemTextFields[] }>(rx: T): T {
    return {
      ...rx,
      notes: rx.notes ? this.encryption.decrypt(rx.notes) : rx.notes,
      items: rx.items.map((i) => this.decryptItem(i)),
    };
  }

  // ─── Clinical Notes ────────────────────────────────────────────────────────

  async createNote(data: Prisma.ClinicalNoteCreateInput) {
    const note = await this.prisma.clinicalNote.create({
      data: this.encryptNoteFields(data as PartialNoteTextFields) as Prisma.ClinicalNoteCreateInput,
      include: NOTE_SELECT,
    });
    return this.decryptNote(note);
  }

  async findNoteById(id: string) {
    const note = await this.prisma.clinicalNote.findUnique({ where: { id }, include: NOTE_SELECT });
    return note && this.decryptNote(note);
  }

  async findNotesByPatientId(patientId: string) {
    const notes = await this.prisma.clinicalNote.findMany({
      where: { patientId },
      include: NOTE_SELECT,
      orderBy: { createdAt: "desc" },
    });
    return this.decryptNotes(notes);
  }

  /** Every note across every patient — for the "my recent notes" worklist. Callers filter by
   * authorship themselves (same as findNotesByPatientId) since admin needs the unfiltered set too. */
  async findAllNotes() {
    const notes = await this.prisma.clinicalNote.findMany({
      include: NOTE_WITH_PATIENT_SELECT,
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return this.decryptNotes(notes);
  }

  async updateNote(id: string, data: Prisma.ClinicalNoteUpdateInput) {
    const note = await this.prisma.clinicalNote.update({
      where: { id },
      data: this.encryptNoteFields(data as PartialNoteTextFields) as Prisma.ClinicalNoteUpdateInput,
      include: NOTE_SELECT,
    });
    return this.decryptNote(note);
  }

  // ─── Prescriptions ─────────────────────────────────────────────────────────

  async createPrescription(data: {
    patientId: string;
    clinicalNoteId?: string;
    prescribedByStaffId: string;
    notes?: string;
    items: { drugName: string; dosage: string; frequency: string; durationDays?: number; instructions?: string }[];
  }) {
    const { items, notes, ...rest } = data;
    const rx = await this.prisma.prescription.create({
      data: {
        ...rest,
        ...(notes && { notes: this.encryption.encrypt(notes) }),
        items: {
          create: items.map((it) => ({
            ...it,
            drugName: this.encryption.encrypt(it.drugName),
            dosage: this.encryption.encrypt(it.dosage),
            frequency: this.encryption.encrypt(it.frequency),
            ...(it.instructions && { instructions: this.encryption.encrypt(it.instructions) }),
          })),
        },
      },
      include: { items: true, prescribedBy: { select: { fullName: true } } },
    });
    return this.decryptPrescription(rx);
  }

  async findPrescriptionsByPatientId(patientId: string) {
    const list = await this.prisma.prescription.findMany({
      where: { patientId },
      include: { items: true, prescribedBy: { select: { fullName: true } } },
      orderBy: { issuedAt: "desc" },
    });
    return list.map((rx) => this.decryptPrescription(rx));
  }

  // ─── Referrals ─────────────────────────────────────────────────────────────
  // Not encrypted — REVIEW.md/SECURITY.md flag clinical notes and prescriptions specifically;
  // referrals weren't asked for and are named-provider/specialty metadata more than clinical
  // detail. Revisit if that changes.

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
