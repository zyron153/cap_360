import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bull";
import { EFaturaService } from "./efatura.service";
import { EFaturaProcessor } from "./efatura.processor";
import { EFaturaController } from "./efatura.controller";
import { EFaturaConfigService } from "./efatura-config.service";
import { EFaturaAuthService } from "./efatura-auth.service";
import { EFaturaClientService } from "./efatura-client.service";
import { TechplaceClientService } from "./techplace/techplace-client.service";
import { EncryptionService } from "../../common/services/encryption.service";

@Module({
  imports: [BullModule.registerQueue({ name: "efatura" })],
  controllers: [EFaturaController],
  providers: [
    EFaturaService,
    EFaturaProcessor,
    EFaturaConfigService,
    EFaturaAuthService,
    EFaturaClientService,
    TechplaceClientService,
    EncryptionService,
  ],
  exports: [EFaturaService, EFaturaConfigService, BullModule],
})
export class EFaturaModule {}
