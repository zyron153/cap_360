Plan — move e-Fatura reporting from DNRE-direct to Techplace (api.techplace.cv)
Context
CAP 360 currently reports invoices straight to DNRE's Plataforma Eletrónica: signed XAdES XML, OAuth2 PKCE, ICP-CV certificate, our own LED numbering (apps/api/src/modules/efatura, ~4 000 lines incl. tests, never run live). The clinic may instead go through Techplace, a certified CV POS/invoicing vendor that handles DNRE compliance itself. Decisions so far: Techplace replaces DNRE-direct (no permanent provider switch). We only have the public docs (no credentials). Scope is everything the current code does (issue, receipts, credit note / cancel, status). The frontend should barely change.

What the spec actually says (I read all 148 endpoints from the page's inline data):

Techplace is a multi-tenant POS backend (/api/v1, envelope {success,msg,data}, success:false can come back with HTTP 200). Auth: POST /auth gives a 24 h JWT with no refresh, or a fixed api-key header for integrations.
The ERP path is POST /fatura/sincronizador: entidadeID, utilizador, tipoFatura ("TV"/"FT"…), estadoPagamento 0|1|2, valorPagamento, metodoPagamento (one uuid), condicaoPagamento, cliente_externo, produtos[{produto_id,qttd,preco_unid}], desconto_financeiro, CODIGO_EXT. It returns faturaId, vendaCode (e.g. FTAA-123) and fatura_relacionada. Supporting routes: POST /produto/registrar (produto_servico, iva_ID, CODIGO_EXT), POST /cliente/sincronizador (NIF, DESIG, CODIGO_EXT), GET /fatura/tipo, GET /fatura/metodo/pagamento, GET /fatura/condicao/pagamento, GET /venda/id.
Missing from the spec: credit notes, cancellation/void, DNRE status, IUD, QR/PDF, webhooks. The route for later payments (/fatura/reepagar) needs a JWT and an open cash-register session. The docs also say valor_total always equals valorPagamento, which suggests an unpaid FT can't be issued through the sync route. The sync, product and customer routes are documented as unauthenticated.
So this is a gated plan (chosen): ask Techplace first, build the issue path now, and delete DNRE-direct only once Techplace covers credit notes and cancellation.

Phase 0 — Questions to Techplace (blocking, no code)
Send these to techplace.cv@gmail.com. [A] = blocks Phase 1, [B] = blocks Phase 3.

[A] Do you transmit our documents to DNRE e-Fatura as transmitter (your software code and certificate)? Whose LED and series are used? Does the clinic still need its own PE account or ICP-CV certificate?
[A] Credentials: is a test entity or sandbox (with its own base URL) available? Which auth applies to /fatura/sincronizador, /cliente/sincronizador and /produto/registrar (api-key?). Please enforce it, since the docs list those routes as unauthenticated.
[A] How do we get the DNRE outcome for a sale: IUD, authorized/rejected plus messages, and the QR/PDF the patient must receive? Is that an endpoint or a webhook (and if a webhook, how is it signed)?
[A] Idempotency: does the sync route deduplicate on CODIGO_EXT? Can we look up a sale by CODIGO_EXT?
[A] cliente_externo: is it the customer's name or their CODIGO_EXT? How is the receiver NIF passed?
[A] Products: can the sync route reference products by CODIGO_EXT (or auto-create them)? For a service product, which iva_ID and unidade_ID apply, and how is an IVA exemption with a reason code expressed?
[A] Is preco_unid tax-inclusive or tax-exclusive? (CAP prices are tax-inclusive.)
[A] Can one sale carry several payment methods on the sync route (like /fatura's pagamentos[])?
tipoFatura codes for FT, FR, TV, RC and NC.
Unpaid FT: is valor_total = valorPagamento real? How do we issue an FT and then report later payments (RC) without opening a cash-register session?
[B] Credit note (NC) referencing an issued invoice, and voiding (anulação): what are the endpoints and fields?
Rate limits, an uptime commitment, and contingency if Techplace is down for more than 24 h.
Gate A: we have answers to 1–8 and a test entity. If Techplace doesn't report to DNRE for us, stop and keep DNRE-direct.

Phase 1 — Techplace issue path (behind a temporary switch)
The billing integration stays untouched. BillingService only calls EFaturaService.reporting/enqueue/primaryFor/documents/retry/planVoid (apps/api/src/modules/billing/billing.service.ts:159-310). The queue, sweeper, claim/park/fail, efatura_submissions rows, purposes, statuses and planVoid all stay as they are. Only the "prepare + send" internals change.

Temporary switch: env EFATURA_PROVIDER=dnre|techplace (default dnre), read in EFaturaService.process(). Add // ponytail: temporary, deleted with the DNRE code in Phase 3.

New files in apps/api/src/modules/efatura/techplace/:

techplace-client.service.ts: fixed base URL from env TECHPLACE_BASE_URL (default https://api.techplace.cv; not admin-editable, which keeps the existing no-SSRF rule). It caches the JWT for 23 h and re-authenticates once on a 401, and sends api-key when configured. Error mapping follows the existing pattern in efatura-client.service.ts and reuses EFaturaError/clip from efatura.errors.ts:

network errors, 5xx and 429 → retryable
success:false → rejected with msg
other 4xx → non-retryable
Response bodies are never logged (they echo patient data). Methods: issue(), registerProduct(), syncCustomer(), lookups() (tipos, métodos, condições, for "Testar ligação").

techplace-mapper.ts: pure function from invoice + submission to the sync body. It reuses chooseDocument and toCents/fmtCents from dfe/invoice-mapper.ts and dfe/money.ts. Mapping:

document kind → tipoFatura code from config
negative (health-plan) lines → desconto_financeiro
payment method → Techplace uuid map; with several same-day methods, the largest payment wins (ponytail: ceiling, replaced if Q8 allows an array)
CODIGO_EXT = submission id
catalogue service name, never free text or notes (same privacy rule as today)
techplace-mapper.spec.ts: asserts the body for FR, TV, the discount line and the payment mapping.

Changes:

efatura.service.ts: add sendTechplace(sub, cfg):
same invoice status and go-live checks as prepareIssue
lazy product registration (one row per Service) and customer sync (name + NIF only)
POST, then store externalId/externalCode, status accepted
Ambiguous failure (timeout after POST, no dedup per Q4): don't auto-resend. Stop with non-retryable TECHPLACE_UNCERTAIN ("verifique no Techplace se a venda foi criada"); admin "Retentar" forces a resend. If Q4 says CODIGO_EXT dedups, this becomes a plain retry.
Purposes Techplace can't do yet (receipt, credit_note, cancel, and unpaid FT unless Q10 is answered) are parked as pending with code TECHPLACE_UNSUPPORTED. They never fail silently.
efatura-config.service.ts + packages/types/src/efatura.ts:
add Techplace fields: techplaceEntityId, techplaceUserId, techplaceUsername, tipoFatura codes, condicaoPagamentoId, payment-method map, fallback product id for items without a service, ivaId
secrets techplacePassword and techplaceApiKey, stored encrypted in the existing integration_efatura_secrets and write-only
computeMissing branches on the provider
efatura.controller.ts: add POST /efatura/techplace/test (admin). It authenticates and returns the tipos/métodos/condições lists so the admin can pick the codes.
Prisma migration:
EFaturaSubmission.externalId String? @unique and externalCode String? @db.VarChar(50)
Service.techplaceProductId String?, set with a conditional update so two workers can't register the same product twice
Frontend (small):
apps/web/components/settings/EFaturaSettings.tsx: a Techplace section shown when view.provider === "techplace" (credentials, entity/user, code pickers filled by "Testar ligação"), with the DNRE fields hidden
apps/web/lib/efatura.ts: docNumber() prefers externalCode; add TECHPLACE_UNSUPPORTED/TECHPLACE_UNCERTAIN to WAITING_REASON; the accepted label reads "Emitida" for Techplace until the DNRE status is known
packages/types/src/billing.ts (EFaturaSubmission) gets externalCode; FaturasTab.tsx / InvoiceDetailBody.tsx show it beside the IUD when there is no IUD
Phase 2 — Fill in from Techplace's answers
Q3 → DNRE status, IUD and QR. If it's polling, the existing sweeper (EFaturaService.sweep) polls accepted-by-Techplace rows; if it's a webhook, add one public, signature-verified endpoint. Write iud (the column already exists) when it's returned.
Q10 → unpaid FT plus receipts (receipt purpose) through whatever route Techplace offers.
Phase 3 — Gate B: credit note + cancel, then delete DNRE-direct
Implement the credit_note/cancel purposes on Techplace (Q11). planVoid already decides which one applies and is kept unchanged.
Delete:
dfe/ (dfe-xml, dfe-signer, iud, zip, dfe.types), keeping only the money and chooseDocument/buildLines helpers still used, moved next to the mapper
efatura-auth.service.ts, efatura-client.service.ts and their specs
test/fixtures/efatura-xsd/
the prepare*/send DNRE methods
the DNRE config fields (LED, série, software, transmitter, address code, OAuth, certificate)
the certificate/OAuth controller routes and settings UI
the EFATURA_PROVIDER switch
Migration: drop efatura_counters, signedXml and ledCode/serie/documentNumber/year/repositoryCode (it never ran live, so there's no fiscal data to keep; check prod first).
Docs: rewrite Docs/modules/M6a-efatura-direct-integration.md as the Techplace module doc, and update API-SPEC.md, DATABASE-SCHEMA.md, SECURITY.md (Techplace becomes a new processor of patient name + NIF + service names, so a DPA is needed; secrets handling), DEPLOYMENT.md (TECHPLACE_BASE_URL, EFATURA_PROVIDER until Phase 3), TODO.md/PROGRESS.md. Flag Docs/EFATURA_INTEGRATION.docx as obsolete. Update the memory note reference_efatura_cv_docs.md.
Verification
pnpm --filter api test:
the new mapper spec
a client spec with mocked fetch: success:false on 200 → rejected; 401 → one re-auth; 5xx/timeout handling; no body logging
efatura.service.spec.ts cases for the Techplace branch, using the existing testing/fake-db.ts: issue FR/TV, park TECHPLACE_UNSUPPORTED, TECHPLACE_UNCERTAIN then retry, never sending a cancelled invoice
existing billing specs still pass unchanged
Web: the pnpm --filter web typecheck passes; the settings card renders both providers; the invoice detail shows the Techplace number.
Live (after Gate A): on the Techplace test entity, issue one FR and one TV from the dev stack with EFATURA_PROVIDER=techplace, then confirm the sale with GET /venda/id and the DNRE outcome per Q3. The docs playground only simulates POSTs, so it can't be used to check writes.