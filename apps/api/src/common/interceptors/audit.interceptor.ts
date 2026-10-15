import {
  Injectable,
  Logger,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Observable, tap } from "rxjs";
import { PrismaService } from "../../prisma/prisma.service";
import { AUDIT_VIEW_KEY } from "../decorators/audit-view.decorator";
import { RequestContext } from "../context/request-context";

const MUTATING_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest();

    // Mutations are always audited. GETs are audited only when the route opts in via
    // @AuditView() (e.g. "patient record viewed") — logging every read would flood the table.
    const isAuditedView = this.reflector.getAllAndOverride<boolean>(AUDIT_VIEW_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!MUTATING_METHODS.has(request.method) && !isAuditedView) return next.handle();

    const user = request.user;
    const { method, url, ip, headers } = request;

    return next.handle().pipe(
      tap(() => {
        // The path only: `request.url` carries the query string, which used to end up in `resource` / `resourceId`
        // ("GET /clinical-notes/<id>?x=…" → a resourceId longer than its VarChar(36) column → the insert failed, and
        // the row — including a cross-author clinical-note read — was never written. Anyone could dodge the audit by
        // appending a query string). The full URL, query included, is still kept in metadata.url.
        const segments = url.split("?")[0].split("/").filter(Boolean);
        // Truncated to the column widths as a backstop, so an odd path segment can never void the row either.
        const resource = (segments[1] ?? "unknown").slice(0, 100);
        const resourceId = segments[2]?.slice(0, 36);
        // A service (currently: Patients, Financeiro) may have recorded exactly what changed —
        // most mutations won't set this, and that's fine, the row is still useful without it.
        const diff = RequestContext.get()?.auditDiff;

        this.prisma.auditLog
          .create({
            data: {
              actorId: user?.sub,
              actorEmail: user?.email,
              action: method,
              resource,
              resourceId,
              ipAddress: ip,
              userAgent: headers["user-agent"]?.slice(0, 300),
              // `diff`'s values are whatever a service passed to setAuditDiff — arbitrary
              // caller-supplied data, so Prisma's precise Json input type can't be proven here.
              metadata: { url, ...(diff ? { diff } : {}) } as never,
            },
          })
          .catch((err: unknown) => {
            // Audit failures must never break the request — but they must not vanish either.
            this.logger.error(
              `Failed to write audit log for ${method} ${url}: ${err instanceof Error ? err.message : String(err)}`
            );
          });
      })
    );
  }
}
