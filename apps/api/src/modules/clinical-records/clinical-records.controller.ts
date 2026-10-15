import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common";
import { ClinicalRecordsService } from "./clinical-records.service";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { CurrentUser, JwtUser } from "../../common/decorators/current-user.decorator";
import { Roles } from "../../common/decorators/roles.decorator";
import { AuditView } from "../../common/decorators/audit-view.decorator";
import {
  CreateClinicalNoteSchema, CreateClinicalNoteDto,
  UpdateClinicalNoteSchema, UpdateClinicalNoteDto,
  ClinicalNoteListQuerySchema, ClinicalNoteListQuery,
  ClinicalListQuerySchema, ClinicalListQuery,
  ClinicalAccessLogQuerySchema, ClinicalAccessLogQuery,
  CreatePrescriptionSchema, CreatePrescriptionDto,
  CreateReferralSchema, CreateReferralDto,
  UpdateReferralStatusSchema, UpdateReferralStatusDto,
} from "@cap/types";

// Gated to admin+doctor only, not the usual wider clinical-staff list — nurse/receptionist see no
// rows here at all (not just filtered ones), matching the psychology-practice access model this
// module was scoped to (only a patient's own clinician, or admin).
@Roles("admin", "doctor")
@Controller("patients/:patientId")
export class PatientClinicalController {
  constructor(private readonly service: ClinicalRecordsService) {}

  @Post("clinical-notes")
  createNote(
    @Param("patientId", ParseUUIDPipe) patientId: string,
    @Body(new ZodValidationPipe(CreateClinicalNoteSchema)) dto: CreateClinicalNoteDto,
    @CurrentUser() user: JwtUser
  ) {
    return this.service.createNote(patientId, dto, user);
  }

  // The three per-patient lists are plain arrays, newest first, one page at a time (?page=&limit=, default the first
  // 100, max 100) — a short page means "no more".
  @Get("clinical-notes")
  @AuditView() // SECURITY.md posture: clinical-note access is logged, same as a patient record view
  listNotes(
    @Param("patientId", ParseUUIDPipe) patientId: string,
    @Query(new ZodValidationPipe(ClinicalListQuerySchema)) query: ClinicalListQuery,
    @CurrentUser() user: JwtUser
  ) {
    return this.service.listNotesForPatient(patientId, user, query);
  }

  @Post("prescriptions")
  createPrescription(
    @Param("patientId", ParseUUIDPipe) patientId: string,
    @Body(new ZodValidationPipe(CreatePrescriptionSchema)) dto: CreatePrescriptionDto,
    @CurrentUser() user: JwtUser
  ) {
    return this.service.createPrescription(patientId, dto, user);
  }

  @Get("prescriptions")
  @AuditView()
  listPrescriptions(
    @Param("patientId", ParseUUIDPipe) patientId: string,
    @Query(new ZodValidationPipe(ClinicalListQuerySchema)) query: ClinicalListQuery,
    @CurrentUser() user: JwtUser
  ) {
    return this.service.listPrescriptionsForPatient(patientId, user, query);
  }

  @Post("referrals")
  createReferral(
    @Param("patientId", ParseUUIDPipe) patientId: string,
    @Body(new ZodValidationPipe(CreateReferralSchema)) dto: CreateReferralDto,
    @CurrentUser() user: JwtUser
  ) {
    return this.service.createReferral(patientId, dto, user);
  }

  @Get("referrals")
  @AuditView()
  listReferrals(
    @Param("patientId", ParseUUIDPipe) patientId: string,
    @Query(new ZodValidationPipe(ClinicalListQuerySchema)) query: ClinicalListQuery,
    @CurrentUser() user: JwtUser
  ) {
    return this.service.listReferralsForPatient(patientId, user, query);
  }
}

@Roles("admin", "doctor")
@Controller("clinical-notes")
export class ClinicalNotesController {
  constructor(private readonly service: ClinicalRecordsService) {}

  @Get()
  @AuditView()
  findMine(
    @Query(new ZodValidationPipe(ClinicalNoteListQuerySchema)) query: ClinicalNoteListQuery,
    @CurrentUser() user: JwtUser
  ) {
    return this.service.listAllNotes(user, query);
  }

  // The admin's report of cross-author reads (M7 §3.1). Admin only — a method-level @Roles replaces the class's — and
  // declared BEFORE ":id": otherwise "access-log" would be taken for a note id and ParseUUIDPipe would answer 400.
  @Get("access-log")
  @Roles("admin")
  @AuditView() // reading the report is itself a sensitive read
  accessLog(@Query(new ZodValidationPipe(ClinicalAccessLogQuerySchema)) query: ClinicalAccessLogQuery) {
    return this.service.listCrossAuthorReads(query);
  }

  @Get(":id")
  @AuditView()
  findOne(@Param("id", ParseUUIDPipe) id: string, @CurrentUser() user: JwtUser) {
    return this.service.getNoteById(id, user);
  }

  @Patch(":id")
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(UpdateClinicalNoteSchema)) dto: UpdateClinicalNoteDto,
    @CurrentUser() user: JwtUser
  ) {
    return this.service.updateNote(id, dto, user);
  }

  // Discard a draft: 204, author or admin, drafts only (a finalized note is never deletable — 409).
  @Delete(":id")
  @HttpCode(204)
  async discardDraft(@Param("id", ParseUUIDPipe) id: string, @CurrentUser() user: JwtUser): Promise<void> {
    await this.service.deleteNote(id, user);
  }
}

@Roles("admin", "doctor")
@Controller("referrals")
export class ReferralsController {
  constructor(private readonly service: ClinicalRecordsService) {}

  @Patch(":id/status")
  updateStatus(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(UpdateReferralStatusSchema)) dto: UpdateReferralStatusDto,
    @CurrentUser() user: JwtUser
  ) {
    return this.service.updateReferralStatus(id, dto.status, user);
  }
}
