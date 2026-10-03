# M6a — e-Fatura direct integration (Cabo Verde / DNRE)

> Status: implemented and unit-tested against DNRE's official XSD pack and sample documents;
> **not yet run against a live Homologação environment** (needs the clinic's credentials and
> certificate). Source of truth for the protocol: Manual Técnico v11.0 (2025-03-14) and the OpenAPI
> at `https://services.efatura.cv/api-list/`. Client-facing setup guide: `Docs/EFATURA_INTEGRATION.docx`.

## What it does

CAP 360 reports every invoice to the Plataforma Eletrónica (PE) of the Direção Nacional de Receitas do
Estado, as the manual specifies: one **signed XML** per document, zipped, `POST`ed as
`multipart/form-data` to `https://services.efatura.cv/v1/dfe` (events to `/v1/event`) with the
`cv-ef-repository-code` header (1 Principal · 2 Homologação · 3 Teste). Authentication is OAuth2
**Authorization Code + PKCE** against `iam.efatura.cv` with a refresh token (`offline_access`).

| Situation | Document |
|---|---|
| Paid in full the day it is issued, patient has a NIF | **FRE** — Fatura-Recibo (type 2) |
| Paid in full the day it is issued, no NIF, total < 20 000 CVE | **TVE** — Talão de Venda (type 3, no receiver) |
| Anything else, patient has a NIF | **FTE** — Fatura (type 1), then one **RCE** — Recibo (type 4) per payment |
| No NIF and not (fully) paid, or ≥ 20 000 CVE | parked: `AWAITING_PAYMENT` / `NEEDS_NIF` — nothing is sent |
| Zero-value invoice | not reported (`not_required`) |
| Voiding an authorized, unpaid invoice | **FDC** event (`/v1/event`) |
| Voiding an authorized FTE that already has payments | **NCE** — Nota de Crédito (type 5) referencing the FTE |
| Voiding something that never reached DNRE | cancelled locally, never sent |

## Flow

```
BillingService.create / first payment of a draft
   └─ invoice + efatura_submissions(purpose=issue) in ONE insert  →  queue "efatura" (jobId = submit-<id>)
BillingService.recordPayment
   └─ payment + efatura_submissions(purpose=receipt) in the same transaction
EFaturaProcessor "submit"  →  EFaturaService.process(id)
   1. claim the row (pending|error → submitting)         ← a second worker / duplicate job is a no-op
   2. config.resolve()  (missing → NOT_CONFIGURED, not retried)
   3. prepare once: choose document type · allocate the number (efatura_counters, same transaction)
      · build XML · XAdES-BES sign · store encrypted · freeze item tax · mark redundant receipts
   4. send: if an earlier attempt may have got through → GET /v1/dfe/xml/<IUD> first; else POST
   5. accepted | rejected(messages) | error(transient → Bull retries 3×, then the sweeper)
EFaturaProcessor "sweep" (repeatable, every 60 s)
   └─ re-queues lost jobs, crashed workers, and failed sends whose back-off (1,2,4…60 min) elapsed
```

Rules that matter:

- **Immutable identity.** Number, IUD, issue time and the signed XML are written once. A retry re-sends
  the identical bytes. A *rejected* document is re-prepared on retry (data may have been fixed) but
  keeps its number, so rejections never leave gaps. A never-sent document older than 20 h is rebuilt
  (the online window is ±24 h of the platform clock) with the same number.
- **Never send a cancelled invoice.** `process` re-checks `invoice.status`; `BillingService.cancel`
  plans the fiscal consequence in the same transaction as the cancellation (`EFaturaService.planVoid`)
  and answers `409` while the document is being sent.
- **Go-live.** `goLiveAt` is set to "now" when the integration is first switched on; invoices issued
  earlier are never reported, and their payments never produce receipts.
- **Money** is integer cents end to end. CAP prices are treated as **tax-inclusive**: with IVA the tax is
  extracted from each line (half-up), so `Net + Tax` equals what the patient pays; with an exemption
  (`NA` + reason code) tax is zero. A health-plan discount (negative line) becomes a `D` line with positive amounts.
- **Privacy.** Line descriptions use the catalogue service name rather than free text; `Invoice.notes` is never sent.

## Code map (`apps/api/src/modules/efatura`)

| File | Role |
|---|---|
| `dfe/dfe-xml.ts`, `dfe.types.ts` | XML builders in the XSD's element order (FTE, FRE, TVE, RCE, NCE, FDC) |
| `dfe/iud.ts` | 45-char IUD with the Luhn check digit (verified against DNRE's sample ids) |
| `dfe/dfe-signer.ts` | PKCS#12/PEM loader + XAdES-BES enveloped signature (layout of DNRE's sample) |
| `dfe/invoice-mapper.ts` | pure: lines, totals, tax, payments, document-type decision |
| `dfe/money.ts`, `dfe/zip.ts` | integer-cent arithmetic; one-entry Deflate ZIP |
| `efatura.service.ts` | orchestration: prepare / send / retry / sweep / planVoid |
| `efatura-client.service.ts` | the HTTP calls and response parsing (`responses[].succeeded`, `messages[]`) |
| `efatura-auth.service.ts` | PKCE flow, refresh under a Redis lock, token cache |
| `efatura-config.service.ts` | settings, readiness (`missing[]`), encrypted secrets |
| `efatura.controller.ts` | admin API (`/efatura/...`) |
| `testing/` | test-only: XSD validator, throw-away certificates, in-memory Prisma stand-in |

## Operating notes

- **Configure** (admin): *Configurações → Integrações → E-Fatura CV*. Fill LED, série, software, emitter
  data, tax treatment, OAuth client; upload the certificate; *Autorizar ligação*. The card lists what is still missing.
- **Stuck documents**: the invoice detail page lists every document with its state and the platform's
  message; *Retentar submissão* re-queues failed ones. Parked ones (`AWAITING_*`, `NEEDS_NIF`) explain what they wait for.
- **Specimens**: `isSpecimen` marks documents `<IsSpecimen>true</IsSpecimen>`; DNRE deletes them after 24 h.
- **Numbering**: `efatura_counters` starts every (year, LED, type) at 1. Seed it if the LED was used elsewhere.
- **Test fixtures**: `apps/api/test/fixtures/efatura-xsd` is DNRE's XSD pack (2024-05-27) plus the official
  sample XMLs; refresh it when DNRE publishes a new pack.

## Known limits / open questions (need DNRE or the accountant)

- Contingency (offline) issuing is not implemented: a document that cannot be sent within ~20 h of its
  issue time stops with `EXPIRED_ONLINE_WINDOW`. Deadlines in Decreto-Lei 79/2020 were not verified (the PDF is a scan).
- Exemption code / IVA treatment for psychology services, and the NCE reason code (`creditNoteReasonCode`), are configuration to be confirmed by the accountant.
- Whether a health-plan share is a discount to the patient or a separate invoice to the insurer.
- Tax-inclusive handling and `UnitCode "EA"` are inferred from the manual/XSD, not yet seen accepted by the platform.
- Receiver address/contacts are not sent (the XSD makes them optional and v11 only requires the NIF); if DNRE enforces them in Homologação, add them.
- Per-service tax classes, UDN events (releasing unused numbers), and foreign-NIF patients are not implemented.
