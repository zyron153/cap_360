import { Module } from "@nestjs/common";
import { PatientClinicalController, ClinicalNotesController, ReferralsController } from "./clinical-records.controller";
import { ClinicalRecordsService } from "./clinical-records.service";
import { ClinicalRecordsRepository } from "./clinical-records.repository";
import { EncryptionService } from "../../common/services/encryption.service";

@Module({
  controllers: [PatientClinicalController, ClinicalNotesController, ReferralsController],
  providers: [ClinicalRecordsService, ClinicalRecordsRepository, EncryptionService],
})
export class ClinicalRecordsModule {}
