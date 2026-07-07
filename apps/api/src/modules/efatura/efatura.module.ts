import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bull";
import { EFaturaService } from "./efatura.service";
import { EFaturaProcessor } from "./efatura.processor";

@Module({
  imports: [BullModule.registerQueue({ name: "efatura" })],
  providers: [EFaturaService, EFaturaProcessor],
  exports: [EFaturaService, BullModule],
})
export class EFaturaModule {}
