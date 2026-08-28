import { Module } from "@nestjs/common";
import { FinanceiroController } from "./financeiro.controller";
import { FinanceiroService } from "./financeiro.service";
import { FinanceiroRepository } from "./financeiro.repository";
import { R2Service } from "../../common/services/r2.service";
import { StaffModule } from "../staff/staff.module";

@Module({
  imports: [StaffModule],
  controllers: [FinanceiroController],
  // PrismaService comes from the global PrismaModule — no explicit import needed
  providers: [FinanceiroService, FinanceiroRepository, R2Service],
  exports: [FinanceiroService],
})
export class FinanceiroModule {}
