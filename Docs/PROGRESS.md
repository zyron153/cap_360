# PROGRESS

> Snapshot overwritten each session. Última atualização: 2026-09-18.
> Detalhe completo em [REVIEW.md](REVIEW.md) e [TODO.md](TODO.md).

## Done

- **Financeiro/Analytics/Billing/Appointments — filtragem de datas por fronteira UTC vs. fuso
  horário local.** Endpoints de intervalo de datas (`from`/`to` como `"YYYY-MM-DD"`, derivados do
  relógio local do browser) comparavam esses limites contra timestamps UTC sem ajuste de fuso —
  `new Date(from)` e `` new Date(`${to}T23:59:59Z`) ``. Para Cabo Verde (UTC-1, sem DST), a última
  hora local de cada dia (23:00–23:59 CVT) já é o dia seguinte em UTC, pelo que registos dessa
  janela ficavam fora do período pedido (ou apareciam no dia errado, no caso do calendário de
  consultas). Corrigido com um novo helper `cvDayStart`/`cvDayEnd` (`apps/api/src/common/
  cabo-verde-time.ts`) que converte o dia local para o instante UTC correto via um offset `-01:00`
  explícito na string ISO — não depende do fuso horário do SO do servidor. Aplicado aos 4 pontos
  reais que tinham o bug: `financeiro.service.ts` (`dateRange` usado por despesas/entradas/faturas
  pagas, e `getSummary`), `analytics.service.ts#getSummary`, `billing.service.ts#findAll`, e
  `appointments.service.ts#findCalendar`.
  - Verificação: `tsc --noEmit` limpo em `api`; novo `cabo-verde-time.spec.ts` (3 testes, incl. um
    timestamp na última hora local do dia caindo dentro do intervalo esperado); suites afetadas
    (`financeiro`, `analytics`, `billing`, `appointments` service specs — 159 testes) continuam
    verdes sem alterações.

- **M6 — coluna "Em dívida desde" (tab Saldos em Aberto) usava a data errada.** Pedido do
  utilizador: a coluna deve refletir a data da consulta, não a data de registo do paciente. A
  implementação já não usava a data de registo — usava `Invoice.dueDate` (prazo de pagamento,
  frequentemente `null` em rascunhos), o que também não é "desde quando o paciente deve". Corrigido
  para usar a data da consulta ligada à fatura (`Appointment.scheduledAt`, via
  `outstandingInvoicesDetailed()` em `financeiro.repository.ts`, consumido em
  `financeiro.service.ts#listOutstandingBalances`). Campo `oldestDueDate` na resposta da API mantém
  o nome (evita mexer em tipos partilhados/frontend), mas passa a ser "data da consulta mais antiga
  com saldo em aberto".
  - Verificação: `tsc --noEmit` limpo em `api`; teste afetado em `financeiro.service.spec.ts`
    atualizado com o novo campo `appointment.scheduledAt` no mock.
  - Docs atualizados: `modules/M6-billing-invoicing.md` (v1.9), `API-SPEC.md`.

## Em curso

- (nada)

## Bloqueado

- MFA retroativo — precisa de um realm Keycloak real (só existe dev local).
- M1 canal de lembrete (SMS/email) — precisa de infra de envio de SMS que não existe.

## Próximo

- M4: self-service portal para `corporate_hr` gerir membros/relatórios de utilização (§4/§5 do
  módulo) — a membership existe, mas só é gerível via UI/API de admin/receptionist hoje. Renovação
  automática/agendada continua fora por decisão (ver `modules/M4-health-plan-management.md` §3.4).
- REVIEW.md Secção 6 (sugestões de redesign) — exercício de design, **não** é tarefa de
  implementação.
- Trabalho de feature/infra em `TODO.md`: M3 WhatsApp, M5 Exames, M9 Visitas, Fase 4, k8s,
  backups, testes k6/ZAP — cada um precisa da sua própria conversa de scoping.
