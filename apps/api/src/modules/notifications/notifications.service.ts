import { Injectable, OnModuleInit } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bull";
import { Queue } from "bull";
import { PrismaService } from "../../prisma/prisma.service";

const SCHEDULED = [
  { key: "email_daily",   name: "daily-summary",   cron: "30 7 * * *" },
  { key: "email_overdue", name: "overdue-invoices", cron: "0 9 * * 1"  },
] as const;

@Injectable()
export class NotificationsService implements OnModuleInit {
  constructor(
    @InjectQueue("notifications") private readonly queue: Queue,
    private readonly prisma: PrismaService,
  ) {}

  async onModuleInit() {
    const settings = await this.getSettings();
    if (Object.keys(settings).length > 0) {
      await this.syncScheduledJobs(settings);
    }
  }

  async getSettings(): Promise<Record<string, boolean>> {
    const row = await this.prisma.setting.findUnique({ where: { key: "notifications" } });
    return (row?.value as Record<string, boolean>) ?? {};
  }

  async syncScheduledJobs(settings: Record<string, boolean>) {
    for (const { key, name, cron } of SCHEDULED) {
      if (settings[key] !== false) {
        await this.queue.add(name, {}, { repeat: { cron }, removeOnComplete: 10 });
      } else {
        await this.queue.removeRepeatable(name, { cron });
      }
    }
  }

  async notifyConfirm(appointmentId: string) {
    const s = await this.getSettings();
    if (s.wa_confirm === false) return;
    await this.queue.add("send-confirm", { appointmentId }, { attempts: 3 });
  }

  async notifyCancel(appointmentId: string) {
    const s = await this.getSettings();
    if (s.wa_cancel === false) return;
    await this.queue.add("send-cancel", { appointmentId }, { attempts: 3 });
  }

  async isReminderEnabled(): Promise<boolean> {
    const s = await this.getSettings();
    return s.wa_reminder !== false;
  }

  async sendInvite(email: string, fullName: string, token: string) {
    await this.queue.add("send-invite", { email, fullName, token }, { attempts: 3 });
  }

  async sendPasswordReset(email: string, fullName: string, token: string) {
    await this.queue.add("send-password-reset", { email, fullName, token }, { attempts: 3 });
  }
}
