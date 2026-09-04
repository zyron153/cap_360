import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from "@nestjs/common";
import { ClinicalRecordsService } from "./clinical-records.service";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { CurrentUser, JwtUser } from "../../common/decorators/current-user.decorator";
import { Roles } from "../../common/decorators/roles.decorator";
import { AuditView } from "../../common/decorators/audit-view.decorator";
import {
  CreateClinicalNoteSchema, CreateClinicalNoteDto,
  UpdateClinicalNoteSchema, UpdateClinicalNoteDto,
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

  @Get("clinical-notes")
  @AuditView() // SECURITY.md posture: clinical-note access is logged, same as a patient record view
  listNotes(@Param("patientId", ParseUUIDPipe) patientId: string, @CurrentUser() user: JwtUser) {
    return this.service.listNotesForPatient(patientId, user);
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
  listPrescriptions(@Param("patientId", ParseUUIDPipe) patientId: string, @CurrentUser() user: JwtUser) {
    return this.service.listPrescriptionsForPatient(patientId, user);
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
  listReferrals(@Param("patientId", ParseUUIDPipe) patientId: string, @CurrentUser() user: JwtUser) {
    return this.service.listReferralsForPatient(patientId, user);
  }
}

@Roles("admin", "doctor")
@Controller("clinical-notes")
export class ClinicalNotesController {
  constructor(private readonly service: ClinicalRecordsService) {}

  @Get()
  @AuditView()
  findMine(@CurrentUser() user: JwtUser) {
    return this.service.listAllNotes(user);
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
