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
  UseInterceptors,
  UploadedFile,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { PatientsService } from "./patients.service";
import { DocumentsService } from "../documents/documents.service";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { CurrentUser, JwtUser } from "../../common/decorators/current-user.decorator";
import { Roles } from "../../common/decorators/roles.decorator";
import { AuditView } from "../../common/decorators/audit-view.decorator";
import {
  CreatePatientSchema,
  UpdatePatientSchema,
  CreatePatientNoteSchema,
  UploadPatientDocumentSchema,
  PatientSearchSchema,
  CreatePatientDto,
  UpdatePatientDto,
  CreatePatientNoteDto,
  UploadPatientDocumentDto,
  PatientSearchQuery,
} from "@cap/types";

interface UploadedDocFile {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
}

@Controller("patients")
@Roles("admin", "receptionist", "doctor", "nurse")
export class PatientsController {
  constructor(
    private readonly service: PatientsService,
    private readonly documentsService: DocumentsService,
  ) {}

  @Get()
  findAll(
    @Query(new ZodValidationPipe(PatientSearchSchema)) query: PatientSearchQuery
  ) {
    return this.service.findAll(query);
  }

  // "GET /patients/me" (patient self-service) removed — this auth system is staff-only; there is
  // no patient-facing login and no `patient` role can ever be granted a session.

  @Get(":id")
  @AuditView() // SECURITY.md: "patient record viewed" must be audit-logged, not just edits
  findOne(@Param("id", ParseUUIDPipe) id: string) {
    return this.service.findById(id);
  }

  @Get(":id/timeline")
  @AuditView() // same rationale as GET /patients/:id — this surfaces clinical/contact history too
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

  @Get(":id/documents")
  listDocuments(@Param("id", ParseUUIDPipe) patientId: string) {
    return this.documentsService.listByPatient(patientId);
  }

  @Post(":id/documents")
  @Roles("admin", "receptionist", "doctor", "nurse", "lab_tech")
  @UseInterceptors(FileInterceptor("file"))
  uploadDocument(
    @Param("id", ParseUUIDPipe) patientId: string,
    @Body(new ZodValidationPipe(UploadPatientDocumentSchema)) dto: UploadPatientDocumentDto,
    @UploadedFile() file: UploadedDocFile,
    @CurrentUser() user: JwtUser,
  ) {
    return this.documentsService.upload(patientId, dto.type, file, user.sub);
  }
}
