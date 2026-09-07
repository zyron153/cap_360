import { Logger } from "@nestjs/common";
import { Process, Processor } from "@nestjs/bull";
import { Job } from "bull";

interface ReminderJobData {
  appointmentId: string;
  offsetMin: number;
}

@Processor("reminders")
export class RemindersProcessor {
  private readonly logger = new Logger(RemindersProcessor.name);

  @Process("send-reminder")
  async handleReminder(job: Job<ReminderJobData>) {
    const { appointmentId, offsetMin } = job.data;
    // Phase 1 stub: WhatsApp sending wired in Phase 2 (M3)
    this.logger.warn(
      `[Reminder stub] appointmentId=${appointmentId} offset=${offsetMin}min`
    );
  }
}
