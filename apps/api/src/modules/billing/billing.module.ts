import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bull";
import { BillingController } from "./billing.controller";
import { BillingService } from "./billing.service";
import { BillingRepository } from "./billing.repository";
import { R2Service } from "../../common/services/r2.service";
import { EFaturaModule } from "../efatura/efatura.module";

@Module({
  imports: [
    BullModule.registerQueue({ name: "efatura" }),
    EFaturaModule,
  ],
  controllers: [BillingController],
  // PrismaService comes from the global PrismaModule — no explicit import needed
  providers: [BillingService, BillingRepository, R2Service],
  exports: [BillingService],
})
export class BillingModule {}
