import { SetMetadata } from "@nestjs/common";

/**
 * Marks a GET route as sensitive enough to audit-log even though it's a read, not a mutation
 * (e.g. "patient record viewed" — SECURITY.md requires this specifically). AuditInterceptor
 * only logs GETs carrying this metadata; unmarked GETs (lists, dashboards, ...) stay unlogged
 * so the audit table doesn't fill with routine read traffic.
 */
export const AUDIT_VIEW_KEY = "auditView";
export const AuditView = () => SetMetadata(AUDIT_VIEW_KEY, true);
