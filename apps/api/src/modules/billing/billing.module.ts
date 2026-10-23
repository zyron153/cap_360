import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bull";
import { BillingController } from "./billing.controller";
import { BillingService } from "./billing.service";
import { BillingRepository } from "./billing.repository";
import { EncryptionService } from "../../common/services/encryption.service";
import { EFaturaModule } from "../efatura/efatura.module";
import { HealthPlansModule } from "../health-plans/health-plans.module";
import { ServicesModule } from "../services/services.module";
import { ParametrizacaoModule } from "../parametrizacao/parametrizacao.module";

@Module({
  imports: [
    BullModule.registerQueue({ name: "efatura" }),
    EFaturaModule,
    HealthPlansModule,
    ServicesModule,
    ParametrizacaoModule,
  ],
  controllers: [BillingController],
  // PrismaService comes from the global PrismaModule — no explicit import needed
  providers: [BillingService, BillingRepository, EncryptionService],
  exports: [BillingService],
})
export class BillingModule {}
