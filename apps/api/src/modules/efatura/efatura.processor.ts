import { Processor, Process } from "@nestjs/bull";
import { Logger, OnModuleInit } from "@nestjs/common";
import { Job } from "bull";
import { EFaturaService } from "./efatura.service";

@Processor("efatura")
export class EFaturaProcessor implements OnModuleInit {
  private readonly logger = new Logger(EFaturaProcessor.name);

  constructor(private readonly efatura: EFaturaService) {}

  async onModuleInit() {
    // Redis being down at boot must not stop the API: the sweeper is simply registered next time.
    await this.efatura.scheduleSweeper().catch((e) => this.logger.warn(`Could not schedule the e-Fatura sweeper: ${e}`));
  }

  /** Sends one fiscal document. Transient failures throw and Bull retries them (3 attempts,
   * exponential back-off); everything else is recorded on the submission and returns normally. */
  @Process("submit")
  async submit(job: Job<{ submissionId: string }>) {
    await this.efatura.process(job.data.submissionId);
  }

  @Process("sweep")
  async sweep() {
    const n = await this.efatura.sweep();
    if (n > 0) this.logger.log(`e-Fatura sweeper re-queued ${n} submission(s)`);
  }
}
