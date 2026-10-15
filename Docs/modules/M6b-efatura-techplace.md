# M6b — e-Fatura through Techplace (api.techplace.cv)

> Status: **phase 1 built, not run against Techplace** (no credentials, no sandbox). Off by default:
> the API keeps using the DNRE-direct transport ([M6a](M6a-efatura-direct-integration.md)) unless
> `EFATURA_PROVIDER=techplace` is set. The DNRE-direct code is deleted only after Gate B below.
> Source: Techplace's public docs (https://api.techplace.cv, 148 endpoints), read 2026-10-06.

## Why

Techplace is a CV invoicing/POS vendor that signs and reports to DNRE itself. Going through it was
expected to remove what the direct integration needs from the clinic (ICP-CV certificate, PE account and
OAuth client, software registration, our own LED numbering). **Ilhapay (below) contradicts the PE-account
part**: the clinic still needs its own PE account and a series created there.

## Ilhapay — the Techplace web ERP (checked 2026-10-08, read-only)

`https://ilhapay.techplace.cv/index.php` (Yii2, "Cloud Technology") is the web ERP the clinic uses with
Techplace. The clinic's entity is `CAPCV` (code 00024, NIF 289959195, enquadramento REMPE) and the login
`atendimento.psi` (Administrador, created 2026-10-08) works **there only**: `POST api.techplace.cv/api/v1/auth`
answers 401 for it, because `/auth` is the login of CAIXA operators (`/auth/admin` also needs the entity uuid,
which no Ilhapay page shows).

- **Documents it issues:** FT, FR, TV, RC, NC, ND, DV, NA, NL, FP, DT (`pr-fatura-tipo`) — so credit notes and
  receipts exist in the ERP, just not in the public API. Each invoice has a "Doc. Fiscais Eletrónico" column
  (`DFE_ENVIADO`, "Validado" …) and the entity has a *Modo Emissão* (Online / Offline / Off).
- **Blocker for any issuing:** "É necessário definir uma série antes de prosseguir — a sua empresa ainda não
  configurou uma série associada à sua conta no portal PE." `Nº de Série` is empty, so Fatura creation is
  refused. The series has to come from the clinic's own **PE account** (efatura.cv), same prerequisite as DNRE-direct.
- Codes confirmed against our config defaults: `FR`, `TV`, `FT`, `RC`, `NC` exist as document types; payment
  methods use the DNRE means codes (10 Dinheiro, 30 Transferência, 54/55 Cartão, 60 A Crédito, …); IVA rates
  `IVA` 15 %, `NA` 0 %, `IS` 20 %, `TEU` 4 %, `IR` 10 %; payment conditions include *Pronto pagamento* (0 days).
- **Ilhapay asks for Código LED + OAuth Client ID + Client Secret** (the same three DNRE-direct needs). Per the manual (v11
  §11.5) the OAuth client is registered in the PE under *Proprietário de Software* — the **software owner's** menu, so the
  Client ID/Secret come from Techplace, not from the clinic's PE account (Wisedat's guide says the same for its ERP). The
  clinic's own part: a PE user, one **LED per series** created on the PE, and (if Techplace asks) a certificate under
  *Certificado Digital*. The exact PE menu label for creating a LED is not in the manual — ask DNRE/Techplace.
- No public API, token or key screen in Ilhapay. The account has no clients, services or invoices yet.
- **Not verified:** that a sale posted to `api.techplace.cv/fatura/sincronizador` lands in this Ilhapay entity,
  and which uuid is its `entidadeID`/`utilizador` (the Ilhapay user id `5230c188-…` looks like the latter).

## What Techplace's API gives us (and what it does not)

| Need | Route | Notes |
|---|---|---|
| Issue a sale | `POST /api/v1/fatura/sincronizador` | the ERP route. Body: `entidadeID, utilizador, tipoFatura, estadoPagamento, valorPagamento, metodoPagamento, condicaoPagamento, cliente_externo, produtos[{produto_id,qttd,preco_unid}], desconto_financeiro, CODIGO_EXT`. Returns `faturaId`, `vendaCode`. Documented as unauthenticated. |
| Customer | `POST /cliente/sincronizador` | `DESIG, NIF, CODIGO_EXT, …`; `DUPLICATE_ENTRY` if it exists |
| Product | `POST /produto/registrar` | returns `produtoID` once; `produto_servico`, `iva_ID`, `unidade_ID` |
| Verify a sale | `GET /venda/id?id=` | `VALOR_FATURA`, products, payments (JWT) |
| Reference lists | `GET /fatura/tipo`, `/fatura/metodo/pagamento`, `/fatura/condicao/pagamento` | "Testar ligação" |
| Auth | `POST /auth` (24 h JWT, no refresh) or `api-key` / `x-api-key` header | |
| **Credit note, cancellation/void, DNRE status, IUD, QR/PDF, webhooks** | **none documented** | blocks Gate B |
| Later payments | `POST /fatura/reepagar` | needs a JWT **and an open cash-register session** — unusable for CAP |

Every route answers `{ success, msg, data }`, and `success:false` can arrive with HTTP 200. The docs
playground only simulates writes, so the write routes cannot be checked without credentials.

## What the code does now (phase 1)

Reuses the whole existing pipeline (queue, sweeper, `efatura_submissions` rows, `planVoid`,
the invoice detail panel). Only the preparation/sending changed — `techplace/` plus a branch in
`EFaturaService.process()`.

| Situation | Result |
|---|---|
| Paid in full the day it is issued, patient has a NIF | **Fatura-Recibo**: customer (NIF) registered, products registered, sale posted, `accepted` with `externalId`/`externalCode` |
| Paid in full, no NIF, < 20 000 CVE | **Talão de Venda**, no customer |
| Unpaid or partly paid, patient has a NIF (a Fatura) | parked `pending` / `TECHPLACE_UNSUPPORTED` — the sync route records one full payment |
| Receipt for a payment already inside a Fatura-Recibo/Talão | `not_required` |
| Any other receipt, a credit note, a void | parked `TECHPLACE_UNSUPPORTED` — a human does it in Techplace |
| Sale refused (`success:false`) | `rejected` with Techplace's code and message; *Retentar* re-sends |
| No answer / 5xx / reset after sending | `error` / `TECHPLACE_UNCERTAIN`: **never auto-resent** (no documented idempotency). The sweeper skips it; an admin checks Techplace, then *Retentar* |
| Techplace's recorded total ≠ the invoice total | `error` / `TECHPLACE_TOTAL_MISMATCH`: the sale exists (`externalId` kept), never POSTed again; fix it in Techplace, then *Retentar* re-checks |

Connection refused / DNS failure (the request never left) and 429 are retried normally.
"Emitida" (not "Autorizada") is shown for a Techplace sale because no IUD/DNRE outcome comes back yet.

## Assumptions — each is a question below; the first live sale checks the money one

- `preco_unid` is the **tax-inclusive** unit price (CAP prices are). After posting, the service reads
  `VALOR_FATURA` back and stops on a mismatch, so a wrong guess cannot reach the books silently.
- `desconto_financeiro` is an amount; a health-plan (negative) line is sent as the discount.
- `cliente_externo` is the customer's `CODIGO_EXT`; we use the patient's **NIF** as that code.
- One payment method per sale (the largest same-day payment names it).
- Techplace deduplicates nothing on `CODIGO_EXT` (we send the submission id anyway).
- If product registration answers "already exists" we cannot read the id back: an admin sets
  `services.techplaceProductId` by hand.

## Configuration

`EFATURA_PROVIDER=techplace` (API env; default `dnre`) and optional `TECHPLACE_BASE_URL` (default
`https://api.techplace.cv`, fixed — not admin-editable). Everything else is in *Configurações →
Integrações → E-Fatura CV* (admin): API key and/or login, entity id, user id, document type codes
(`FR`, `TV`), payment condition, payment-method ids, IVA/unit ids for new products, and the generic
product for invoice lines without a service. *Testar ligação* lists the ids it can. Secrets are
write-only and stored encrypted with the other e-Fatura secrets.

## Questions for Techplace (techplace.cv@gmail.com)

**[A] before the first live sale · [B] before DNRE-direct is deleted**

1. **[A]** Do you transmit our documents to DNRE e-Fatura as transmitter (your software code and
   certificate)? Ilhapay already says the series must be linked to the clinic's PE account — so does the
   clinic still need its own ICP-CV certificate, and how is the PE-linked series entered in Ilhapay?
   (Q1 is half answered: PE account yes.) Is the Ilhapay *Modo Emissão* Online what we want?
   **New:** which api-key / CAIXA user and `entidadeID` belong to the CAPCV entity, and does a sale posted to the
   API appear in Ilhapay? Ilhapay can issue NC/RC/ND in its UI — is there an endpoint for them (see 11)?
2. **[A]** Is a test entity/sandbox (own base URL) available? Which auth applies to `/fatura/sincronizador`,
   `/cliente/sincronizador`, `/produto/registrar` (`api-key`?) — the docs list them as unauthenticated; please enforce it.
3. **[A]** How do we get the DNRE outcome of a sale (IUD, authorized/rejected + messages) and the QR/PDF the patient must receive — endpoint or webhook (signed how)?
4. **[A]** Does the sync route deduplicate on `CODIGO_EXT`? Can a sale be looked up by it?
5. **[A]** `cliente_externo`: a name, or the customer's `CODIGO_EXT`? How is the receiver NIF passed?
6. **[A]** Can the sync route reference products by `CODIGO_EXT`? Which `iva_ID`/`unidade_ID` apply to a
   service, and how is an IVA exemption with a reason code expressed?
7. **[A]** Is `preco_unid` tax-inclusive or exclusive?
8. **[A]** Can one sale carry several payment methods?
9. `tipoFatura` codes for FT, FR, TV, RC and NC.
10. Unpaid Fatura: is `valor_total = valorPagamento` real? How do we issue an FT and report later payments (RC) without an open cash-register session?
11. **[B]** Credit note referencing an issued invoice, and voiding (anulação): endpoints and fields.
12. Rate limits, uptime commitment, and contingency if Techplace is down for more than 24 h.
13. Is `desconto_financeiro` an amount or a percentage?
14. Data protection: Techplace becomes a processor of patient name, NIF and service names — is there a data-processing agreement?

## Phases

1. **Done** — issue path, parking of what it cannot do, config UI, tests (mapper, client, service).
2. When 3 / 10 are answered: poll or webhook for the DNRE outcome (write `iud`), unpaid Fatura + receipts.
3. **Gate B** (11 answered, credit note and void work against a Techplace test entity): implement
   `credit_note`/`cancel`, then delete `dfe/`, `efatura-auth|client.service.ts`, the XSD fixtures, the
   DNRE config fields/UI, `efatura_counters`, the signed-XML columns and the `EFATURA_PROVIDER` switch.
   Until then, voiding a sale already reported through Techplace is done by hand in Techplace.
