import { Injectable, NotFoundException, BadRequestException } from "@nestjs/common";
import { ClinicalRecordsRepository } from "./clinical-records.repository";
import { JwtUser } from "../../common/decorators/current-user.decorator";
import {
  CreateClinicalNoteDto,
  UpdateClinicalNoteDto,
  CreatePrescriptionDto,
  CreateReferralDto,
} from "@cap/types";

const EDIT_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Notes/prescriptions are scoped by authorship, not a separate patient/clinician assignment
 * table this app has nowhere else — a clinician sees only what they themselves wrote; admin sees
 * everything. A missing-or-not-yours record both 404 identically, so a caller can't tell "doesn't
 * exist" from "not yours" (same posture as HealthPlansService's corporate_hr scoping). Referrals
 * are the one exception: an internal referral's target clinician also needs to see and act on it. */
@Injectable()
export class ClinicalRecordsService {
  constructor(private readonly repo: ClinicalRecordsRepository) {}

  // ─── Clinical Notes ────────────────────────────────────────────────────────

  createNote(patientId: string, dto: CreateClinicalNoteDto, user: JwtUser) {
    return this.repo.createNote({
      patient: { connect: { id: patientId } },
      author: { connect: { id: user.sub } },
      ...(dto.appointmentId ? { appointment: { connect: { id: dto.appointmentId } } } : {}),
      sessionType: dto.sessionType,
      durationMinutes: dto.durationMinutes,
      presentingConcerns: dto.presentingConcerns,
      observations: dto.observations,
      assessment: dto.assessment,
      plan: dto.plan,
      riskLevel: dto.riskLevel,
      riskNotes: dto.riskNotes,
    });
  }

  async listNotesForPatient(patientId: string, user: JwtUser) {
    const notes = await this.repo.findNotesByPatientId(patientId);
    if (user.roles.includes("admin")) return notes;
    return notes.filter((n) => n.authorStaffId === user.sub);
  }

  async listAllNotes(user: JwtUser) {
    const notes = await this.repo.findAllNotes();
    if (user.roles.includes("admin")) return notes;
    return notes.filter((n) => n.authorStaffId === user.sub);
  }

  async getNoteById(id: string, user: JwtUser) {
    const note = await this.repo.findNoteById(id);
    if (!note || (!user.roles.includes("admin") && note.authorStaffId !== user.sub)) {
      throw new NotFoundException(`Clinical note ${id} not found`);
    }
    return note;
  }

  async updateNote(id: string, dto: UpdateClinicalNoteDto, user: JwtUser) {
    const note = await this.getNoteById(id, user); // same scoping as a read, plus the 404
    if (!user.roles.includes("admin") && Date.now() - note.createdAt.getTime() > EDIT_WINDOW_MS) {
      throw new BadRequestException("This note can no longer be edited — it locked 24h after creation");
    }
    return this.repo.updateNote(id, dto);
  }

  // ─── Prescriptions ─────────────────────────────────────────────────────────

  createPrescription(patientId: string, dto: CreatePrescriptionDto, user: JwtUser) {
    return this.repo.createPrescription({
      patientId,
      prescribedByStaffId: user.sub,
      clinicalNoteId: dto.clinicalNoteId,
      notes: dto.notes,
      items: dto.items,
    });
  }

  async listPrescriptionsForPatient(patientId: string, user: JwtUser) {
    const list = await this.repo.findPrescriptionsByPatientId(patientId);
    if (user.roles.includes("admin")) return list;
    return list.filter((p) => p.prescribedByStaffId === user.sub);
  }

  // ─── Referrals ─────────────────────────────────────────────────────────────

  createReferral(patientId: string, dto: CreateReferralDto, user: JwtUser) {
    return this.repo.createReferral({
      patient: { connect: { id: patientId } },
      referredBy: { connect: { id: user.sub } },
      type: dto.type,
      ...(dto.targetStaffId ? { targetStaff: { connect: { id: dto.targetStaffId } } } : {}),
      ...(dto.clinicalNoteId ? { clinicalNote: { connect: { id: dto.clinicalNoteId } } } : {}),
      externalProviderName: dto.externalProviderName,
      externalSpecialty: dto.externalSpecialty,
      reason: dto.reason,
    });
  }

  async listReferralsForPatient(patientId: string, user: JwtUser) {
    const list = await this.repo.findReferralsByPatientId(patientId);
    if (user.roles.includes("admin")) return list;
    return list.filter((r) => r.referredByStaffId === user.sub || r.targetStaffId === user.sub);
  }

  async updateReferralStatus(id: string, status: string, user: JwtUser) {
    const referral = await this.repo.findReferralById(id);
    const involved = referral && (referral.referredByStaffId === user.sub || referral.targetStaffId === user.sub);
    if (!referral || (!user.roles.includes("admin") && !involved)) {
      throw new NotFoundException(`Referral ${id} not found`);
    }
    return this.repo.updateReferralStatus(id, status);
  }
}
