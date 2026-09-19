import { Module } from "@nestjs/common";
import { WhatsappController, WhatsappWebhookController } from "./whatsapp.controller";
import { WhatsappService } from "./whatsapp.service";
import { WhatsappGateway } from "./whatsapp.gateway";
import { EncryptionService } from "../../common/services/encryption.service";
import { AppointmentsModule } from "../appointments/appointments.module";

@Module({
  imports: [AppointmentsModule],
  controllers: [WhatsappController, WhatsappWebhookController],
  providers: [WhatsappService, WhatsappGateway, EncryptionService],
})
export class WhatsappModule {}
