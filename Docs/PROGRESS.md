# PROGRESS

> Snapshot overwritten each session. Última atualização: 2026-09-11.
> Detalhe completo em [REVIEW.md](REVIEW.md) e [TODO.md](TODO.md).

## Done

- M6 Financeiro — passe de correções direcionado (análise do módulo pedida pelo utilizador,
  seguida da via "quick correctness fixes"):
  - Atribuição de pagamento a funcionário: `Payment.recordedById` (FK `Staff`), preenchido a
    partir do utilizador autenticado em `POST /invoices/:id/payments`; mostrado no histórico de
    pagamentos da fatura ("registado por …").
  - Cancelamento de fatura agora exige motivo (`CancelInvoiceSchema`, mín. 3 caracteres,
    `Invoice.cancelReason`/`cancelledAt`) e grava um diff semântico antes/depois no `audit_log`
    (mesmo mecanismo do §1.4), em vez de só o registo genérico "houve um POST".
  - **Gap encontrado durante a implementação:** não existia nenhuma UI de cancelamento de fatura
    no frontend, apesar do endpoint já existir e o REVIEW.md §6 afirmar o contrário. Adicionado
    botão "Cancelar Fatura" na página de detalhe, com a confirmação em dois passos já padrão na
    app + campo de motivo obrigatório, e um banner na fatura cancelada.
  - 7 testes novos/atualizados (`billing.service.spec.ts` +5, `billing.repository.spec.ts` +2),
    389/389 testes API a passar, typecheck + lint limpos em `apps/api` e `apps/web`.
- Correções de documentação (drift encontrado durante a análise, não código):
  - REVIEW.md §1.3 (price floor) já estava corrigido numa sessão anterior — as 3 referências que
    ainda o descreviam como "em aberto" (linhas do sumário + M6 module doc) foram corrigidas.
  - REVIEW.md §2.4 / M6 module doc (recibo PDF desatualizado após pagamento parcial) também já
    estava corrigido — `recordPaymentAtomic` já limpa `pdfR2Key` a cada pagamento; texto corrigido.
  - `TODO.md` "New invoice form" estava marcado como em falta — `billing/new/page.tsx` já existe
    e é real (não mockup); corrigido.
- REVIEW.md Secções 1–3 — findings críticos, privacidade/compliance, e o passe de bug-fix
  M1/M2/M6/M8 — todos fechados em sessões anteriores.
- REVIEW.md §4.1 — componente `Field` partilhado (`apps/web/components/ui/field.tsx`), 10 cópias
  locais removidas.
- REVIEW.md §4.2 — hook `useDebouncedValue`; pesquisa de pacientes com debounce.
- REVIEW.md §4.3 — `ZodValidationPipe` global (no-op) removido do `main.ts`; `schema` agora
  obrigatório.
- REVIEW.md §4.4 — todos os `console.*` em `apps/api/src` passaram a `Logger` do NestJS.
- REVIEW.md §4.5 — specs de serviço para `services`, `companies`, `parametrizacao`, `public`;
  **todos os módulos da API têm agora spec**.
- REVIEW.md §5.1 — validação de formulários: schemas partilhados `dateOfBirthSchema` (sem datas
  futuras), `nifSchema` (9 dígitos), `caboVerdePhoneSchema` (regra única partilhada com o
  servidor); `max={hoje}` + hints nos 3 formulários de paciente.
- `Docs/CLAUDE.md` + `Docs/PROGRESS.md` criados.

## Em curso

- (nada)

## Bloqueado

- MFA retroativo — precisa de um realm Keycloak real (só existe dev local).
- M1 canal de lembrete (SMS/email) — precisa de infra de envio de SMS que não existe.

## Próximo

Opções levantadas na análise do M6 desta sessão, ainda por escolher/agendar:
- Health-plan co-pay/utilização — `health_plan` continua a ser só um valor de enum em
  `PaymentMethod`; nada calcula desconto nem incrementa `HealthPlan.usageCount`. Maior gap de
  correção monetária real ainda aberto no módulo.
- Ecrã de "outstanding balances" por paciente/fatura — hoje só existe o total agregado no
  Overview do Financeiro.
- Cobertura e2e do Financeiro (fatura → pagamento → recibo, aprovação de despesa) — zero specs
  e2e cobrem este módulo apesar de ser o código financeiro mais novo e complexo da app.

- REVIEW.md Secção 6 (sugestões de redesign) — exercício de design, **não** é tarefa de
  implementação.
- Trabalho de feature/infra em `TODO.md`: M3 WhatsApp, M5 Exames, M9 Visitas, M10 Analytics,
  Fase 4, k8s, backups, testes k6/ZAP — cada um precisa da sua própria conversa de scoping.
- A lista de correções do REVIEW.md (Secções 1–5) está **fechada** — nada acionável resta, para
  além das opções do M6 listadas acima.
