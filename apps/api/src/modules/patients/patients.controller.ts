import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
} from "@nestjs/common";
import { PatientsService } from "./patients.service";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { CurrentUser, JwtUser } from "../../common/decorators/current-user.decorator";
import { Roles } from "../../common/decorators/roles.decorator";
import { AuditView } from "../../common/decorators/audit-view.decorator";
import {
  CreatePatientSchema,
  UpdatePatientSchema,
  CreatePatientNoteSchema,
  PatientSearchSchema,
  CreatePatientDto,
  UpdatePatientDto,
  CreatePatientNoteDto,
  PatientSearchQuery,
} from "@cap/types";

@Controller("patients")
@Roles("admin", "receptionist", "doctor", "nurse")
export class PatientsController {
  constructor(private readonly service: PatientsService) {}

  @Get()
  findAll(
    @Query(new ZodValidationPipe(PatientSearchSchema)) query: PatientSearchQuery
  ) {
    return this.service.findAll(query);
  }

  @Get("me")
  @Roles("patient")
  getMe(@CurrentUser() user: JwtUser) {
    if (!user.patient_id) {
      throw new UnauthorizedException("patient_id claim missing from token");
    }
    return this.service.findById(user.patient_id);
  }

  @Get(":id")
  @AuditView() // SECURITY.md: "patient record viewed" must be audit-logged, not just edits
  findOne(@Param("id", ParseUUIDPipe) id: string) {
    return this.service.findById(id);
  }

  @Get(":id/timeline")
  getTimeline(@Param("id", ParseUUIDPipe) id: string) {
    return this.service.getTimeline(id);
  }

  @Post()
  @Roles("admin", "receptionist")
  create(
    @Body(new ZodValidationPipe(CreatePatientSchema)) dto: CreatePatientDto
  ) {
    return this.service.create(dto);
  }

  @Patch(":id")
  @Roles("admin", "receptionist")
  update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(UpdatePatientSchema)) dto: UpdatePatientDto
  ) {
    return this.service.update(id, dto);
  }

  @Delete(":id")
  @Roles("admin")
  @HttpCode(HttpStatus.NO_CONTENT)
  softDelete(@Param("id", ParseUUIDPipe) id: string) {
    return this.service.softDelete(id);
  }

  @Post(":id/notes")
  @Roles("admin", "receptionist", "doctor", "nurse")
  addNote(
    @Param("id", ParseUUIDPipe) patientId: string,
    @Body(new ZodValidationPipe(CreatePatientNoteSchema))
    dto: CreatePatientNoteDto,
    @CurrentUser() user: JwtUser
  ) {
    return this.service.addNote(patientId, dto, user.sub);
  }
}
