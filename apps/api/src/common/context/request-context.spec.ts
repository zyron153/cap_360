import { RequestContext } from "./request-context";

describe("RequestContext — audit diff capture", () => {
  it("setAuditDiff stores before/after on the context, readable via get() within the same run()", () => {
    const ctx = RequestContext.create();
    RequestContext.run(ctx, () => {
      RequestContext.setAuditDiff({ status: "pending" }, { status: "approved" });
      expect(RequestContext.get()?.auditDiff).toEqual({
        before: { status: "pending" },
        after: { status: "approved" },
      });
    });
  });

  it("auditDiff is undefined on a fresh context that never called setAuditDiff", () => {
    const ctx = RequestContext.create();
    RequestContext.run(ctx, () => {
      expect(RequestContext.get()?.auditDiff).toBeUndefined();
    });
  });

  it("does nothing (never throws) when called outside a run() — no context to attach to", () => {
    expect(() => RequestContext.setAuditDiff({ a: 1 }, { a: 2 })).not.toThrow();
  });
});
