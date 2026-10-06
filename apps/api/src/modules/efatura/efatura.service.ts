import { Injectable, Logger, ConflictException } from "@nestjs/common";
import { InjectQueue } from "@nestjs/bull";
import { Queue } from "bull";
import type { Prisma, EFaturaStatus } from "@cap/database";
import { PrismaService } from "../../prisma/prisma.service";
import { EncryptionService } from "../../common/services/encryption.service";
import { cvParts } from "../../common/cabo-verde-time";
import { EFaturaConfigService, efaturaProvider, type ReadyConfig, type TechplaceConfig } from "./efatura-config.service";
import { EFaturaClientService } from "./efatura-client.service";
import { TechplaceClientService, TECHPLACE_UNCERTAIN } from "./techplace/techplace-client.service";
import { pickMethod, toIssueBody, type TpLine } from "./techplace/techplace-mapper";
import { EFaturaError, clip } from "./efatura.errors";
import { buildDfeXml, buildEventXml, normText } from "./dfe/dfe-xml";
import { signXml } from "./dfe/dfe-signer";
import { buildEventId, buildIud } from "./dfe/iud";
import { zipXml } from "./dfe/zip";
import { fmtCents, splitInclusive, rateToMilli, toCents } from "./dfe/money";
import { DOC_TYPE_CODE, type DfeInput, type DfeParty } from "./dfe/dfe.types";
import { buildLines, chooseDocument, dfeTax, toDfePayment, type ItemInput, type TaxPolicy } from "./dfe/invoice-mapper";

const MAX_ATTEMPTS = 3;
/** The platform only accepts online documents issued within 24h of its clock — stop well before that. */
const STALE_MS = 20 * 3_600_000;
/** Waiting for something outside the queue (payment, NIF, the primary document). */
const PARKED = ["AWAITING_PAYMENT", "AWAITING_PRIMARY", "NEEDS_NIF", "TECHPLACE_UNSUPPORTED"];
const SWEEP_EVERY_MS = 60_000;
/** Techplace rows that wait for a human: re-sending would duplicate a sale that may already exist.
 * The admin's "Retentar" clears the code and is the only way back into the queue. */
const NO_AUTO_RETRY = [TECHPLACE_UNCERTAIN, "TECHPLACE_TOTAL_MISMATCH"];

type Tx = Prisma.TransactionClient;

/** Everything about a submission that is safe to show (never the encrypted signed XML). */
const PUBLIC_FIELDS = {
  id: true, invoiceId: true, purpose: true, paymentId: true, status: true, documentTypeCode: true,
  year: true, ledCode: true, serie: true, documentNumber: true, iud: true, externalCode: true, issuedAt: true, reason: true,
  errorCode: true, errorMessage: true, retryCount: true, submittedAt: true, acceptedAt: true,
  createdAt: true, updatedAt: true,
} as const;

type Sub = Prisma.EFaturaSubmissionGetPayload<{
  include: {
    invoice: {
      include: {
        patient: { select: { fullName: true; nif: true } };
        items: { include: { service: { select: { id: true; code: true; name: true; price: true; techplaceProductId: true } } } };
        payments: true;
      };
    };
    payment: true;
    references: true;
  };
}>;

/** What a preparation step decided. */
type Outcome =
  | { kind: "ready" } // signed XML stored, go and send it
  | { kind: "wait"; code: string; message: string } // park as pending
  | { kind: "skip"; status: Extract<EFaturaStatus, "cancelled" | "not_required">; message?: string };

@Injectable()
export class EFaturaService {
  private readonly logger = new Logger(EFaturaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: EFaturaConfigService,
    private readonly client: EFaturaClientService,
    private readonly encryption: EncryptionService,
    @InjectQueue("efatura") private readonly queue: Queue,
    private readonly techplace: TechplaceClientService
  ) {}

  // ── Scheduling (used by billing) ───────────────────────────────────────────

  /** Whether e-Fatura reporting is switched on, and from when invoices count. */
  async reporting(): Promise<{ enabled: boolean; goLiveAt: Date | null }> {
    const v = await this.config.getView();
    return { enabled: v.enabled, goLiveAt: v.goLiveAt ? new Date(v.goLiveAt) : null };
  }

  /** Puts a submission on the queue. One job per submission at a time (`jobId` dedupes), and a
   * failure to enqueue is not fatal: the sweeper picks the row up. */
  async enqueue(submissionId: string): Promise<void> {
    try {
      await this.queue.add(
        "submit",
        { submissionId },
        { jobId: `submit-${submissionId}`, attempts: MAX_ATTEMPTS, backoff: { type: "exponential", delay: 5_000 }, removeOnComplete: true, removeOnFail: true }
      );
    } catch (e) {
      this.logger.warn(`Could not enqueue submission ${submissionId}: ${e instanceof Error ? e.message : String(e)} — the sweeper will retry`);
    }
  }

  /** The invoice's own fiscal document (FTE/FRE/TVE). */
  primaryFor(invoiceId: string) {
    return this.prisma.eFaturaSubmission.findFirst({ where: { invoiceId, purpose: "issue" }, select: PUBLIC_FIELDS });
  }

  /** Every fiscal document and event sent for the invoice, oldest first. */
  documents(invoiceId: string) {
    return this.prisma.eFaturaSubmission.findMany({ where: { invoiceId }, select: PUBLIC_FIELDS, orderBy: { createdAt: "asc" } });
  }

  /** Registers the repeatable sweep job (idempotent). */
  async scheduleSweeper(): Promise<void> {
    await this.queue.add("sweep", {}, { jobId: "efatura-sweep", repeat: { every: SWEEP_EVERY_MS }, removeOnComplete: true, removeOnFail: true });
  }

  /** Admin pressed "retry": every failed document of the invoice goes again; a rejected one is
   * re-prepared (its data may have been fixed), a technically failed one is re-sent as signed. */
  async retry(invoiceId: string): Promise<number> {
    const rows = await this.prisma.eFaturaSubmission.findMany({
      where: { invoiceId, status: { in: ["error", "rejected", "pending"] } },
      select: { id: true, status: true },
    });
    for (const r of rows) {
      await this.prisma.eFaturaSubmission.update({
        where: { id: r.id },
        data: {
          status: "pending",
          errorCode: null,
          errorMessage: null,
          ...(r.status === "rejected" ? { signedXml: null, iud: null, issuedAt: null, submittedAt: null } : {}),
        },
      });
      await this.enqueue(r.id);
    }
    return rows.length;
  }

  // ── Worker ──────────────────────────────────────────────────────────────────

  async process(id: string): Promise<void> {
    const claimed = await this.prisma.eFaturaSubmission.updateMany({
      where: { id, status: { in: ["pending", "error"] } },
      data: { status: "submitting" },
    });
    if (claimed.count === 0) return; // already done, cancelled, or another worker has it

    try {
      const sub = await this.load(id);
      if (efaturaProvider() === "techplace") return await this.processTechplace(sub);
      const resolved = await this.config.resolve();
      if (!resolved.enabled) return void (await this.park(id, "DISABLED", "Integração e-Fatura desativada"));
      if (!resolved.ok) throw new EFaturaError("NOT_CONFIGURED", `Configuração incompleta: ${resolved.missing.join("; ")}`, false);
      const cfg = resolved.config;

      const outcome = await this.prepareIfNeeded(sub, cfg);
      if (await this.settle(id, outcome)) return;

      await this.send(await this.load(id), cfg);
    } catch (e) {
      await this.fail(id, e);
      if (!(e instanceof EFaturaError) || e.retryable) throw e; // let Bull retry transient failures
    }
  }

  /** Re-queues anything that fell through the cracks: lost jobs, crashed workers, and failed
   * attempts whose back-off has elapsed (1, 2, 4 … 60 minutes). */
  async sweep(): Promise<number> {
    const resolved = efaturaProvider() === "techplace" ? await this.config.resolveTechplace() : await this.config.resolve();
    if (!resolved.enabled || !resolved.ok) return 0;
    const now = Date.now();
    const live = resolved.config.goLiveAt;
    const rows = await this.prisma.eFaturaSubmission.findMany({
      where: {
        status: { in: ["pending", "submitting", "error"] },
        ...(live ? { invoice: { issuedAt: { gte: live } } } : {}),
      },
      select: { id: true, status: true, retryCount: true, updatedAt: true, errorCode: true },
      orderBy: { updatedAt: "asc" },
      take: 200,
    });
    let n = 0;
    for (const r of rows) {
      if (r.errorCode && NO_AUTO_RETRY.includes(r.errorCode)) continue;
      const age = now - r.updatedAt.getTime();
      const parked = r.status === "pending" && r.errorCode != null && PARKED.includes(r.errorCode);
      const due =
        r.status === "pending" ? age > (parked ? 15 * 60_000 : 60_000) :
        r.status === "submitting" ? age > 10 * 60_000 :
        age > Math.min(2 ** Math.min(r.retryCount, 6), 60) * 60_000;
      if (!due) continue;
      if (r.status === "submitting") {
        await this.prisma.eFaturaSubmission.updateMany({ where: { id: r.id, status: "submitting" }, data: { status: "pending" } });
      }
      await this.enqueue(r.id);
      n++;
    }
    return n;
  }

  // ── Voiding (used by BillingService.cancel, inside its transaction) ────────────

  /** Decides what cancelling an invoice means for DNRE and records it. Returns the submissions to
   * enqueue once the surrounding transaction commits.
   *  - never reported / never authorized → its documents are simply cancelled locally;
   *  - authorized, nothing paid → an FDC event voids it;
   *  - authorized FTE with payments → a credit note (NCE) reverses it;
   *  - currently being sent → 409, the caller must retry in a moment. */
  async planVoid(tx: Tx, invoiceId: string, reason: string, hasPayments: boolean): Promise<string[]> {
    const subs = await tx.eFaturaSubmission.findMany({ where: { invoiceId } });
    const primary = subs.find((s) => s.purpose === "issue");
    if (!primary) return [];
    if (primary.status === "submitting") {
      throw new ConflictException("A fatura está a ser comunicada à e-Fatura — tente cancelar dentro de instantes");
    }
    const open: EFaturaStatus[] = ["pending", "error", "rejected", "not_required"];
    const toCancel = subs.filter((s) => open.includes(s.status) && s.id !== primary.id).map((s) => s.id);

    // Reported to DNRE (or possibly so: a send whose answer was lost) → the platform must be told.
    const maybeLive =
      primary.status === "accepted" ||
      (primary.status === "error" && primary.submittedAt != null && (primary.iud != null || primary.externalId != null || primary.errorCode === TECHPLACE_UNCERTAIN));
    if (!maybeLive) {
      await tx.eFaturaSubmission.updateMany({ where: { id: { in: [primary.id, ...toCancel] } }, data: { status: "cancelled" } });
      return [];
    }
    await tx.eFaturaSubmission.updateMany({ where: { id: { in: toCancel } }, data: { status: "cancelled" } });
    const purpose = hasPayments && primary.documentTypeCode === DOC_TYPE_CODE.invoice ? "credit_note" : "cancel";
    const created = await tx.eFaturaSubmission.create({
      data: { invoiceId, purpose, referencesId: primary.id, reason: clip(reason) },
    });
    return [created.id];
  }

  // ── Internals ───────────────────────────────────────────────────────────────

  private load(id: string): Promise<Sub> {
    return this.prisma.eFaturaSubmission.findUniqueOrThrow({
      where: { id },
      include: {
        invoice: {
          include: {
            patient: { select: { fullName: true, nif: true } },
            items: { include: { service: { select: { id: true, code: true, name: true, price: true, techplaceProductId: true } } } },
            payments: true,
          },
        },
        payment: true,
        references: true,
      },
    });
  }

  private async park(id: string, code: string, message: string) {
    await this.prisma.eFaturaSubmission.update({ where: { id }, data: { status: "pending", errorCode: code, errorMessage: clip(message) } });
  }

  private async fail(id: string, e: unknown) {
    const known = e instanceof EFaturaError;
    if (!known) this.logger.error(`Submission ${id} failed unexpectedly: ${e instanceof Error ? e.stack : String(e)}`);
    await this.prisma.eFaturaSubmission
      .update({
        where: { id },
        data: {
          status: "error",
          errorCode: known ? e.code : "INTERNAL",
          // never persist raw platform bodies — only our own messages
          errorMessage: clip(known ? e.message : "Erro interno ao preparar ou enviar o documento"),
        },
      })
      .catch((err) => this.logger.error(`Could not record failure of ${id}: ${err}`));
  }

  private nifOf(sub: Sub): string | null {
    const enc = sub.invoice.patient.nif;
    if (!enc) return null;
    try {
      return this.encryption.decrypt(enc);
    } catch {
      throw new EFaturaError("BAD_RECEIVER_NIF", "O NIF do paciente não pôde ser lido", false);
    }
  }

  private receiver(sub: Sub): DfeParty | undefined {
    const nif = this.nifOf(sub);
    if (!nif) return undefined;
    const name = normText(sub.invoice.patient.fullName ?? "").slice(0, 150);
    if (name.length < 3) throw new EFaturaError("BAD_RECEIVER_NAME", "O nome do paciente é demasiado curto para a fatura", false);
    return { taxId: nif, name };
  }

  private items(sub: Sub): ItemInput[] {
    return sub.invoice.items.map((i) => ({
      description: i.description,
      quantity: i.quantity,
      totalCents: toCents(i.total),
      serviceCode: i.service?.code,
      serviceName: i.service?.name,
    }));
  }

  /** The tax frozen on the invoice when its document was prepared, else the configured policy. */
  private policy(sub: Sub, cfg: ReadyConfig): TaxPolicy {
    const it = sub.invoice.items.find((i) => i.taxTypeCode);
    if (!it) return cfg.tax;
    return it.taxTypeCode === "IVA"
      ? { typeCode: "IVA", percentage: Number(it.taxPercentage) }
      : { typeCode: "NA", exemptionReasonCode: it.taxExemptionReasonCode ?? undefined };
  }

  private transmission(cfg: ReadyConfig) {
    return { issueMode: 1 as const, transmitterTaxId: cfg.transmitterTaxId, software: cfg.software };
  }

  private emitter(cfg: ReadyConfig): DfeParty {
    const e = cfg.emitter;
    return { taxId: e.taxId, name: normText(e.name).slice(0, 150), address: { detail: e.addressDetail, code: e.addressCode }, phone: e.phone, email: e.email };
  }

  /** Next DocumentNumber for (year, LED, type), gap-free: the increment commits with the document. */
  private async allocate(tx: Tx, year: number, ledCode: number, type: number): Promise<number> {
    const rows = await tx.$queryRaw<{ lastNumber: number }[]>`
      INSERT INTO efatura_counters ("year", "ledCode", "documentTypeCode", "lastNumber")
      VALUES (${year}, ${ledCode}, ${type}, 1)
      ON CONFLICT ("year", "ledCode", "documentTypeCode")
      DO UPDATE SET "lastNumber" = efatura_counters."lastNumber" + 1
      RETURNING "lastNumber"`;
    return rows[0].lastNumber;
  }

  private async prepareIfNeeded(sub: Sub, cfg: ReadyConfig): Promise<Outcome> {
    // A prepared document that was never sent but has gone stale is rebuilt (fresh time, same number).
    if (sub.signedXml && sub.issuedAt && !sub.submittedAt && Date.now() - sub.issuedAt.getTime() > STALE_MS) {
      await this.prisma.eFaturaSubmission.update({ where: { id: sub.id }, data: { signedXml: null, iud: null, issuedAt: null } });
      sub = await this.load(sub.id);
    }
    if (sub.signedXml) return { kind: "ready" };

    switch (sub.purpose) {
      case "issue":
        return this.prepareIssue(sub, cfg);
      case "receipt":
        return this.prepareReceipt(sub, cfg);
      case "credit_note":
        return this.prepareCreditNote(sub, cfg);
      case "cancel":
        return this.prepareCancel(sub, cfg);
    }
  }

  private async prepareIssue(sub: Sub, cfg: ReadyConfig): Promise<Outcome> {
    const inv = sub.invoice;
    if (inv.status === "cancelled") return { kind: "skip", status: "cancelled" };
    if (inv.status === "draft") return { kind: "wait", code: "AWAITING_PAYMENT", message: "A fatura ainda é um rascunho" };
    if (cfg.goLiveAt && inv.issuedAt && inv.issuedAt < cfg.goLiveAt) {
      return { kind: "skip", status: "not_required", message: "Fatura emitida antes da data de arranque da e-Fatura" };
    }

    const now = new Date();
    const cv = cvParts(now);
    const built = buildLines(this.items(sub), cfg.tax);
    const totalCents = toCents(inv.total);
    if (built.payableCents !== totalCents) {
      throw new EFaturaError("TOTAL_MISMATCH", `O total calculado (${fmtCents(built.payableCents)}) difere do total da fatura (${fmtCents(totalCents)})`, false);
    }

    const sameDay = inv.payments.filter((p) => cvParts(p.paidAt).date === cv.date);
    const paidSameDayCents = sameDay.reduce((s, p) => s + toCents(p.amount), 0);
    const nif = this.nifOf(sub);
    const decision = chooseDocument({ totalCents, paidSameDayCents, hasNif: !!nif });
    if ("wait" in decision) {
      if (decision.wait === "NOTHING_TO_REPORT") return { kind: "skip", status: "not_required", message: decision.message };
      return { kind: "wait", code: decision.wait, message: decision.message };
    }

    const kind = decision.kind;
    const type = DOC_TYPE_CODE[kind];
    const settled = kind !== "invoice";

    await this.prisma.$transaction(async (tx) => {
      const reuse = sub.documentNumber != null && sub.documentTypeCode === type && sub.year === cv.year && sub.ledCode === cfg.ledCode;
      const number = reuse ? (sub.documentNumber as number) : await this.allocate(tx, cv.year, cfg.ledCode, type);
      const iud = buildIud({ repositoryCode: cfg.repositoryCode, yymmdd: cv.yymmdd, nif: cfg.emitter.taxId, ledCode: cfg.ledCode, documentTypeCode: type, documentNumber: number });
      const input: DfeInput = {
        kind,
        iud,
        ledCode: cfg.ledCode,
        serie: cfg.serie,
        documentNumber: number,
        innerNumber: inv.invoiceNumber,
        issueDate: cv.date,
        issueTime: cv.time,
        isSpecimen: cfg.isSpecimen || undefined,
        emitter: this.emitter(cfg),
        receiver: kind === "sales_receipt" ? undefined : this.receiver(sub),
        lines: built.lines,
        totals: built.totals,
        payments: settled ? sameDay.map((p) => toDfePayment({ amountCents: toCents(p.amount), method: p.method, reference: p.reference, paidAtCvDate: cvParts(p.paidAt).date })) : undefined,
        transmission: this.transmission(cfg),
        repositoryCode: cfg.repositoryCode,
      };
      const signed = signXml(buildDfeXml(input), iud, cfg.signingKey, cv.dateTime);

      await tx.eFaturaSubmission.update({
        where: { id: sub.id },
        data: {
          documentTypeCode: type, year: cv.year, ledCode: cfg.ledCode, serie: cfg.serie, documentNumber: number,
          repositoryCode: cfg.repositoryCode, iud, issuedAt: now, signedXml: this.encryption.encrypt(signed),
          errorCode: null, errorMessage: null,
        },
      });
      await tx.invoiceItem.updateMany({
        where: { invoiceId: inv.id },
        data: {
          taxTypeCode: cfg.tax.typeCode,
          taxPercentage: cfg.tax.typeCode === "IVA" ? cfg.tax.percentage : null,
          taxExemptionReasonCode: cfg.tax.typeCode === "NA" ? cfg.tax.exemptionReasonCode : null,
        },
      });
      // Paid in full on the day → the FRE/TVE already reports every payment: no receipts needed.
      if (settled) {
        await tx.eFaturaSubmission.updateMany({
          where: { invoiceId: inv.id, purpose: "receipt", status: { in: ["pending", "error"] } },
          data: { status: "not_required" },
        });
      }
    });
    return { kind: "ready" };
  }

  private async prepareReceipt(sub: Sub, cfg: ReadyConfig): Promise<Outcome> {
    const primary = sub.references;
    const pay = sub.payment;
    if (!primary || !pay) return { kind: "skip", status: "not_required", message: "Recibo sem documento de origem" };
    if (primary.status === "cancelled") return { kind: "skip", status: "cancelled" };
    if (primary.status === "not_required" || primary.documentTypeCode === DOC_TYPE_CODE.invoice_receipt || primary.documentTypeCode === DOC_TYPE_CODE.sales_receipt) {
      return { kind: "skip", status: "not_required", message: "O pagamento já consta da fatura-recibo" };
    }
    if (primary.status !== "accepted" || !primary.iud) {
      return { kind: "wait", code: "AWAITING_PRIMARY", message: "A aguardar a autorização da fatura" };
    }
    const receiver = this.receiver(sub);
    if (!receiver) throw new EFaturaError("NEEDS_NIF", "O recibo precisa do NIF do paciente", false);

    const now = new Date();
    const cv = cvParts(now);
    const policy = this.policy(sub, cfg);
    const amountCents = toCents(pay.amount);
    const taxCents = policy.typeCode === "IVA" ? splitInclusive(amountCents, rateToMilli(policy.percentage ?? 0)).tax : undefined;
    const type = DOC_TYPE_CODE.receipt;

    await this.prisma.$transaction(async (tx) => {
      const reuse = sub.documentNumber != null && sub.documentTypeCode === type && sub.year === cv.year && sub.ledCode === cfg.ledCode;
      const number = reuse ? (sub.documentNumber as number) : await this.allocate(tx, cv.year, cfg.ledCode, type);
      const iud = buildIud({ repositoryCode: cfg.repositoryCode, yymmdd: cv.yymmdd, nif: cfg.emitter.taxId, ledCode: cfg.ledCode, documentTypeCode: type, documentNumber: number });
      const xml = buildDfeXml({
        kind: "receipt",
        iud,
        ledCode: cfg.ledCode,
        serie: cfg.serie,
        documentNumber: number,
        innerNumber: sub.invoice.invoiceNumber,
        issueDate: cv.date,
        issueTime: cv.time,
        isSpecimen: cfg.isSpecimen || undefined,
        emitter: this.emitter(cfg),
        receiver,
        receiptTypeCode: 2,
        references: [{ iud: primary.iud as string, paymentAmount: fmtCents(amountCents), tax: dfeTax(policy, taxCents) }],
        payments: [toDfePayment({ amountCents, method: pay.method, reference: pay.reference, paidAtCvDate: cvParts(pay.paidAt).date })],
        transmission: this.transmission(cfg),
        repositoryCode: cfg.repositoryCode,
      });
      await tx.eFaturaSubmission.update({
        where: { id: sub.id },
        data: {
          documentTypeCode: type, year: cv.year, ledCode: cfg.ledCode, serie: cfg.serie, documentNumber: number,
          repositoryCode: cfg.repositoryCode, iud, issuedAt: now,
          signedXml: this.encryption.encrypt(signXml(xml, iud, cfg.signingKey, cv.dateTime)),
          errorCode: null, errorMessage: null,
        },
      });
    });
    return { kind: "ready" };
  }

  private async prepareCreditNote(sub: Sub, cfg: ReadyConfig): Promise<Outcome> {
    const primary = sub.references;
    if (!primary || primary.status !== "accepted" || !primary.iud) return { kind: "wait", code: "AWAITING_PRIMARY", message: "A aguardar a autorização da fatura original" };
    const receiver = this.receiver(sub);
    if (!receiver) throw new EFaturaError("NEEDS_NIF", "A nota de crédito precisa do NIF do paciente", false);

    const now = new Date();
    const cv = cvParts(now);
    const built = buildLines(this.items(sub), this.policy(sub, cfg));
    const type = DOC_TYPE_CODE.credit_note;
    const note = normText(`Anulação da fatura ${sub.invoice.invoiceNumber}: ${sub.reason ?? ""}`).slice(0, 500);

    await this.prisma.$transaction(async (tx) => {
      const reuse = sub.documentNumber != null && sub.documentTypeCode === type && sub.year === cv.year && sub.ledCode === cfg.ledCode;
      const number = reuse ? (sub.documentNumber as number) : await this.allocate(tx, cv.year, cfg.ledCode, type);
      const iud = buildIud({ repositoryCode: cfg.repositoryCode, yymmdd: cv.yymmdd, nif: cfg.emitter.taxId, ledCode: cfg.ledCode, documentTypeCode: type, documentNumber: number });
      const xml = buildDfeXml({
        kind: "credit_note",
        iud,
        ledCode: cfg.ledCode,
        serie: cfg.serie,
        documentNumber: number,
        innerNumber: sub.invoice.invoiceNumber,
        issueDate: cv.date,
        issueTime: cv.time,
        isSpecimen: cfg.isSpecimen || undefined,
        emitter: this.emitter(cfg),
        receiver,
        lines: built.lines,
        totals: built.totals,
        references: [{ iud: primary.iud as string }],
        issueReasonCode: cfg.creditNoteReasonCode,
        note,
        transmission: this.transmission(cfg),
        repositoryCode: cfg.repositoryCode,
      });
      await tx.eFaturaSubmission.update({
        where: { id: sub.id },
        data: {
          documentTypeCode: type, year: cv.year, ledCode: cfg.ledCode, serie: cfg.serie, documentNumber: number,
          repositoryCode: cfg.repositoryCode, iud, issuedAt: now,
          signedXml: this.encryption.encrypt(signXml(xml, iud, cfg.signingKey, cv.dateTime)),
          errorCode: null, errorMessage: null,
        },
      });
    });
    return { kind: "ready" };
  }

  private async prepareCancel(sub: Sub, cfg: ReadyConfig): Promise<Outcome> {
    const primary = sub.references;
    if (!primary?.iud) return { kind: "skip", status: "not_required", message: "Documento de origem sem IUD" };
    const now = new Date();
    const cv = cvParts(now);
    const id = buildEventId(cfg.repositoryCode, cv.yymmddhhmmss, cfg.emitter.taxId);
    const reason = normText(`Anulação da fatura ${sub.invoice.invoiceNumber}: ${sub.reason ?? ""}`).slice(0, 500);
    const xml = buildEventXml({
      type: "FDC",
      id,
      emitterTaxId: cfg.emitter.taxId,
      issueDateTime: cv.dateTime,
      reason,
      iuds: [primary.iud],
      transmission: this.transmission(cfg),
      repositoryCode: cfg.repositoryCode,
    });
    await this.prisma.eFaturaSubmission.update({
      where: { id: sub.id },
      data: {
        repositoryCode: cfg.repositoryCode, iud: id, issuedAt: now,
        signedXml: this.encryption.encrypt(signXml(xml, id, cfg.signingKey, cv.dateTime)),
        errorCode: null, errorMessage: null,
      },
    });
    return { kind: "ready" };
  }

  /** Sends the stored, signed document. Re-sending after an ambiguous failure first asks the
   * platform whether it already holds the document, so a lost answer never becomes a duplicate. */
  private async send(sub: Sub, cfg: ReadyConfig): Promise<void> {
    const signed = this.encryption.decrypt(sub.signedXml as string);
    const iud = sub.iud as string;
    const isEvent = sub.purpose === "cancel";

    if (sub.submittedAt && !isEvent && (await this.client.dfeExists(iud, cfg.repositoryCode))) {
      await this.prisma.eFaturaSubmission.update({
        where: { id: sub.id },
        data: { status: "accepted", acceptedAt: new Date(), errorCode: null, errorMessage: null },
      });
      return this.releaseReceipts(sub);
    }
    if (sub.submittedAt && sub.issuedAt && Date.now() - sub.issuedAt.getTime() > STALE_MS) {
      throw new EFaturaError("EXPIRED_ONLINE_WINDOW", "Passaram mais de 24 horas desde a emissão: o modo online já não aceita este documento (requer contingência)", false);
    }

    await this.prisma.eFaturaSubmission.update({
      where: { id: sub.id },
      data: { submittedAt: new Date(), retryCount: { increment: 1 } },
    });
    const result = await this.client.post(isEvent ? "event" : "dfe", zipXml(`${iud}.xml`, signed), cfg.repositoryCode);

    if (result.succeeded) {
      await this.prisma.eFaturaSubmission.update({
        where: { id: sub.id },
        data: { status: "accepted", acceptedAt: result.authorizedAt ?? new Date(), errorCode: null, errorMessage: null },
      });
      return this.releaseReceipts(sub);
    }
    const first = result.messages[0];
    this.logger.warn(`Submission ${sub.id} rejected by DNRE: ${result.messages.map((m) => m.code).join(",") || "no code"}`);
    await this.prisma.eFaturaSubmission.update({
      where: { id: sub.id },
      data: {
        status: "rejected",
        errorCode: (first?.code || "REJECTED").slice(0, 50),
        errorMessage: clip(result.messages.map((m) => `${m.code}: ${m.description}`).join(" | ") || "Documento rejeitado pela plataforma"),
      },
    });
  }

  /** Once an invoice's own document is authorized, the receipts that were waiting for it can go. */
  private async releaseReceipts(sub: Sub): Promise<void> {
    if (sub.purpose !== "issue") return;
    const waiting = await this.prisma.eFaturaSubmission.findMany({
      where: { invoiceId: sub.invoiceId, purpose: "receipt", status: "pending" },
      select: { id: true },
    });
    for (const r of waiting) await this.enqueue(r.id);
  }

  // ── Techplace transport ─────────────────────────────────────────────────────
  // Techplace signs and reports to DNRE for us, so there is no XML, number or certificate here:
  // CAP only hands over a fully paid sale (Fatura-Recibo / Talão de Venda) and records the sale's
  // number. What its public API cannot do yet (unpaid Fatura, receipts, credit notes, voids) is
  // parked as TECHPLACE_UNSUPPORTED for a human — never failed silently. See M6b.

  /** Applies a skip/wait decision; true = the submission is settled and nothing is sent. */
  private async settle(id: string, outcome: Outcome): Promise<boolean> {
    if (outcome.kind === "skip") {
      await this.prisma.eFaturaSubmission.update({
        where: { id },
        data: { status: outcome.status, errorCode: null, errorMessage: outcome.message ? clip(outcome.message) : null },
      });
      return true;
    }
    if (outcome.kind === "wait") {
      await this.park(id, outcome.code, outcome.message);
      return true;
    }
    return false;
  }

  private async processTechplace(sub: Sub): Promise<void> {
    // A sale that may exist in Techplace waits for a human; only "Retentar" (which clears the code) re-enters.
    if (sub.errorCode && NO_AUTO_RETRY.includes(sub.errorCode)) {
      return void (await this.prisma.eFaturaSubmission.update({ where: { id: sub.id }, data: { status: "error" } }));
    }
    const resolved = await this.config.resolveTechplace();
    if (!resolved.enabled) return void (await this.park(sub.id, "DISABLED", "Integração e-Fatura desativada"));
    if (!resolved.ok) throw new EFaturaError("NOT_CONFIGURED", `Configuração incompleta: ${resolved.missing.join("; ")}`, false);

    if (sub.purpose === "issue") return this.issueTechplace(sub, resolved.config);
    const unsupported: Outcome = { kind: "wait", code: "TECHPLACE_UNSUPPORTED", message: "O Techplace ainda não suporta este documento: trate-o no Techplace" };
    await this.settle(sub.id, sub.purpose === "receipt" ? this.receiptOutcome(sub, unsupported) : unsupported);
  }

  /** A payment already covered by a Fatura-Recibo / Talão needs no receipt; any other is unsupported. */
  private receiptOutcome(sub: Sub, unsupported: Outcome): Outcome {
    const primary = sub.references;
    if (!primary || !sub.payment) return { kind: "skip", status: "not_required", message: "Recibo sem documento de origem" };
    if (primary.status === "cancelled") return { kind: "skip", status: "cancelled" };
    const settled = primary.documentTypeCode === DOC_TYPE_CODE.invoice_receipt || primary.documentTypeCode === DOC_TYPE_CODE.sales_receipt;
    return primary.status === "not_required" || settled ? { kind: "skip", status: "not_required", message: "O pagamento já consta da fatura-recibo" } : unsupported;
  }

  private async issueTechplace(sub: Sub, cfg: TechplaceConfig): Promise<void> {
    const inv = sub.invoice;
    const totalCents = toCents(inv.total);
    // The sale already exists there (e.g. its total was wrong and an admin fixed it): never POST again.
    if (sub.externalId) return this.finishTechplace(sub.id, sub.externalId, cfg, totalCents);
    if (inv.status === "cancelled") return void (await this.settle(sub.id, { kind: "skip", status: "cancelled" }));
    if (inv.status === "draft") return void (await this.park(sub.id, "AWAITING_PAYMENT", "A fatura ainda é um rascunho"));
    if (cfg.goLiveAt && inv.issuedAt && inv.issuedAt < cfg.goLiveAt) {
      return void (await this.settle(sub.id, { kind: "skip", status: "not_required", message: "Fatura emitida antes da data de arranque da e-Fatura" }));
    }

    const now = new Date();
    const cv = cvParts(now);
    const items = this.items(sub);
    const itemsCents = items.reduce((s, i) => s + i.totalCents, 0);
    if (itemsCents !== totalCents) {
      throw new EFaturaError("TOTAL_MISMATCH", `A soma das linhas (${fmtCents(itemsCents)}) difere do total da fatura (${fmtCents(totalCents)})`, false);
    }
    const sameDay = inv.payments.filter((p) => cvParts(p.paidAt).date === cv.date);
    const paidSameDayCents = sameDay.reduce((s, p) => s + toCents(p.amount), 0);
    const nif = this.nifOf(sub);
    const decision = chooseDocument({ totalCents, paidSameDayCents, hasNif: !!nif });
    if ("wait" in decision) {
      return void (await this.settle(
        sub.id,
        decision.wait === "NOTHING_TO_REPORT" ? { kind: "skip", status: "not_required", message: decision.message } : { kind: "wait", code: decision.wait, message: decision.message }
      ));
    }
    if (decision.kind === "invoice") {
      return void (await this.park(sub.id, "TECHPLACE_UNSUPPORTED", "Fatura por pagar: o Techplace ainda só regista faturas pagas na totalidade"));
    }
    const kind = decision.kind;
    const methodId = pickMethod(sameDay.map((p) => ({ amountCents: toCents(p.amount), method: p.method })), cfg.methods);

    // The sale names a customer (NIF) and products that must exist in Techplace first.
    let customerExt: string | undefined;
    if (nif && kind === "invoice_receipt") {
      const name = normText(inv.patient.fullName ?? "").slice(0, 150);
      if (name.length < 3) throw new EFaturaError("BAD_RECEIVER_NAME", "O nome do paciente é demasiado curto para a fatura", false);
      const c = await this.techplace.syncCustomer(cfg.credentials, {
        DESIG: name, NIF: nif, ESTADO: "A", IND_COLETIVO: "N", glb_user_ID: cfg.userId, Entidade_ID: cfg.entityId, CODIGO_EXT: nif,
      });
      // the customer is keyed by NIF, so "already there" is the normal answer from the second invoice on
      if (!c.ok && c.code !== "DUPLICATE_ENTRY") throw new EFaturaError(c.code, c.message, false);
      customerExt = nif;
    }
    const lines: TpLine[] = [];
    let discountCents = 0;
    const known = new Map<string, string>();
    for (const it of inv.items) {
      const cents = toCents(it.total);
      if (cents < 0) {
        discountCents -= cents;
        continue;
      }
      lines.push({ productId: await this.techplaceProduct(it.service, cfg, known), quantity: it.quantity, totalCents: cents });
    }

    const body = toIssueBody(
      { kind, codigoExt: sub.id, customerExt, lines, discountCents, totalCents, methodId },
      { entityId: cfg.entityId, userId: cfg.userId, types: cfg.types, conditionId: cfg.conditionId }
    );
    await this.prisma.eFaturaSubmission.update({
      where: { id: sub.id },
      data: { documentTypeCode: DOC_TYPE_CODE[kind], issuedAt: now, submittedAt: now, retryCount: { increment: 1 }, errorCode: null, errorMessage: null },
    });
    const r = await this.techplace.issue(cfg.credentials, body);
    if (!r.ok) {
      this.logger.warn(`Submission ${sub.id} refused by Techplace: ${r.code}`);
      await this.prisma.eFaturaSubmission.update({ where: { id: sub.id }, data: { status: "rejected", errorCode: r.code.slice(0, 50), errorMessage: clip(r.message) } });
      return;
    }
    await this.prisma.eFaturaSubmission.update({ where: { id: sub.id }, data: { externalId: r.data.faturaId, externalCode: r.data.vendaCode.slice(0, 50) } });
    // Paid in full → the sale already covers every payment: receipt rows are redundant.
    await this.prisma.eFaturaSubmission.updateMany({ where: { invoiceId: inv.id, purpose: "receipt", status: { in: ["pending", "error"] } }, data: { status: "not_required" } });
    await this.finishTechplace(sub.id, r.data.faturaId, cfg, totalCents);
  }

  /** The sale exists in Techplace: confirm it recorded our total, then mark the document issued. */
  private async finishTechplace(id: string, faturaId: string, cfg: TechplaceConfig, totalCents: number): Promise<void> {
    const recorded = await this.techplace.saleTotal(cfg.credentials, faturaId);
    if (recorded != null && toCents(recorded) !== totalCents) {
      throw new EFaturaError(
        "TECHPLACE_TOTAL_MISMATCH",
        `O total no Techplace (${fmtCents(toCents(recorded))}) difere do da fatura (${fmtCents(totalCents)}): corrija a venda no Techplace e carregue em Retentar`,
        false
      );
    }
    await this.prisma.eFaturaSubmission.update({ where: { id }, data: { status: "accepted", acceptedAt: new Date(), errorCode: null, errorMessage: null } });
  }

  /** The Techplace product behind an invoice line: registered the first time a Service is invoiced. */
  private async techplaceProduct(svc: Sub["invoice"]["items"][number]["service"], cfg: TechplaceConfig, known: Map<string, string>): Promise<string> {
    if (!svc) {
      if (cfg.fallbackProductId) return cfg.fallbackProductId;
      throw new EFaturaError("TECHPLACE_NO_PRODUCT", "Linha sem serviço: defina o produto genérico do Techplace (Configurações → e-Fatura)", false);
    }
    const have = svc.techplaceProductId ?? known.get(svc.id);
    if (have) return have;
    const r = await this.techplace.registerProduct(cfg.credentials, {
      CODIGO_EXT: svc.code, DESIG: normText(svc.name).slice(0, 150), produto_servico: "S", Vendivel: "V",
      unidade_ID: cfg.unitId, iva_ID: cfg.ivaId, Preco_venda: Number(svc.price), glb_user_ID: cfg.userId, Entidade_ID: cfg.entityId,
    });
    // ponytail: if Techplace answers "already exists" we have no id to read back — an admin sets
    // Service.techplaceProductId by hand. Add a product lookup once Techplace documents one.
    if (!r.ok) throw new EFaturaError(r.code, r.message, false);
    await this.prisma.service.updateMany({ where: { id: svc.id, techplaceProductId: null }, data: { techplaceProductId: r.data.produtoID } });
    known.set(svc.id, r.data.produtoID);
    return r.data.produtoID;
  }
}
