# PROGRESS

> Snapshot overwritten each session. Última atualização: 2026-09-12.
> Detalhe completo em [REVIEW.md](REVIEW.md) e [TODO.md](TODO.md).

## Done

- Ecrã de "Saldos em Aberto" (a última opção pendente na lista do M6): dois endpoints novos —
  `GET /financeiro/saldos` (todos os pacientes com saldo em aberto, agregado por paciente a partir
  das mesmas faturas `issued`/`partially_paid`/`overdue` que `receivables` do Resumo já usava,
  ordenado por valor devido) e `GET /financeiro/saldos/:patientId` (o mesmo, para um único
  paciente, com a lista de faturas por trás do total). Dois pontos de UI, como decidido: separador
  novo **Saldos em Aberto** no Financeiro (`SaldosTab.tsx`) e um painel **Saldo em Aberto** no
  perfil do paciente (`PatientBalancePanel.tsx`, com link direto para cada fatura em dívida).
  Descoberta ao explorar: a tab Faturas já mostrava "Em Dívida" por fatura com filtros de estado —
  a lacuna real era só a vista agregada por paciente, não uma vista por fatura (essa já existia).
  6 testes novos em `financeiro.service.spec.ts` (35 no total do módulo, 427 no total da API).
  Verificado ao vivo no browser (Playwright, dados reais do dev DB) antes de reportar concluído.
  `Docs/API-SPEC.md` e `Docs/TESTING.md` (v1.6) atualizados.

- Health-plan co-pay: `BillingService` agora aplica automaticamente o desconto do plano de saúde
  ativo do paciente ao criar uma fatura (manual ou o rascunho automático gerado na conclusão da
  consulta). `HealthPlansService.getActiveCoverage(patientId)` (novo) valida plano+produto ativos,
  `endDate` não expirada, e `coverageRules.coverage` > 0 (capado a 100%); quando aplicável,
  `BillingService.applyHealthPlanDiscount` acrescenta uma linha negativa "Desconto Plano de Saúde
  (N%) — {produto}" ao subtotal, mantendo os itens de catálogo intactos para auditoria, e liga a
  fatura ao `healthPlanId` do plano (a menos que um tenha sido explicitamente indicado). Também
  corrigido de caminho: `InvoiceDetailBody.tsx` identificava "o item gerado pelo agendamento" por
  `invoice.items.length === 1`, o que deixaria de funcionar assim que uma segunda linha (o
  desconto) coexistisse no mesmo rascunho — passa a comparar `item.serviceId` com
  `invoice.appointment.serviceId` (campo novo, exposto por `BillingRepository.findById`). Resolve o
  item "Health-plan co-pay/utilização" que estava listado em Próximo. Não cobre
  `HealthPlan.usageCount` (já incrementado antes, via `AppointmentsService`) nem e2e da própria
  percentagem — só unitário (`billing.service.spec.ts` + `health-plans.service.spec.ts`, 14 testes
  novos). `Docs/TESTING.md` (v1.5) atualizado.

- Faturas Pagas listadas como Entrada no Financeiro: novo endpoint `GET
  /financeiro/entradas/faturas` projeta os `Payment` de faturas pagas no mesmo formato de uma
  Entrada (descrição, categoria = serviço faturado, valor, data, tipo de pagador) sem criar
  registos `Income` novos — são sempre derivados do `Payment` existente. O separador Entradas
  (`EntradasTab.tsx`) ganhou um sub-separador "Faturas Pagas" (lista só-leitura, paginada,
  separada das Entradas Manuais) ao lado do já existente; os totais/gráficos do Resumo já incluíam
  pagamentos de faturas antes desta sessão (`getSummary()`), não precisaram de alteração. A página
  `/analytics` (M10, até agora 100% mock) teve o KPI "Receita YTD" e o gráfico "Receita Mensal"
  ligados aos mesmos dados reais do Resumo — o resto da página (consultas, pacientes, horários de
  pico, distribuição por plano) continua mock, fora do âmbito desta sessão. 4 testes novos em
  `financeiro.service.spec.ts` (29 no total do módulo).

- Cobertura e2e do Financeiro (uma das opções em aberto listadas na sessão anterior): 2 specs
  Playwright novas, `apps/web/e2e/manual-invoice-payment.spec.ts` (criação manual de fatura via
  `/billing/new` → pagamento em duas parcelas, parcial→`partially_paid`→total→`paid` → botão
  "Recibo PDF") e `apps/web/e2e/expense-approval.spec.ts` (registo de despesa → aprovação admin no
  separador Despesas). Nenhum dos dois fluxos tinha cobertura e2e antes.
  - **Bug real encontrado e corrigido ao escrever o teste**: `/billing/new` enviava `unitPrice`
    como string para `POST /invoices` — `GET /services` devolve `price` como string (Prisma
    Decimal serializado em JSON), e o formulário nunca convertia para número antes de submeter.
    Toda a criação manual de fatura falhava com `400` (`Expected number, received string`); o
    formulário estava completamente quebrado antes desta sessão. Corrigido em
    `apps/web/app/(app)/billing/new/page.tsx` (`pickService` agora faz `Number(svc.price)`).
  - Mais 2 specs, ainda na mesma sessão, fechando as lacunas restantes: `invoice-cancellation.spec.ts`
    (cancelar fatura `issued` → "Cancelada", motivo obrigatório min. 3 caracteres, botões
    Cancelar/Registar Pagamento desaparecem; painel E-Factura numa fatura recém-emitida fica em
    "Pendente" — não há `integration_efatura` configurado neste ambiente dev, único estado
    determinístico de E-Factura testável sem endpoint sandbox real) e `health-plan-payment.spec.ts`
    (pagamento com método "Plano de Saúde" — só o comportamento já existente do enum
    `PaymentMethod`; **não** cobre cálculo de co-pay/desconto nem `HealthPlan.usageCount`, que
    continuam por implementar).
  - Suite Playwright sobe de 3 → 7 specs, 9 → 15 testes. `Docs/TESTING.md` (v1.4) atualizado com
    os números e descrições novas; também corrigida uma nota antiga (§5.1) que dizia
    `staff-invitation` só ter cobertura via integration spec — o spec e2e real já existe e usa o
    `token` devolvido diretamente por `POST /staff/invite`.
  - **Incidente operacional durante a sessão**: os novos specs falhavam de forma intermitente
    (timeout de 30s no `beforeAll` a criar um paciente via Playwright, embora `curl` ao mesmo
    endpoint respondesse instantaneamente). Causa: havia dois processos da API a correr em
    simultâneo — o `nest start --watch` normal do `pnpm dev` e um `node apps/api/dist/main`
    (modo produção) avulso de uma sessão anterior, a disputar a mesma porta. Terminei o processo
    avulso com autorização do utilizador; acabou por ser esse que estava mesmo a servir pedidos, o
    que derrubou a API por completo. O utilizador reiniciou o `pnpm dev` manualmente e a suite
    voltou a passar de forma estável (15/15, exceto o `checkin-payment.spec.ts` pré-existente —
    ver nota abaixo). Lição registada em `Docs/TESTING.md` §5.1: nunca correr `pnpm --filter
    @cap/api start` (build) ao mesmo tempo que `pnpm dev`.
  - Nota: `checkin-payment.spec.ts` (pré-existente) falha isoladamente neste ambiente ao clicar
    "Concluída" no modal — confirmado como pré-existente (reproduz sem as alterações desta
    sessão), não investigado a fundo; fica como possível item para a próxima sessão.

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
  - ~~Health-plan co-pay/utilização~~ — feita nesta sessão (ver Done acima): desconto de cobertura
    aplicado automaticamente; `usageCount` já era incrementado antes.
  - ~~Ecrã de "outstanding balances" por paciente/fatura~~ — feita nesta sessão (ver Done acima):
    "por fatura" já existia (tab Faturas); "por paciente" era a lacuna real, agora coberta.
  - ~~Cobertura e2e do Financeiro~~ — feita nesta sessão (ver Done acima), incluindo o
    cancelamento de fatura e o pagamento via health-plan. E-Factura só coberta no estado
    "Pendente" (sem config sandbox neste ambiente, não dá para testar submissão/aceitação real).
  - **Todas as opções desta lista do M6 estão agora fechadas.**
- REVIEW.md Secção 6 (sugestões de redesign) — exercício de design, **não** é tarefa de
  implementação.
- Trabalho de feature/infra em `TODO.md`: M3 WhatsApp, M5 Exames, M9 Visitas, M10 Analytics,
  Fase 4, k8s, backups, testes k6/ZAP — cada um precisa da sua própria conversa de scoping.
- A lista de correções do REVIEW.md (Secções 1–5) está **fechada** — nada acionável resta, para
  além das opções do M6 listadas acima.
