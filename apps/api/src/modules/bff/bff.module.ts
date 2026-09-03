import { Module } from "@nestjs/common";
import { BffController } from "./bff.controller";
import { BffService } from "./bff.service";
import { PrismaModule } from "../../prisma/prisma.module";
import { EncryptionService } from "../../common/services/encryption.service";

@Module({
  imports: [PrismaModule],
  controllers: [BffController],
  providers: [BffService, EncryptionService],
})
export class BffModule {}
