# PROGRESS

> Snapshot overwritten each session. Última atualização: 2026-09-12.
> Detalhe completo em [REVIEW.md](REVIEW.md) e [TODO.md](TODO.md).

## Done

- Agendamento → Faturação: ao marcar uma Consulta como **Concluída**, a receção/médico confirma
  agora a duração real (pré-preenchida com a duração agendada, com pré-visualização do valor) antes
  do rascunho de fatura ser gerado. O preço desse rascunho passa a ser proporcional à duração-padrão
  do serviço (`(duraçãoReal / service.durationMinutes) * service.price`) em vez de sempre o preço
  fixo do catálogo — sem duração-padrão conhecida, mantém o comportamento antigo (preço fixo). A
  duração confirmada é guardada em `Appointment.durationMinutes`; não existe campo de duração na
  fatura/item em si.
  - Novo endpoint `PATCH /invoices/:id/items/:itemId`: enquanto a fatura estiver em `draft`,
    qualquer item passa a ter quantidade/preço editáveis; o item gerado a partir do agendamento
    mostra em vez disso um campo de duração, que recalcula o preço da mesma forma. Uma edição manual
    de preço num item de catálogo continua sujeita à mesma regra admin-only / motivo obrigatório
    (undercut) que já existia em `POST /invoices` — não é um atalho para a contornar.
  - Ficheiros principais: `appointments.service.ts` (`updateStatus`), `billing.service.ts`
    (`updateItem`), `billing.repository.ts` (`updateItemAtomic`), `billing.controller.ts`;
    `appointments/page.tsx` (diálogo de confirmação de duração) e `InvoiceDetailBody.tsx` (linhas
    de item editáveis). Sem migração de schema — a duração vive só em `Appointment`.
  - Docs atualizados: `Docs/API-SPEC.md`, `Docs/modules/M1-smart-appointment-engine.md` (v1.2),
    `Docs/modules/M6-billing-invoicing.md` (v1.6 — também corrige uma imprecisão antiga do
    documento, que descrevia o rascunho automático como sendo gerado "no check-in" quando o código
    sempre o gerou na conclusão da consulta).
  - Testes: 5 novos em `appointments.service.spec.ts`/`billing.service.spec.ts`/
    `billing.repository.spec.ts`; 102 + 13 testes a passar nos respetivos módulos; typecheck limpo
    em `apps/api` e `apps/web`.

## Em curso

- (nada)

## Bloqueado

- MFA retroativo — precisa de um realm Keycloak real (só existe dev local).
- M1 canal de lembrete (SMS/email) — precisa de infra de envio de SMS que não existe.

## Próximo

- Opções levantadas na análise do M6 (sessões anteriores), ainda por escolher/agendar:
  - Health-plan co-pay/utilização — `health_plan` continua a ser só um valor de enum em
    `PaymentMethod`; nada calcula desconto nem incrementa `HealthPlan.usageCount`.
  - Ecrã de "outstanding balances" por paciente/fatura.
  - Cobertura e2e do Financeiro (fatura → pagamento → recibo, aprovação de despesa).
- REVIEW.md Secção 6 (sugestões de redesign) — exercício de design, **não** é tarefa de
  implementação.
- Trabalho de feature/infra em `TODO.md`: M3 WhatsApp, M5 Exames, M9 Visitas, M10 Analytics,
  Fase 4, k8s, backups, testes k6/ZAP — cada um precisa da sua própria conversa de scoping.
- A lista de correções do REVIEW.md (Secções 1–5) está **fechada** — nada acionável resta, para
  além das opções do M6 listadas acima.
