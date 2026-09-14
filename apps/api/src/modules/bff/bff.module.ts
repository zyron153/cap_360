import { Module } from "@nestjs/common";
import { BffController } from "./bff.controller";
import { BffService } from "./bff.service";
import { PrismaModule } from "../../prisma/prisma.module";
import { EncryptionService } from "../../common/services/encryption.service";
import { HealthPlansModule } from "../health-plans/health-plans.module";

@Module({
  imports: [PrismaModule, HealthPlansModule],
  controllers: [BffController],
  providers: [BffService, EncryptionService],
})
export class BffModule {}
