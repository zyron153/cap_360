// Test-only in-memory stand-in for the slice of Prisma that EFaturaService touches. It is
// deliberately small: just enough where-matching, includes and counters to exercise the real
// preparation / sending / sweeping logic without a database.
/* eslint-disable @typescript-eslint/no-explicit-any */

export interface FakeItem {
  id: string;
  description: string;
  quantity: number;
  total: string;
  service?: { code: string; name: string } | null;
  taxTypeCode?: string | null;
  taxPercentage?: string | null;
  taxExemptionReasonCode?: number | null;
}
export interface FakePayment {
  id: string;
  amount: string;
  method: string;
  reference?: string | null;
  paidAt: Date;
}
export interface FakeInvoice {
  id: string;
  invoiceNumber: string;
  status: string;
  issuedAt: Date | null;
  total: string;
  patient: { fullName: string | null; nif: string | null };
  items: FakeItem[];
  payments: FakePayment[];
}

function matches(row: any, where: any, db: FakeDb): boolean {
  return Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
    if (k === "invoice") {
      const inv = db.invoices.get(row.invoiceId);
      return !!inv && matches(inv, v, db);
    }
    const actual = row[k];
    if (v && typeof v === "object" && !(v instanceof Date)) {
      if ("in" in v) return v.in.includes(actual);
      if ("gte" in v) return actual != null && actual >= v.gte;
      if ("lt" in v) return actual != null && actual < v.lt;
    }
    return actual === v;
  });
}

export class FakeDb {
  subs = new Map<string, any>();
  invoices = new Map<string, FakeInvoice>();
  counters = new Map<string, number>();
  private seq = 0;

  addInvoice(inv: FakeInvoice) {
    this.invoices.set(inv.id, inv);
    return inv;
  }

  addSub(data: Record<string, any>) {
    const row = {
      id: `sub-${++this.seq}`,
      purpose: "issue",
      paymentId: null,
      referencesId: null,
      status: "pending",
      documentTypeCode: null,
      year: null,
      ledCode: null,
      serie: null,
      documentNumber: null,
      repositoryCode: null,
      iud: null,
      issuedAt: null,
      signedXml: null,
      reason: null,
      errorCode: null,
      errorMessage: null,
      retryCount: 0,
      submittedAt: null,
      acceptedAt: null,
      createdAt: new Date(Date.now() + this.seq),
      updatedAt: new Date(),
      ...data,
    };
    this.subs.set(row.id, row);
    return row;
  }

  private apply(row: any, data: Record<string, any>) {
    for (const [k, v] of Object.entries(data)) {
      row[k] = v && typeof v === "object" && "increment" in v ? (row[k] ?? 0) + v.increment : v;
    }
    row.updatedAt = new Date();
  }

  private assemble(row: any) {
    const inv = this.invoices.get(row.invoiceId)!;
    return {
      ...row,
      invoice: { ...inv },
      payment: row.paymentId ? inv.payments.find((p) => p.id === row.paymentId) ?? null : null,
      references: row.referencesId ? { ...this.subs.get(row.referencesId) } : null,
    };
  }

  eFaturaSubmission = {
    updateMany: async ({ where, data }: any) => {
      const hit = [...this.subs.values()].filter((r) => matches(r, where, this));
      hit.forEach((r) => this.apply(r, data));
      return { count: hit.length };
    },
    findUniqueOrThrow: async ({ where }: any) => {
      const row = this.subs.get(where.id);
      if (!row) throw new Error("not found");
      return this.assemble(row);
    },
    update: async ({ where, data }: any) => {
      const row = this.subs.get(where.id);
      if (!row) throw new Error("not found");
      this.apply(row, data);
      return { ...row };
    },
    findMany: async ({ where, take }: any = {}) => {
      const rows = [...this.subs.values()].filter((r) => matches(r, where, this)).sort((a, b) => a.updatedAt - b.updatedAt);
      return rows.slice(0, take ?? rows.length).map((r) => ({ ...r }));
    },
    findFirst: async ({ where }: any) => {
      const r = [...this.subs.values()].find((x) => matches(x, where, this));
      return r ? { ...r } : null;
    },
    create: async ({ data }: any) => ({ ...this.addSub(data) }),
  };

  invoiceItem = {
    updateMany: async ({ where, data }: any) => {
      const inv = this.invoices.get(where.invoiceId);
      inv?.items.forEach((i) => Object.assign(i, data));
      return { count: inv?.items.length ?? 0 };
    },
  };

  $transaction = async (fn: (tx: any) => Promise<any>) => fn(this);

  $queryRaw = async (_strings: TemplateStringsArray, year: number, led: number, type: number) => {
    const key = `${year}/${led}/${type}`;
    const next = (this.counters.get(key) ?? 0) + 1;
    this.counters.set(key, next);
    return [{ lastNumber: next }];
  };
}
