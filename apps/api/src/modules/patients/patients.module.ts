import { Module } from "@nestjs/common";
import { PatientsController } from "./patients.controller";
import { PatientsService } from "./patients.service";
import { PatientsRepository } from "./patients.repository";
import { EncryptionService } from "../../common/services/encryption.service";

@Module({
  controllers: [PatientsController],
  providers: [PatientsService, PatientsRepository, EncryptionService],
  exports: [PatientsService],
})
export class PatientsModule {}
