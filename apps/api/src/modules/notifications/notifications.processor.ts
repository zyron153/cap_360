import { Process, Processor } from "@nestjs/bull";
import { Job } from "bull";
import * as nodemailer from "nodemailer";
import { PrismaService } from "../../prisma/prisma.service";

interface WaConfig  { phoneNumberId: string; accessToken: string }
interface SmtpConfig { host: string; port: string; username: string; password: string; fromName: string }

@Processor("notifications")
export class NotificationsProcessor {
  constructor(private readonly prisma: PrismaService) {}

  // ── helpers ────────────────────────────────────────────────

  private async cfg<T>(key: string): Promise<T | null> {
    const row = await this.prisma.setting.findUnique({ where: { key } });
    return row ? (row.value as T) : null;
  }

  private async sendWhatsApp(cfg: WaConfig, to: string, body: string) {
    const phone = to.replace(/\D/g, "");
    const res = await fetch(
      `https://graph.facebook.com/v19.0/${cfg.phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${cfg.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: phone,
          type: "text",
          text: { body },
        }),
      },
    );
    if (!res.ok) {
      const err = await res.text();
      console.error("[WhatsApp] send failed:", err);
    }
  }

  private createTransport(cfg: SmtpConfig) {
    return nodemailer.createTransport({
      host: cfg.host,
      port: parseInt(cfg.port, 10) || 587,
      secure: parseInt(cfg.port, 10) === 465,
      auth: { user: cfg.username, pass: cfg.password },
    });
  }

  private from(cfg: SmtpConfig) {
    return `"${cfg.fromName}" <${cfg.username}>`;
  }

  // ── WhatsApp jobs ──────────────────────────────────────────

  @Process("send-confirm")
  async handleConfirm(job: Job<{ appointmentId: string }>) {
    const wa = await this.cfg<WaConfig>("integration_whatsapp");
    if (!wa?.phoneNumberId || !wa?.accessToken) return;

    const appt = await this.prisma.appointment.findUnique({
      where: { id: job.data.appointmentId },
      include: { patient: true, service: true },
    });
    if (!appt?.patient.phone || !appt.patient.consentGiven) return;

    const date = appt.scheduledAt.toLocaleDateString("pt-CV", { day: "2-digit", month: "long", year: "numeric" });
    const time = appt.scheduledAt.toLocaleTimeString("pt-CV", { hour: "2-digit", minute: "2-digit" });

    await this.sendWhatsApp(
      wa,
      appt.patient.phone,
      `Olá ${appt.patient.fullName}! A sua consulta de ${appt.service.name} está confirmada para ${date} às ${time}. Obrigado por escolher a CAP.`,
    );
  }

  @Process("send-cancel")
  async handleCancel(job: Job<{ appointmentId: string }>) {
    const wa = await this.cfg<WaConfig>("integration_whatsapp");
    if (!wa?.phoneNumberId || !wa?.accessToken) return;

    const appt = await this.prisma.appointment.findUnique({
      where: { id: job.data.appointmentId },
      include: { patient: true, service: true },
    });
    if (!appt?.patient.phone || !appt.patient.consentGiven) return;

    const date = appt.scheduledAt.toLocaleDateString("pt-CV", { day: "2-digit", month: "long", year: "numeric" });

    await this.sendWhatsApp(
      wa,
      appt.patient.phone,
      `Olá ${appt.patient.fullName}, informamos que a sua consulta de ${appt.service.name} do dia ${date} foi cancelada. Entre em contacto para reagendar.`,
    );
  }

  @Process("send-reminder")
  async handleReminder(job: Job<{ appointmentId: string }>) {
    const wa = await this.cfg<WaConfig>("integration_whatsapp");
    if (!wa?.phoneNumberId || !wa?.accessToken) return;

    const appt = await this.prisma.appointment.findUnique({
      where: { id: job.data.appointmentId },
      include: { patient: true, service: true },
    });
    if (!appt?.patient.phone) return;

    const time = appt.scheduledAt.toLocaleTimeString("pt-CV", { hour: "2-digit", minute: "2-digit" });

    await this.sendWhatsApp(
      wa,
      appt.patient.phone,
      `Lembrete: tem uma consulta de ${appt.service.name} amanhã às ${time} na CAP. Por favor confirme a sua presença respondendo SIM.`,
    );
  }

  // ── Email jobs ─────────────────────────────────────────────

  @Process("daily-summary")
  async handleDailySummary(_job: Job) {
    const smtp = await this.cfg<SmtpConfig>("integration_email_smtp");
    if (!smtp?.host) return;

    const today = new Date(); today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);

    const appointments = await this.prisma.appointment.findMany({
      where: { scheduledAt: { gte: today, lt: tomorrow }, deletedAt: null },
      include: { patient: true, staff: true, service: true },
      orderBy: { scheduledAt: "asc" },
    });

    const rows = appointments.map(a => {
      const t = a.scheduledAt.toLocaleTimeString("pt-CV", { hour: "2-digit", minute: "2-digit" });
      return `<tr><td style="padding:6px 12px;border-bottom:1px solid #eee">${t}</td><td style="padding:6px 12px;border-bottom:1px solid #eee">${a.patient.fullName ?? "Paciente removido"}</td><td style="padding:6px 12px;border-bottom:1px solid #eee">${a.service.name}</td><td style="padding:6px 12px;border-bottom:1px solid #eee">${a.staff.fullName}</td></tr>`;
    }).join("");

    const html = `<h2 style="font-family:sans-serif">Resumo do dia — ${today.toLocaleDateString("pt-CV")}</h2><p style="font-family:sans-serif">${appointments.length} consulta(s) agendada(s)</p><table style="border-collapse:collapse;font-family:sans-serif;font-size:13px"><thead><tr style="background:#f5f5f5"><th style="padding:8px 12px;text-align:left">Hora</th><th style="padding:8px 12px;text-align:left">Paciente</th><th style="padding:8px 12px;text-align:left">Serviço</th><th style="padding:8px 12px;text-align:left">Médico/a</th></tr></thead><tbody>${rows}</tbody></table>`;

    const staffEmails = await this.prisma.staff.findMany({ select: { email: true }, where: { deletedAt: null } });
    const to = staffEmails.map(s => s.email).join(", ");
    if (!to) return;

    await this.createTransport(smtp).sendMail({
      from: this.from(smtp), to, subject: `Agenda do dia — ${today.toLocaleDateString("pt-CV")}`, html,
    });
  }

  @Process("send-invite")
  async handleInvite(job: Job<{ email: string; fullName: string; token: string }>) {
    const smtp = await this.cfg<SmtpConfig>("integration_email_smtp");
    if (!smtp?.host) return;

    const { email, fullName, token } = job.data;
    const activateUrl = `${process.env.WEB_URL ?? "http://localhost:3000"}/activate?token=${token}`;

    const html = `<div style="font-family:sans-serif;max-width:480px">
      <h2>Bem-vindo(a) à CAP</h2>
      <p>Olá ${fullName},</p>
      <p>Foi convidado(a) a juntar-se à plataforma de gestão da clínica. Clique no botão abaixo para ativar a sua conta e definir a sua palavra-passe.</p>
      <p style="margin:24px 0"><a href="${activateUrl}" style="background:#0D8080;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600">Ativar Conta</a></p>
      <p style="color:#666;font-size:12px">Este convite expira em 7 dias. Se não fez este pedido, ignore este email.</p>
    </div>`;

    await this.createTransport(smtp).sendMail({
      from: this.from(smtp), to: email, subject: "Convite — CAP", html,
    });
  }

  @Process("send-password-reset")
  async handlePasswordReset(job: Job<{ email: string; fullName: string; token: string }>) {
    const smtp = await this.cfg<SmtpConfig>("integration_email_smtp");
    if (!smtp?.host) return;

    const { email, fullName, token } = job.data;
    const resetUrl = `${process.env.WEB_URL ?? "http://localhost:3000"}/reset-password?token=${token}`;

    const html = `<div style="font-family:sans-serif;max-width:480px">
      <h2>Recuperação de Palavra-passe — CAP</h2>
      <p>Olá ${fullName},</p>
      <p>Recebemos um pedido para repor a palavra-passe da sua conta. Clique no botão abaixo para definir uma nova.</p>
      <p style="margin:24px 0"><a href="${resetUrl}" style="background:#0D8080;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600">Repor Palavra-passe</a></p>
      <p style="color:#666;font-size:12px">Este link expira em 1 hora. Se não fez este pedido, ignore este email — a sua palavra-passe atual continua válida.</p>
    </div>`;

    await this.createTransport(smtp).sendMail({
      from: this.from(smtp), to: email, subject: "Recuperação de Palavra-passe — CAP", html,
    });
  }

  @Process("overdue-invoices")
  async handleOverdueInvoices(_job: Job) {
    // InvoiceStatus.overdue existed as an enum value with nothing that ever set it — this is a
    // data-correctness step, not a notification, so it runs regardless of whether email is
    // configured (unlike the digest below, which depends on it).
    await this.prisma.invoice.updateMany({
      where: { status: { in: ["issued", "partially_paid"] }, dueDate: { lt: new Date() } },
      data: { status: "overdue" },
    });

    const smtp = await this.cfg<SmtpConfig>("integration_email_smtp");
    if (!smtp?.host) return;

    const invoices = await this.prisma.invoice.findMany({
      where: { status: "overdue" },
      include: { patient: true },
      orderBy: { issuedAt: "asc" },
    });
    if (invoices.length === 0) return;

    const rows = invoices.map(inv => {
      const due = (Number(inv.total) - Number(inv.amountPaid)).toLocaleString("pt-CV");
      const date = inv.issuedAt ? inv.issuedAt.toLocaleDateString("pt-CV") : "—";
      return `<tr><td style="padding:6px 12px;border-bottom:1px solid #eee">${inv.invoiceNumber}</td><td style="padding:6px 12px;border-bottom:1px solid #eee">${inv.patient.fullName ?? "Paciente removido"}</td><td style="padding:6px 12px;border-bottom:1px solid #eee">${date}</td><td style="padding:6px 12px;border-bottom:1px solid #eee;color:#dc2626">${due} CVE</td></tr>`;
    }).join("");

    const html = `<h2 style="font-family:sans-serif;color:#dc2626">Faturas Vencidas</h2><p style="font-family:sans-serif">${invoices.length} fatura(s) vencida(s) requerem atenção</p><table style="border-collapse:collapse;font-family:sans-serif;font-size:13px"><thead><tr style="background:#f5f5f5"><th style="padding:8px 12px;text-align:left">Nº Fatura</th><th style="padding:8px 12px;text-align:left">Paciente</th><th style="padding:8px 12px;text-align:left">Data</th><th style="padding:8px 12px;text-align:left">Em Dívida</th></tr></thead><tbody>${rows}</tbody></table>`;

    const adminStaff = await this.prisma.staff.findMany({ select: { email: true }, where: { role: "admin", deletedAt: null } });
    const to = adminStaff.map(s => s.email).join(", ");
    if (!to) return;

    await this.createTransport(smtp).sendMail({
      from: this.from(smtp), to, subject: `Relatório de faturas vencidas — ${invoices.length} em atraso`, html,
    });
  }
}
