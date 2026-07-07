import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { JwtModule } from "@nestjs/jwt";
import { BullModule } from "@nestjs/bull";
import { ThrottlerModule, ThrottlerGuard } from "@nestjs/throttler";
import { HealthModule } from "./health/health.module";
import { PatientsModule } from "./modules/patients/patients.module";
import { AppointmentsModule } from "./modules/appointments/appointments.module";
import { BillingModule } from "./modules/billing/billing.module";
import { HealthPlansModule } from "./modules/health-plans/health-plans.module";
import { CompaniesModule } from "./modules/companies/companies.module";
import { DocumentsModule } from "./modules/documents/documents.module";
import { StaffModule } from "./modules/staff/staff.module";
import { ServicesModule } from "./modules/services/services.module";
import { BffModule } from "./modules/bff/bff.module";
import { PublicModule } from "./modules/public/public.module";
import { SettingsModule } from "./modules/settings/settings.module";
import { ParametrizacaoModule } from "./modules/parametrizacao/parametrizacao.module";
import { EFaturaModule } from "./modules/efatura/efatura.module";
import { JwtAuthGuard } from "./common/guards/jwt-auth.guard";
import { RolesGuard } from "./common/guards/roles.guard";
import { AuditInterceptor } from "./common/interceptors/audit.interceptor";
import { PerformanceInterceptor } from "./common/interceptors/performance.interceptor";
import { PrismaModule } from "./prisma/prisma.module";
import { RedisModule } from "./common/redis/redis.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
    JwtModule.register({ global: true }),
    BullModule.forRoot({
      redis: {
        host: process.env.REDIS_HOST ?? "localhost",
        port: Number(process.env.REDIS_PORT ?? 6379),
      },
    }),
    PrismaModule,
    RedisModule,
    HealthModule,
    PatientsModule,
    AppointmentsModule,
    BillingModule,
    HealthPlansModule,
    CompaniesModule,
    DocumentsModule,
    StaffModule,
    ServicesModule,
    BffModule,
    PublicModule,
    SettingsModule,
    ParametrizacaoModule,
    EFaturaModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_INTERCEPTOR, useClass: PerformanceInterceptor },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule {}

