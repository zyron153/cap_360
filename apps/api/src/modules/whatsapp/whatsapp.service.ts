import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@cap/database";
import {
  normalizeCaboVerdePhone,
  SendWhatsappMessageDto,
  WhatsappConversationListQuery,
} from "@cap/types";
import { PrismaService } from "../../prisma/prisma.service";
import { EncryptionService } from "../../common/services/encryption.service";
import { AppointmentsService } from "../appointments/appointments.service";
import { WhatsappGateway } from "./whatsapp.gateway";
import { WaConfig, sendWhatsAppText } from "./whatsapp-api";

export interface InboundMessage {
  id: string;
  from: string;
  type: string;
  text?: { body: string };
}

export interface DeliveryStatus {
  id: string;
  status: string;
}

const WINDOW_MS = 24 * 60 * 60 * 1000;
const STATUS_RANK: Record<string, number> = { sending: 0, sent: 1, delivered: 2, read: 3 };
const CONFIRM_REPLIES = new Set(["1", "SIM"]);

const isUniqueViolation = (err: unknown) =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";

@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
    private readonly gateway: WhatsappGateway,
    private readonly appointments: AppointmentsService,
  ) {}

  async getConfig(): Promise<WaConfig | null> {
    const row = await this.prisma.setting.findUnique({ where: { key: "integration_whatsapp" } });
    return row ? (row.value as unknown as WaConfig) : null;
  }

  // ── Inbound (webhook) ────────────────────────────────────

  async handleWebhook(payload: unknown) {
    const entries =
      (payload as { entry?: { changes?: { value?: { messages?: InboundMessage[]; statuses?: DeliveryStatus[] } }[] }[] })
        ?.entry ?? [];
    for (const entry of entries) {
      for (const change of entry.changes ?? []) {
        for (const msg of change.value?.messages ?? []) await this.ingestInbound(msg);
        for (const st of change.value?.statuses ?? []) await this.updateDeliveryStatus(st);
      }
    }
  }

  async ingestInbound(msg: InboundMessage) {
    if (await this.prisma.whatsappMessage.findUnique({ where: { externalId: msg.id } })) return; // Meta retry

    const digits = msg.from.replace(/\D/g, "");
    const phone = normalizeCaboVerdePhone(digits) ?? `+${digits}`;
    const patient = await this.prisma.patient.findFirst({ where: { phone, deletedAt: null }, select: { id: true } });
    const text = msg.type === "text" ? (msg.text?.body ?? "") : `[${msg.type}]`;
    const now = new Date();
    const windowExpiresAt = new Date(now.getTime() + WINDOW_MS);

    let conversationId: string;
    try {
      conversationId = await this.prisma.$transaction(async (tx) => {
        const existing = await tx.whatsappConversation.findUnique({ where: { phone } });
        const conv = existing
          ? await tx.whatsappConversation.update({
              where: { id: existing.id },
              data: {
                status: "open",
                unreadCount: { increment: 1 },
                lastMessageAt: now,
                windowExpiresAt,
                ...(!existing.patientId && patient ? { patientId: patient.id } : {}),
              },
            })
          : await tx.whatsappConversation.create({
              data: { phone, patientId: patient?.id ?? null, unreadCount: 1, lastMessageAt: now, windowExpiresAt },
            });
        await tx.whatsappMessage.create({
          data: {
            conversationId: conv.id,
            direction: "inbound",
            body: this.encryption.encrypt(text),
            status: "received",
            externalId: msg.id,
          },
        });
        return conv.id;
      });
    } catch (err) {
      if (isUniqueViolation(err)) return; // concurrent delivery of the same message won the race
      throw err;
    }

    // Content stays out of communication_log (plaintext column) — only the fact of contact.
    if (patient) {
      await this.prisma.communicationLog.create({
        data: { patientId: patient.id, channel: "whatsapp", direction: "inbound", subject: "Mensagem WhatsApp recebida", status: "received", externalId: msg.id },
      });
    }
    this.gateway.emitUpdated(conversationId);

    if (patient && msg.type === "text") await this.tryConfirmAppointment(conversationId, patient.id, text);
  }

  /** "1"/"SIM" confirms the patient's single upcoming pending appointment. None or several →
   * left alone for a human in the inbox; "2"/"NÃO" and everything else already land there. */
  private async tryConfirmAppointment(conversationId: string, patientId: string, text: string) {
    if (!CONFIRM_REPLIES.has(text.trim().toUpperCase().replace(/[.!]+$/, ""))) return;
    const pending = await this.prisma.appointment.findMany({
      where: { patientId, status: "pending", deletedAt: null, scheduledAt: { gte: new Date() } },
      select: { id: true },
      take: 2,
    });
    if (pending.length !== 1) return;
    try {
      await this.appointments.updateStatus(pending[0].id, { status: "confirmed" });
      await this.dispatch(conversationId, "Obrigado! A sua consulta fica confirmada.", null);
    } catch (err) {
      this.logger.error(`[whatsapp] auto-confirm failed for appointment ${pending[0].id}: ${err}`);
    }
  }

  async updateDeliveryStatus(st: DeliveryStatus) {
    const msg = await this.prisma.whatsappMessage.findUnique({ where: { externalId: st.id } });
    if (!msg || msg.direction !== "outbound") return;
    const advances = st.status === "failed" || (STATUS_RANK[st.status] ?? -1) > (STATUS_RANK[msg.status] ?? -1);
    if (!advances) return;
    await this.prisma.whatsappMessage.update({ where: { id: msg.id }, data: { status: st.status } });
    this.gateway.emitUpdated(msg.conversationId);
  }

  // ── Inbox ────────────────────────────────────────────────

  async list(query: WhatsappConversationListQuery, staffId: string) {
    const { status, assignee, page, limit } = query;
    const where: Prisma.WhatsappConversationWhereInput = {
      ...(status ? { status } : {}),
      ...(assignee === "me" ? { assignedToId: staffId } : assignee === "unassigned" ? { assignedToId: null } : assignee ? { assignedToId: assignee } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.whatsappConversation.findMany({
        where,
        orderBy: { lastMessageAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          patient: { select: { id: true, fullName: true } },
          assignedTo: { select: { id: true, fullName: true } },
          messages: { orderBy: { createdAt: "desc" }, take: 1 },
        },
      }),
      this.prisma.whatsappConversation.count({ where }),
    ]);
    const data = rows.map(({ messages, ...conv }) => ({
      ...conv,
      lastMessage: messages[0] ? { direction: messages[0].direction, body: this.encryption.decrypt(messages[0].body) } : null,
    }));
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  /** Opening a thread marks it read. */
  async findOne(id: string) {
    const conv = await this.prisma.whatsappConversation.findUnique({
      where: { id },
      include: {
        patient: { select: { id: true, fullName: true } },
        assignedTo: { select: { id: true, fullName: true } },
      },
    });
    if (!conv) throw new NotFoundException(`Conversation ${id} not found`);
    const latest = await this.prisma.whatsappMessage.findMany({
      where: { conversationId: id },
      orderBy: { createdAt: "desc" },
      take: 200,
      include: { sentBy: { select: { id: true, fullName: true } } },
    });
    if (conv.unreadCount > 0) {
      await this.prisma.whatsappConversation.update({ where: { id }, data: { unreadCount: 0 } });
    }
    return {
      ...conv,
      unreadCount: 0,
      messages: latest.reverse().map((m) => ({ ...m, body: this.encryption.decrypt(m.body) })),
    };
  }

  async assign(id: string, staffId: string | null) {
    await this.requireConversation(id);
    if (staffId) {
      const staff = await this.prisma.staff.findFirst({ where: { id: staffId, deletedAt: null }, select: { id: true } });
      if (!staff) throw new BadRequestException("Colaborador não encontrado");
    }
    const updated = await this.prisma.whatsappConversation.update({ where: { id }, data: { assignedToId: staffId } });
    this.gateway.emitUpdated(id);
    return updated;
  }

  async resolve(id: string) {
    await this.requireConversation(id);
    const updated = await this.prisma.whatsappConversation.update({ where: { id }, data: { status: "resolved" } });
    this.gateway.emitUpdated(id);
    return updated;
  }

  async linkPatient(id: string, patientId: string) {
    await this.requireConversation(id);
    const patient = await this.prisma.patient.findFirst({ where: { id: patientId, deletedAt: null }, select: { id: true } });
    if (!patient) throw new BadRequestException("Paciente não encontrado");
    const updated = await this.prisma.whatsappConversation.update({ where: { id }, data: { patientId } });
    this.gateway.emitUpdated(id);
    return updated;
  }

  // ── Outbound ─────────────────────────────────────────────

  async send(id: string, dto: SendWhatsappMessageDto, staffId: string) {
    if (dto.idempotencyKey) {
      const prior = await this.prisma.whatsappMessage.findUnique({ where: { idempotencyKey: dto.idempotencyKey } });
      if (prior) return { ...prior, body: this.encryption.decrypt(prior.body) };
    }
    const conv = await this.requireConversation(id);
    if (!conv.windowExpiresAt || conv.windowExpiresAt.getTime() < Date.now()) {
      throw new BadRequestException("A janela de 24h para resposta livre está fechada — só é possível enviar um template aprovado.");
    }
    if (!conv.assignedToId) {
      await this.prisma.whatsappConversation.update({ where: { id }, data: { assignedToId: staffId } });
    }
    return this.dispatch(id, dto.body, staffId, dto.idempotencyKey);
  }

  /** Persists first (so a retried idempotency key hits the unique constraint before any send),
   * then calls Meta and records the outcome. */
  private async dispatch(conversationId: string, body: string, sentById: string | null, idempotencyKey?: string) {
    const conv = await this.requireConversation(conversationId);
    const cfg = await this.getConfig();
    if (!cfg?.phoneNumberId || !cfg?.accessToken) {
      throw new BadRequestException("Integração WhatsApp não configurada");
    }

    let row;
    try {
      row = await this.prisma.whatsappMessage.create({
        data: { conversationId, direction: "outbound", body: this.encryption.encrypt(body), status: "sending", sentById, idempotencyKey },
      });
    } catch (err) {
      if (idempotencyKey && isUniqueViolation(err)) {
        const prior = await this.prisma.whatsappMessage.findUniqueOrThrow({ where: { idempotencyKey } });
        return { ...prior, body: this.encryption.decrypt(prior.body) };
      }
      throw err;
    }

    try {
      const externalId = await sendWhatsAppText(cfg, conv.phone, body);
      const sent = await this.prisma.whatsappMessage.update({
        where: { id: row.id },
        data: { status: "sent", externalId: externalId || null },
      });
      await this.prisma.whatsappConversation.update({
        where: { id: conversationId },
        data: { lastMessageAt: new Date(), unreadCount: 0 },
      });
      this.gateway.emitUpdated(conversationId);
      return { ...sent, body };
    } catch (err) {
      this.logger.error(`[whatsapp] send failed for conversation ${conversationId}: ${err}`);
      // Free the idempotency key so the caller can retry the same attempt.
      await this.prisma.whatsappMessage.update({ where: { id: row.id }, data: { status: "failed", idempotencyKey: null } });
      this.gateway.emitUpdated(conversationId);
      throw new BadGatewayException("Falha ao enviar a mensagem pelo WhatsApp");
    }
  }

  private async requireConversation(id: string) {
    const conv = await this.prisma.whatsappConversation.findUnique({ where: { id } });
    if (!conv) throw new NotFoundException(`Conversation ${id} not found`);
    return conv;
  }
}
