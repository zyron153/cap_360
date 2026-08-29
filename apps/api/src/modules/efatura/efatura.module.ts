import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bull";
import { EFaturaService } from "./efatura.service";
import { EFaturaProcessor } from "./efatura.processor";
import { EncryptionService } from "../../common/services/encryption.service";

@Module({
  imports: [BullModule.registerQueue({ name: "efatura" })],
  providers: [EFaturaService, EFaturaProcessor, EncryptionService],
  exports: [EFaturaService, BullModule],
})
export class EFaturaModule {}
