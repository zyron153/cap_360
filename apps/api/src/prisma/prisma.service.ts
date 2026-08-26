import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import { PrismaClient } from "@cap/database";
import { RequestContext } from "../common/context/request-context";

const SLOW_QUERY_MS = 100;

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger("PrismaService");

  constructor() {
    super({ log: [{ emit: "event", level: "query" }] });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this as any).$on("query", (e: { duration: number; query: string }) => {
      const ctx = RequestContext.get();
      if (ctx) {
        ctx.queries.push({ duration: e.duration, query: e.query });
      }
      if (e.duration > SLOW_QUERY_MS) {
        this.logger.warn(
          `[SLOW QUERY] ${e.duration}ms — ${e.query.slice(0, 150)}`
        );
      }
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
