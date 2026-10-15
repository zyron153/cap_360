import { Injectable, NotFoundException, BadRequestException, ConflictException } from "@nestjs/common";
import { Prisma } from "@cap/database";
import { RequestContext } from "../../common/context/request-context";
import { ClinicalRecordsRepository } from "./clinical-records.repository";
import { CROSS_AUTHOR_READ_BASIS, REFERRAL_TARGET_ROLES } from "./clinical-records.constants";
import { JwtUser } from "../../common/decorators/current-user.decorator";
import {
  CreateClinicalNoteDto,
  UpdateClinicalNoteDto,
  ClinicalAccessLogEntry,
  ClinicalAccessLogQuery,
  ClinicalListQuery,
  ClinicalNoteListQuery,
  CreatePrescriptionDto,
  CreateReferralDto,
  ReferralStatus,
  REFERRAL_STATUS_TRANSITIONS,
  finalNoteIssues,
  NOTE_CHANGED_CODE,
  NOTE_FINALIZED_CODE,
  NOTE_HAS_LINKED_RECORDS_CODE,
} from "@cap/types";

const EDIT_WINDOW_MS = 24 * 60 * 60 * 1000;

/** `code` of the 409 when two people moved the same referral at once (the loser is told, and gets the current one). */
const REFERRAL_CHANGED_CODE = "REFERRAL_CHANGED";

/** Notes/prescriptions are scoped by authorship, not a separate patient/clinician assignment
 * table this app has nowhere else — a clinician sees only what they themselves wrote; admin sees
 * everything. A missing-or-not-yours record both 404 identically, so a caller can't tell "doesn't
 * exist" from "not yours" (same posture as HealthPlansService's corporate_hr scoping). Referrals
 * are the one exception: an internal referral's target clinician also needs to see and act on it.
 *
 * Notes have one more, narrow exception (a doctor covering for a colleague needs the history): while
 * a patient is in treatment today — an appointment today that is checked in or completed, put there by
 * someone other than the reader — any clinician may READ the other authors' FINALIZED notes for that patient. Read-only (writes stay
 * author/admin), drafts are never shared, it lapses at the end of the Cabo Verde day, and every such
 * read carries a marker in the audit log (which the admin can review: `listCrossAuthorReads`).
 * See `Docs/modules/M7-clinical-records-emr.md` §3. */
@Injectable()
export class ClinicalRecordsService {
  constructor(private readonly repo: ClinicalRecordsRepository) {}

  private isAdmin(user: JwtUser) {
    return user.roles.includes("admin");
  }

  /** Writes (a new note, prescription, referral) need a live patient: a missing or erased one used to surface as a 500
   * from the foreign key. Same 404 wording as the patients module. */
  private async ensurePatient(patientId: string) {
    if (!(await this.repo.findPatientForWrite(patientId))) throw new NotFoundException(`Patient ${patientId} not found`);
  }

  /** The note a prescription/referral says it came from must be one of the caller's own notes for THIS patient (admin:
   * any note of this patient). One 400 for every way it can be wrong — missing, someone else's, another patient's —
   * so it can't be used to probe which note ids exist. */
  private async assertOwnNoteOfPatient(noteId: string, patientId: string, user: JwtUser) {
    const note = await this.repo.findNoteHeader(noteId);
    if (!note || note.patientId !== patientId || !(this.isAdmin(user) || note.authorStaffId === user.sub)) {
      throw new BadRequestException("clinicalNoteId must be one of your own notes for this patient");
    }
  }

  /** A row this one points at (the note, the target clinician) vanished between the check and the write. */
  private referencedRowGone(err: unknown): never {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003") {
      throw new BadRequestException("A record this one refers to no longer exists");
    }
    throw err;
  }

  // ─── Clinical Notes ────────────────────────────────────────────────────────

  async createNote(patientId: string, dto: CreateClinicalNoteDto, user: JwtUser) {
    const { draft, appointmentId, riskNotes, ...fields } = dto;
    await this.ensurePatient(patientId);
    if (appointmentId && (await this.repo.findAppointmentPatientId(appointmentId)) !== patientId) {
      throw new BadRequestException("That appointment does not belong to this patient");
    }
    // One note per appointment per clinician (a unique index). A second create — another tab, or a
    // reload before the first autosave returned — is a conflict, answered with the existing note so
    // the editor can let the doctor choose; silently continuing it would overwrite the other tab's text.
    // The lookup is the friendly fast path; the index is the guarantee, so a request that loses a
    // simultaneous race gets the same 409 instead of a 500 (same shape as AppointmentsService).
    if (appointmentId) {
      const existing = await this.repo.findNoteByAppointmentAndAuthor(appointmentId, user.sub);
      if (existing) throw this.noteChanged(existing, "You already have a note for this appointment");
    }
    // Risk detail: whitespace-only is "none", and a FINAL note at level "none" carries none (a draft keeps what was typed —
    // the doctor may flip the level back).
    const keepRiskNotes = riskNotes?.trim() && (draft || fields.riskLevel !== "none") ? riskNotes : undefined;
    try {
      return await this.repo.createNote({
        patient: { connect: { id: patientId } },
        author: { connect: { id: user.sub } },
        ...(appointmentId ? { appointment: { connect: { id: appointmentId } } } : {}),
        ...fields,
        ...(keepRiskNotes ? { riskNotes: keepRiskNotes } : {}),
        finalizedAt: draft ? null : new Date(),
      });
    } catch (err) {
      if (appointmentId && err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        const raced = await this.repo.findNoteByAppointmentAndAuthor(appointmentId, user.sub);
        if (raced) throw this.noteChanged(raced, "You already have a note for this appointment");
      }
      throw err;
    }
  }

  /** 409 carrying the current note, so a client that lost can show it and let the doctor choose. */
  private noteChanged(current: unknown, message = "This note was changed elsewhere since you opened it") {
    return new ConflictException({ statusCode: 409, error: "Conflict", code: NOTE_CHANGED_CODE, message, note: current });
  }

  /** One page of the patient's notes, newest first. A non-admin gets their own plus — while the patient is in treatment
   * today — other authors' finalized ones; that scope is part of the query, not a filter after it. */
  async listNotesForPatient(patientId: string, user: JwtUser, query: ClinicalListQuery = {}) {
    if (this.isAdmin(user)) return this.repo.findNotesByPatientId(patientId, query);
    const shared = await this.repo.hasTreatmentToday(patientId, user.sub);
    const notes = await this.repo.findNotesByPatientId(patientId, {
      ...query,
      scope: { readerId: user.sub, includeOthersFinalized: shared },
    });
    const others = notes.filter((n) => n.authorStaffId !== user.sub).length;
    if (others > 0) RequestContext.setAuditDiff(undefined, { basis: CROSS_AUTHOR_READ_BASIS, otherAuthorsNotes: others });
    return notes;
  }

  listAllNotes(user: JwtUser, query: ClinicalNoteListQuery = {}) {
    return this.repo.findAllNotes({
      ...query,
      ...(this.isAdmin(user) ? {} : { authorStaffId: user.sub }),
    });
  }

  /** `mode: "write"` (updates) is author/admin only; a read also admits another author's finalized note
   * while the patient is in treatment today. A miss and a not-yours both 404. */
  async getNoteById(id: string, user: JwtUser, mode: "read" | "write" = "read") {
    const note = await this.repo.findNoteById(id);
    if (!note) throw new NotFoundException(`Clinical note ${id} not found`);
    if (this.isAdmin(user) || note.authorStaffId === user.sub) return note;
    if (mode === "read" && note.finalizedAt && (await this.repo.hasTreatmentToday(note.patientId, user.sub))) {
      RequestContext.setAuditDiff(undefined, { basis: CROSS_AUTHOR_READ_BASIS, noteAuthor: note.authorStaffId });
      return note;
    }
    throw new NotFoundException(`Clinical note ${id} not found`);
  }

  async updateNote(id: string, dto: UpdateClinicalNoteDto, user: JwtUser) {
    const note = await this.getNoteById(id, user, "write"); // author/admin only, plus the 404
    const { finalizedAt } = note;
    const isDraft = finalizedAt === null;
    if (finalizedAt && !this.isAdmin(user) && Date.now() - finalizedAt.getTime() > EDIT_WINDOW_MS) {
      throw new BadRequestException("This note can no longer be edited — it locked 24h after it was finalized");
    }
    // The appointment link is fixed at creation (it isn't an update-able scalar in Prisma anyway).
    const { draft, appointmentId: _fixed, expectedUpdatedAt, ...fields } = dto;
    if (draft && !isDraft) throw new BadRequestException("A finalized note can't go back to draft");

    const staysDraft = isDraft && draft !== false;
    const merged = { ...note, ...fields };
    if (!staysDraft) {
      const issues = finalNoteIssues(merged);
      if (issues.length) throw new BadRequestException(issues.map((i) => i.message).join("; "));
    }
    const data: Prisma.ClinicalNoteUpdateInput = { ...fields };
    // Risk detail: whitespace-only is "none"; and a note that is final with level "none" carries no risk text — without
    // this, lowering the level left the old detail stored behind a "no risk" badge (a draft keeps it: the level may flip back).
    if (typeof fields.riskNotes === "string" && !fields.riskNotes.trim()) data.riskNotes = null;
    if (!staysDraft && merged.riskLevel === "none" && (fields.riskNotes !== undefined || note.riskNotes)) data.riskNotes = null;
    if (isDraft && !staysDraft) data.finalizedAt = new Date();

    let updated: Awaited<ReturnType<ClinicalRecordsRepository["updateNote"]>>;
    try {
      updated = await this.repo.updateNote(id, data, expectedUpdatedAt ? new Date(expectedUpdatedAt) : undefined);
    } catch (err) {
      // An unconditional save of a draft that was discarded (another tab, or the autosave that was already in flight)
      // finds no row to update: that is "gone", not a server error.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") throw this.noteGone(id);
      throw err;
    }
    if (!updated) {
      // null = nothing written: someone saved since the caller read the note (hand back what is there now) — or the
      // draft was discarded meanwhile (nothing to hand back: 404, the editor must stop saving it).
      const current = await this.repo.findNoteById(id);
      if (!current) throw this.noteGone(id);
      throw this.noteChanged(current);
    }
    return updated;
  }

  private noteGone(id: string) {
    return new NotFoundException(`Clinical note ${id} not found`);
  }

  /** Discards a DRAFT (the doctor autosaved one by accident). Author or admin only; a finalized note is a clinical
   * record and is never deletable; a draft a prescription/referral refers to is kept (409) rather than orphaning them.
   * Frees the (appointment, author) slot, so a new note can be started for that appointment. Not-yours is the usual 404,
   * checked first, so the 409s can't be used to learn anything about someone else's note. Audited like any DELETE; the
   * row records whose draft it was — never its (encrypted) text. */
  async deleteNote(id: string, user: JwtUser): Promise<void> {
    const note = await this.repo.findNoteHeader(id);
    if (!note || !(this.isAdmin(user) || note.authorStaffId === user.sub)) throw new NotFoundException(`Clinical note ${id} not found`);
    if (note.finalizedAt) throw this.noteFinalized();

    const result = await this.repo.deleteDraftNote(id);
    if (result === "not_found") throw new NotFoundException(`Clinical note ${id} not found`); // deleted by another tab meanwhile
    if (result === "finalized") throw this.noteFinalized(); // finalized by another tab meanwhile
    if (result === "linked") {
      throw new ConflictException({
        statusCode: 409,
        error: "Conflict",
        code: NOTE_HAS_LINKED_RECORDS_CODE,
        message: "This draft has linked records (a prescription or referral refers to it) and can't be deleted",
      });
    }
    RequestContext.setAuditDiff(
      { patientId: note.patientId, authorStaffId: note.authorStaffId, appointmentId: note.appointmentId, createdAt: note.createdAt },
      null,
    );
  }

  private noteFinalized() {
    return new ConflictException({
      statusCode: 409,
      error: "Conflict",
      code: NOTE_FINALIZED_CODE,
      message: "A finalized note is a clinical record and can't be deleted",
    });
  }

  // ─── Cross-author read report (admin) ──────────────────────────────────────────────────────────────────────

  /** The admin's view of every read that used the "treating today" exception (M7 §3.1), newest first: who read, which
   * patient, how much. Built from the audit_log marks; names are resolved in batches (a staff row can be gone → null; an
   * erased patient has no name → null). The route is admin-only. */
  async listCrossAuthorReads(query: ClinicalAccessLogQuery = {}): Promise<ClinicalAccessLogEntry[]> {
    const rows = await this.repo.findCrossAuthorReads(query);
    if (rows.length === 0) return [];

    const reads = rows.map((r) => {
      const after = markOf(r.metadata);
      // resourceId is the note's id for GET /clinical-notes/:id, the patient's id for GET /patients/:id/clinical-notes.
      const id = r.resourceId?.split("?")[0] ?? null;
      return { row: r, after, noteId: after.noteAuthor ? id : null, patientId: after.noteAuthor ? null : id };
    });

    const unique = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => !!x))];
    const [staffNames, notePatients] = await Promise.all([
      this.repo.findStaffNames(unique(reads.map((r) => r.row.actorId))),
      this.repo.findNotePatientIds(unique(reads.map((r) => r.noteId))),
    ]);
    const patientIdOf = (r: (typeof reads)[number]) => r.patientId ?? (r.noteId ? notePatients.get(r.noteId) ?? null : null);
    const patientNames = await this.repo.findPatientNames(unique(reads.map(patientIdOf)));

    return reads.map((r) => {
      const patientId = patientIdOf(r);
      return {
        id: r.row.id,
        at: r.row.createdAt.toISOString(),
        reader: {
          id: r.row.actorId,
          email: r.row.actorEmail,
          fullName: r.row.actorId ? staffNames.get(r.row.actorId) ?? null : null,
        },
        patient: patientId ? { id: patientId, fullName: patientNames.get(patientId) ?? null } : null,
        basis: r.after.basis,
        otherAuthorsNotes: r.after.otherAuthorsNotes,
        note: r.noteId && r.after.noteAuthor ? { id: r.noteId, authorStaffId: r.after.noteAuthor } : null,
      };
    });
  }

  // ─── Prescriptions ─────────────────────────────────────────────────────────

  async createPrescription(patientId: string, dto: CreatePrescriptionDto, user: JwtUser) {
    await this.ensurePatient(patientId);
    if (dto.clinicalNoteId) await this.assertOwnNoteOfPatient(dto.clinicalNoteId, patientId, user);
    try {
      return await this.repo.createPrescription({
        patientId,
        prescribedByStaffId: user.sub,
        clinicalNoteId: dto.clinicalNoteId,
        notes: dto.notes,
        items: dto.items,
      });
    } catch (err) {
      return this.referencedRowGone(err);
    }
  }

  /** One page, newest first; a non-admin sees only what they prescribed (in the query, not after it). */
  listPrescriptionsForPatient(patientId: string, user: JwtUser, query: ClinicalListQuery = {}) {
    return this.repo.findPrescriptionsByPatientId(patientId, {
      ...query,
      ...(this.isAdmin(user) ? {} : { prescribedByStaffId: user.sub }),
    });
  }

  // ─── Referrals ─────────────────────────────────────────────────────────────

  async createReferral(patientId: string, dto: CreateReferralDto, user: JwtUser) {
    await this.ensurePatient(patientId);
    if (dto.clinicalNoteId) await this.assertOwnNoteOfPatient(dto.clinicalNoteId, patientId, user);
    const internal = dto.type === "internal";
    if (internal) {
      // The schema guarantees targetStaffId is present for an internal referral.
      const targetId = dto.targetStaffId as string;
      if (targetId === user.sub) throw new BadRequestException("You can't refer a patient to yourself");
      const target = await this.repo.findStaffForReferral(targetId);
      if (!target || target.deletedAt || !(REFERRAL_TARGET_ROLES as readonly string[]).includes(target.role)) {
        throw new BadRequestException("An internal referral must be addressed to an active doctor");
      }
    }
    try {
      return await this.repo.createReferral({
        patient: { connect: { id: patientId } },
        referredBy: { connect: { id: user.sub } },
        type: dto.type,
        // Only the half that belongs to the type is stored: a stray targetStaffId on an external referral would show
        // the referral (and its reason) to a clinician it was never addressed to.
        ...(internal ? { targetStaff: { connect: { id: dto.targetStaffId as string } } } : {
          externalProviderName: dto.externalProviderName,
          externalSpecialty: dto.externalSpecialty,
        }),
        ...(dto.clinicalNoteId ? { clinicalNote: { connect: { id: dto.clinicalNoteId } } } : {}),
        reason: dto.reason,
      });
    } catch (err) {
      return this.referencedRowGone(err);
    }
  }

  /** One page, newest first; a non-admin sees referrals they sent or received (in the query, not after it). */
  listReferralsForPatient(patientId: string, user: JwtUser, query: ClinicalListQuery = {}) {
    return this.repo.findReferralsByPatientId(patientId, {
      ...query,
      ...(this.isAdmin(user) ? {} : { involvedStaffId: user.sub }),
    });
  }

  /** Status moves follow REFERRAL_STATUS_TRANSITIONS (`completed` is final, `declined` can be re-opened…); admin may
   * correct any status. Repeating the current status is a no-op, not an error (a double click). Two people moving
   * the same referral at once: one wins, the other gets a 409 carrying the referral as it is now. */
  async updateReferralStatus(id: string, status: ReferralStatus, user: JwtUser) {
    const referral = await this.repo.findReferralById(id);
    const admin = this.isAdmin(user);
    const involved = referral && (referral.referredByStaffId === user.sub || referral.targetStaffId === user.sub);
    if (!referral || (!admin && !involved)) {
      throw new NotFoundException(`Referral ${id} not found`);
    }
    const from = referral.status as ReferralStatus;
    if (from === status) return referral;
    if (!admin && !REFERRAL_STATUS_TRANSITIONS[from].includes(status)) {
      throw new BadRequestException(`A referral that is "${from}" can't be changed to "${status}"`);
    }
    const updated = await this.repo.updateReferralStatus(id, from, status);
    if (!updated) {
      throw new ConflictException({
        statusCode: 409,
        error: "Conflict",
        code: REFERRAL_CHANGED_CODE,
        message: "This referral was changed by someone else — reload it",
        referral: await this.repo.findReferralById(id),
      });
    }
    return updated;
  }
}

/** The fields of an audit row's `metadata.diff.after` that the cross-author mark sets. The column is free-form JSON, so
 * every field is checked rather than trusted. */
function markOf(metadata: unknown): { basis: string; otherAuthorsNotes: number | null; noteAuthor: string | null } {
  const after = ((metadata as { diff?: { after?: unknown } } | null)?.diff?.after ?? {}) as Record<string, unknown>;
  return {
    basis: typeof after.basis === "string" ? after.basis : CROSS_AUTHOR_READ_BASIS,
    otherAuthorsNotes: typeof after.otherAuthorsNotes === "number" ? after.otherAuthorsNotes : null,
    noteAuthor: typeof after.noteAuthor === "string" ? after.noteAuthor : null,
  };
}
