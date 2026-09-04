import { Module } from "@nestjs/common";
import { PatientClinicalController, ClinicalNotesController, ReferralsController } from "./clinical-records.controller";
import { ClinicalRecordsService } from "./clinical-records.service";
import { ClinicalRecordsRepository } from "./clinical-records.repository";

@Module({
  controllers: [PatientClinicalController, ClinicalNotesController, ReferralsController],
  providers: [ClinicalRecordsService, ClinicalRecordsRepository],
})
export class ClinicalRecordsModule {}
