import { of, firstValueFrom, tap } from "rxjs";
import { AuditInterceptor } from "./audit.interceptor";
import { AUDIT_VIEW_KEY } from "../decorators/audit-view.decorator";
import { RequestContext } from "../context/request-context";

const prisma = { auditLog: { create: jest.fn() } };
const reflector = { getAllAndOverride: jest.fn() };

function makeContext(method: string, overrides: Partial<{ url: string; user: unknown }> = {}) {
  const request = {
    method,
    // NestJS's global prefix (app.setGlobalPrefix("v1")) shows up in request.url —
    // segments[0] is "v1", segments[1] is the resource, matching real request shape.
    url: overrides.url ?? "/v1/patients/p1",
    ip: "127.0.0.1",
    headers: { "user-agent": "jest" },
    user: overrides.user ?? { sub: "staff-1", email: "staff@cap.cv" },
  };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as import("@nestjs/common").ExecutionContext;
}

const nextHandler = { handle: () => of({ ok: true }) };

describe("AuditInterceptor", () => {
  let interceptor: AuditInterceptor;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.auditLog.create.mockResolvedValue({});
    interceptor = new AuditInterceptor(prisma as never, reflector as never);
  });

  it("logs mutating requests regardless of @AuditView metadata", async () => {
    reflector.getAllAndOverride.mockReturnValue(false);
    await firstValueFrom(interceptor.intercept(makeContext("PATCH"), nextHandler));
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it("does not log a GET with no @AuditView metadata (avoids flooding the table with routine reads)", async () => {
    reflector.getAllAndOverride.mockReturnValue(false);
    await firstValueFrom(interceptor.intercept(makeContext("GET"), nextHandler));
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it("logs a GET when the route carries @AuditView metadata", async () => {
    reflector.getAllAndOverride.mockImplementation((key) => key === AUDIT_VIEW_KEY);
    await firstValueFrom(interceptor.intercept(makeContext("GET", { url: "/v1/patients/p1" }), nextHandler));
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "GET", resource: "patients", resourceId: "p1" }),
      })
    );
  });

  it("keeps the query string out of resource/resourceId (it overflowed the VarChar(36) column, so appending ?x=… to a clinical-note read voided its audit row)", async () => {
    reflector.getAllAndOverride.mockImplementation((key) => key === AUDIT_VIEW_KEY);
    const id = "3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
    const padded = `/v1/clinical-notes/${id}?${"padding=".repeat(10)}`;

    await firstValueFrom(interceptor.intercept(makeContext("GET", { url: padded }), nextHandler));
    await firstValueFrom(interceptor.intercept(makeContext("GET", { url: "/v1/clinical-notes?q=maria&page=2" }), nextHandler));

    const [byId, list] = prisma.auditLog.create.mock.calls.map((c) => c[0].data);
    expect(byId).toMatchObject({ resource: "clinical-notes", resourceId: id });
    expect(byId.resourceId).toHaveLength(36);
    expect(byId.metadata.url).toBe(padded); // the full URL is still recorded, query and all
    expect(list.resource).toBe("clinical-notes"); // not "clinical-notes?q=maria&page=2"
    expect(list.resourceId).toBeUndefined();
  });

  it("truncates an over-long path segment to its column width instead of losing the whole audit row", async () => {
    reflector.getAllAndOverride.mockReturnValue(false);
    await firstValueFrom(interceptor.intercept(makeContext("PATCH", { url: `/v1/${"r".repeat(200)}/${"i".repeat(200)}` }), nextHandler));
    const { resource, resourceId } = prisma.auditLog.create.mock.calls[0][0].data;
    expect(resource).toHaveLength(100);
    expect(resourceId).toHaveLength(36);
  });

  it("includes the before/after diff in metadata when a service set one via RequestContext during the request", async () => {
    reflector.getAllAndOverride.mockReturnValue(false);
    const ctx = RequestContext.create();

    await RequestContext.run(ctx, async () => {
      const handlerThatEditsAndSetsADiff = {
        handle: () =>
          of(null).pipe(
            // simulate the service doing its work and recording a diff mid-request
            tap(() => RequestContext.setAuditDiff({ status: "pending" }, { status: "approved" }))
          ),
      };
      await firstValueFrom(interceptor.intercept(makeContext("PATCH"), handlerThatEditsAndSetsADiff));
    });

    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          metadata: expect.objectContaining({
            diff: { before: { status: "pending" }, after: { status: "approved" } },
          }),
        }),
      })
    );
  });

  it("omits the diff key entirely when no service set one — most mutations still won't", async () => {
    reflector.getAllAndOverride.mockReturnValue(false);
    const ctx = RequestContext.create();

    await RequestContext.run(ctx, async () => {
      await firstValueFrom(interceptor.intercept(makeContext("PATCH"), nextHandler));
    });

    const call = prisma.auditLog.create.mock.calls[0][0];
    expect(call.data.metadata).not.toHaveProperty("diff");
  });

  it("does not throw when the audit write fails, and logs the failure instead of swallowing it silently", async () => {
    reflector.getAllAndOverride.mockReturnValue(false);
    prisma.auditLog.create.mockRejectedValue(new Error("db down"));
    const errorSpy = jest.spyOn((interceptor as unknown as { logger: { error: (...a: unknown[]) => void } }).logger, "error");

    const result = await firstValueFrom(interceptor.intercept(makeContext("POST"), nextHandler));

    expect(result).toEqual({ ok: true }); // request still succeeds
    await new Promise((r) => setTimeout(r, 0)); // let the rejected promise's .catch handler run
    expect(errorSpy).toHaveBeenCalled();
  });
});
