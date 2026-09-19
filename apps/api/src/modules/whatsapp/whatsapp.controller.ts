import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  RawBodyRequest,
  Req,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { Request } from "express";
import { Public } from "../../common/decorators/public.decorator";
import { Roles } from "../../common/decorators/roles.decorator";
import { AuditView } from "../../common/decorators/audit-view.decorator";
import { CurrentUser, JwtUser } from "../../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import {
  AssignWhatsappConversationDto,
  AssignWhatsappConversationSchema,
  LinkWhatsappPatientDto,
  LinkWhatsappPatientSchema,
  SendWhatsappMessageDto,
  SendWhatsappMessageSchema,
  WhatsappConversationListQuery,
  WhatsappConversationListQuerySchema,
} from "@cap/types";
import { WhatsappService } from "./whatsapp.service";
import { safeEqual, verifySignature } from "./whatsapp-api";

/** Meta calls this endpoint, unauthenticated — the HMAC signature is the authentication. */
@Public()
@Controller("whatsapp/webhook")
export class WhatsappWebhookController {
  constructor(private readonly svc: WhatsappService) {}

  @Get()
  async verify(
    @Query("hub.mode") mode?: string,
    @Query("hub.verify_token") token?: string,
    @Query("hub.challenge") challenge?: string,
  ) {
    const cfg = await this.svc.getConfig();
    if (mode !== "subscribe" || !token || !cfg?.webhookToken || !safeEqual(token, cfg.webhookToken)) {
      throw new ForbiddenException();
    }
    return challenge ?? "";
  }

  // Sized for Meta delivery bursts, not the 60/min public default.
  @Throttle({ default: { limit: 600, ttl: 60_000 } })
  @Post()
  @HttpCode(200)
  async receive(
    @Req() req: RawBodyRequest<Request>,
    @Headers("x-hub-signature-256") signature: string | undefined,
    @Body() payload: unknown,
  ) {
    const cfg = await this.svc.getConfig();
    if (!verifySignature(req.rawBody, signature, cfg?.appSecret)) throw new ForbiddenException("Invalid signature");
    await this.svc.handleWebhook(payload);
    return { received: true };
  }
}

@Controller("whatsapp/conversations")
@Roles("admin", "receptionist")
export class WhatsappController {
  constructor(private readonly svc: WhatsappService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(WhatsappConversationListQuerySchema)) query: WhatsappConversationListQuery,
    @CurrentUser() user: JwtUser,
  ) {
    return this.svc.list(query, user.sub);
  }

  @Get(":id")
  @AuditView()
  findOne(@Param("id", ParseUUIDPipe) id: string) {
    return this.svc.findOne(id);
  }

  @Post(":id/messages")
  send(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(SendWhatsappMessageSchema)) dto: SendWhatsappMessageDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.svc.send(id, dto, user.sub);
  }

  @Patch(":id/assign")
  assign(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(AssignWhatsappConversationSchema)) dto: AssignWhatsappConversationDto,
  ) {
    return this.svc.assign(id, dto.staffId);
  }

  @Patch(":id/resolve")
  resolve(@Param("id", ParseUUIDPipe) id: string) {
    return this.svc.resolve(id);
  }

  @Patch(":id/link-patient")
  linkPatient(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(LinkWhatsappPatientSchema)) dto: LinkWhatsappPatientDto,
  ) {
    return this.svc.linkPatient(id, dto.patientId);
  }
}
