import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { EncryptionService } from "../../common/services/encryption.service";
import { Prisma } from "@cap/database";
import type { ClinicalAccessLogQuery, ClinicalListQuery, ClinicalNoteListQuery } from "@cap/types";
import { cvDayStart, cvDayEnd, cvParts } from "../../common/cabo-verde-time";
import { CROSS_AUTHOR_READ_BASIS } from "./clinical-records.constants";

/** Why a draft could not be deleted (or that it was) — the service turns each into the right HTTP answer. */
export type DraftDeleteResult = "deleted" | "not_found" | "finalized" | "linked";

/** skip/take for a 1-based page. Callers (the controller's pipe) always pass validated numbers; the defaults are for
 * in-process callers. */
function pageArgs(q: ClinicalListQuery) {
  const limit = q.limit ?? 100;
  return { skip: ((q.page ?? 1) - 1) * limit, take: limit };
}

const NOTE_SELECT = { author: { select: { fullName: true } } } as const;
const NOTE_WITH_PATIENT_SELECT = { ...NOTE_SELECT, patient: { select: { fullName: true } } } as const;
const REFERRAL_INCLUDE = {
  referredBy: { select: { fullName: true } },
  targetStaff: { select: { fullName: true } },
} as const;

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

  /** One page of a patient's notes, newest first. `scope` narrows it to what a non-admin reader may see — their own
   * notes, plus (when `includeOthersFinalized`) every author's finalized ones — in the query itself, so the page is
   * a page of what they can see (filtering after `take` would shrink pages and decrypt rows nobody may read). */
  async findNotesByPatientId(
    patientId: string,
    opts: ClinicalListQuery & { scope?: { readerId: string; includeOthersFinalized: boolean } } = {},
  ) {
    const { scope } = opts;
    const visible: Prisma.ClinicalNoteWhereInput[] = scope
      ? [{ authorStaffId: scope.readerId }, ...(scope.includeOthersFinalized ? [{ finalizedAt: { not: null } }] : [])]
      : [];
    const notes = await this.prisma.clinicalNote.findMany({
      where: { patientId, ...(scope && { OR: visible }) },
      include: NOTE_SELECT,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      ...pageArgs(opts),
    });
    return this.decryptNotes(notes);
  }

  /** A note's identity and state without decrypting anything — enough to decide who may do what with it. */
  findNoteHeader(id: string) {
    return this.prisma.clinicalNote.findUnique({
      where: { id },
      select: { id: true, patientId: true, appointmentId: true, authorStaffId: true, finalizedAt: true, createdAt: true },
    });
  }

  /** Deletes a DRAFT, and only a draft nothing refers to — all in the DELETE's own WHERE, so a note finalized (or
   * given a prescription) a moment ago is never removed. The prescriptions/referrals foreign keys are RESTRICT too, so
   * a link created in the instant between the check and the delete still can't be silently detached: the database
   * refuses (P2003), which is reported the same way. When nothing was deleted, a re-read says why. */
  async deleteDraftNote(id: string): Promise<DraftDeleteResult> {
    try {
      const { count } = await this.prisma.clinicalNote.deleteMany({
        where: { id, finalizedAt: null, prescriptions: { none: {} }, referrals: { none: {} } },
      });
      if (count > 0) return "deleted";
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003") return "linked";
      throw err;
    }
    const now = await this.prisma.clinicalNote.findUnique({ where: { id }, select: { finalizedAt: true } });
    if (!now) return "not_found";
    return now.finalizedAt ? "finalized" : "linked";
  }

  /** The patient, unless it doesn't exist or was erased — what a write (a new note, prescription, referral) needs. */
  findPatientForWrite(patientId: string) {
    return this.prisma.patient.findFirst({ where: { id: patientId, deletedAt: null }, select: { id: true } });
  }

  /** Role/active state of a staff member — to check an internal referral's target. */
  findStaffForReferral(id: string) {
    return this.prisma.staff.findUnique({ where: { id }, select: { id: true, role: true, deletedAt: true } });
  }

  /** Notes across every patient — the doctor's history and day-queue lookups. Authorship is a DB
   * filter (not applied after `take`, which let other doctors' newer notes crowd a doctor's own
   * out of the page). Clinical text is encrypted, so `q` can only match the patient's name. */
  async findAllNotes(filter: ClinicalNoteListQuery & { authorStaffId?: string }) {
    const where: Prisma.ClinicalNoteWhereInput = {
      ...(filter.authorStaffId && { authorStaffId: filter.authorStaffId }),
      ...(filter.appointmentId && { appointmentId: filter.appointmentId }),
      ...(filter.riskLevel && { riskLevel: filter.riskLevel }),
      ...(filter.status && { finalizedAt: filter.status === "draft" ? null : { not: null } }),
      ...(filter.q && { patient: { fullName: { contains: filter.q, mode: "insensitive" } } }),
      ...((filter.from || filter.to) && {
        createdAt: {
          ...(filter.from && { gte: cvDayStart(filter.from) }),
          ...(filter.to && { lte: cvDayEnd(filter.to) }),
        },
      }),
    };
    const limit = filter.limit ?? 100;
    const notes = await this.prisma.clinicalNote.findMany({
      where,
      include: NOTE_WITH_PATIENT_SELECT,
      // id as the tiebreak keeps pages stable when notes share a createdAt.
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: ((filter.page ?? 1) - 1) * limit,
      take: limit,
    });
    return this.decryptNotes(notes);
  }

  /** The one note this clinician has for this appointment (the DB enforces at most one). */
  async findNoteByAppointmentAndAuthor(appointmentId: string, authorStaffId: string) {
    const note = await this.prisma.clinicalNote.findUnique({
      where: { appointmentId_authorStaffId: { appointmentId, authorStaffId } },
      include: NOTE_SELECT,
    });
    return note && this.decryptNote(note);
  }

  /** The patient an appointment belongs to, or null when it doesn't exist. */
  async findAppointmentPatientId(appointmentId: string) {
    const a = await this.prisma.appointment.findUnique({ where: { id: appointmentId }, select: { patientId: true } });
    return a?.patientId ?? null;
  }

  /** With `expectedUpdatedAt` this is a compare-and-set: it writes only if the row still has that
   * `updatedAt` (nobody saved in between) and returns null otherwise — the check and the write are
   * one statement, so two simultaneous saves can't both pass. */
  async updateNote(id: string, data: Prisma.ClinicalNoteUpdateInput, expectedUpdatedAt?: Date) {
    const encrypted = this.encryptNoteFields(data as PartialNoteTextFields) as Prisma.ClinicalNoteUpdateInput;
    if (expectedUpdatedAt) {
      const { count } = await this.prisma.clinicalNote.updateMany({
        where: { id, updatedAt: expectedUpdatedAt },
        data: encrypted as Prisma.ClinicalNoteUpdateManyMutationInput,
      });
      return count === 0 ? null : this.findNoteById(id);
    }
    const note = await this.prisma.clinicalNote.update({ where: { id }, data: encrypted, include: NOTE_SELECT });
    return this.decryptNote(note);
  }

  /** Is this patient in treatment today (Cabo Verde day) — checked in, or already seen — *because someone
   * other than `readerId` put them there*? The basis on which a clinician may read other clinicians'
   * finalized notes for them (see the service). A doctor who checked the patient in (and completed it)
   * all by themself doesn't qualify, so booking + checking in can't be used to unlock someone's notes.
   * Actor unknown (null/null — a system action, or a row from before actors were recorded) qualifies. */
  async hasTreatmentToday(patientId: string, readerId: string): Promise<boolean> {
    const today = cvParts(new Date()).date;
    const n = await this.prisma.appointment.count({
      where: {
        patientId,
        deletedAt: null,
        status: { in: ["checked_in", "completed"] },
        scheduledAt: { gte: cvDayStart(today), lte: cvDayEnd(today) },
        OR: [
          { checkedInByStaffId: null, completedByStaffId: null },
          { AND: [{ checkedInByStaffId: { not: null } }, { checkedInByStaffId: { not: readerId } }] },
          { AND: [{ completedByStaffId: { not: null } }, { completedByStaffId: { not: readerId } }] },
        ],
      },
    });
    return n > 0;
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
        // Blank optional text is stored as NULL, never as an empty string.
        ...(notes?.trim() && { notes: this.encryption.encrypt(notes) }),
        items: {
          create: items.map(({ drugName, dosage, frequency, durationDays, instructions }) => ({
            drugName: this.encryption.encrypt(drugName),
            dosage: this.encryption.encrypt(dosage),
            frequency: this.encryption.encrypt(frequency),
            durationDays,
            ...(instructions?.trim() && { instructions: this.encryption.encrypt(instructions) }),
          })),
        },
      },
      include: { items: true, prescribedBy: { select: { fullName: true } } },
    });
    return this.decryptPrescription(rx);
  }

  /** One page, newest first. `prescribedByStaffId` narrows it to one prescriber (a non-admin's own). */
  async findPrescriptionsByPatientId(patientId: string, opts: ClinicalListQuery & { prescribedByStaffId?: string } = {}) {
    const list = await this.prisma.prescription.findMany({
      where: { patientId, ...(opts.prescribedByStaffId && { prescribedByStaffId: opts.prescribedByStaffId }) },
      include: { items: true, prescribedBy: { select: { fullName: true } } },
      orderBy: [{ issuedAt: "desc" }, { id: "desc" }],
      ...pageArgs(opts),
    });
    return list.map((rx) => this.decryptPrescription(rx));
  }

  // ─── Referrals ─────────────────────────────────────────────────────────────
  // Not encrypted — REVIEW.md/SECURITY.md flag clinical notes and prescriptions specifically;
  // referrals weren't asked for and are named-provider/specialty metadata more than clinical
  // detail. Revisit if that changes.

  createReferral(data: Prisma.ReferralCreateInput) {
    return this.prisma.referral.create({ data, include: REFERRAL_INCLUDE });
  }

  findReferralById(id: string) {
    return this.prisma.referral.findUnique({ where: { id }, include: REFERRAL_INCLUDE });
  }

  /** One page, newest first. `involvedStaffId` narrows it to referrals that person sent or received. */
  findReferralsByPatientId(patientId: string, opts: ClinicalListQuery & { involvedStaffId?: string } = {}) {
    return this.prisma.referral.findMany({
      where: {
        patientId,
        ...(opts.involvedStaffId && { OR: [{ referredByStaffId: opts.involvedStaffId }, { targetStaffId: opts.involvedStaffId }] }),
      },
      include: REFERRAL_INCLUDE,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      ...pageArgs(opts),
    });
  }

  /** Compare-and-set on the status the caller saw (`from`): the check and the write are one statement, so two people
   * moving the same referral at once can't both pass the transition rules. null = it is no longer in `from`. */
  async updateReferralStatus(id: string, from: string, to: string) {
    const { count } = await this.prisma.referral.updateMany({
      where: { id, status: from as never },
      data: { status: to as never },
    });
    return count === 0 ? null : this.findReferralById(id);
  }

  // ─── Cross-author read report (admin) ──────────────────────────────────────────────────────────────────────
  // Backed by audit_log: ClinicalRecordsService marks every read that returned another author's notes under the
  // "treating today" exception (metadata.diff.after.basis), and AuditInterceptor stores the row. The marks are rare, so
  // the partial index audit_log_cross_author_read_idx (migration 20261006000100…) serves exactly this predicate — keep the
  // filter below in step with it, or the query falls back to reading the whole table.

  findCrossAuthorReads(query: ClinicalAccessLogQuery) {
    const limit = query.limit ?? 50;
    return this.prisma.auditLog.findMany({
      where: { action: "GET", metadata: { path: ["diff", "after", "basis"], equals: CROSS_AUTHOR_READ_BASIS } },
      // id breaks ties, so a page boundary can't repeat or skip rows that share a millisecond
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: ((query.page ?? 1) - 1) * limit,
      take: limit,
      select: { id: true, createdAt: true, actorId: true, actorEmail: true, resourceId: true, metadata: true },
    });
  }

  /** Names for the report. Soft-deleted staff are still found (their row stays); only a hard-deleted one is missing. */
  async findStaffNames(ids: string[]): Promise<Map<string, string>> {
    if (!ids.length) return new Map();
    const rows = await this.prisma.staff.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true } });
    return new Map(rows.map((s) => [s.id, s.fullName]));
  }

  async findNotePatientIds(noteIds: string[]): Promise<Map<string, string>> {
    if (!noteIds.length) return new Map();
    const rows = await this.prisma.clinicalNote.findMany({ where: { id: { in: noteIds } }, select: { id: true, patientId: true } });
    return new Map(rows.map((n) => [n.id, n.patientId]));
  }

  /** id -> fullName (null for an erased patient); an id that doesn't exist at all is absent from the map. */
  async findPatientNames(ids: string[]): Promise<Map<string, string | null>> {
    if (!ids.length) return new Map();
    const rows = await this.prisma.patient.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true } });
    return new Map(rows.map((p) => [p.id, p.fullName]));
  }
}
