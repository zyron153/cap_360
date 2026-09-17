# PROGRESS

> Snapshot overwritten each session. Última atualização: 2026-09-16.
> Detalhe completo em [REVIEW.md](REVIEW.md) e [TODO.md](TODO.md).

## Done

- **M1/M6 — auditoria e correção do fluxo Consulta Concluída → Fatura → Pagamento →
  Financeiro (entrada).** Pedido via Sherlock me: analisar o fluxo completo e corrigir bugs
  encontrados. Quatro problemas reais identificados e corrigidos:
  - **Faturas duplicadas.** `AppointmentsService.updateStatus` não validava a transição de
    estado — qualquer estado podia mudar para qualquer outro, sem verificação nenhuma. Um pedido
    `PATCH .../status` repetido/duplicado (retry de rede, duplo clique, múltiplos separadores) para
    "completed" numa consulta já concluída voltava a correr `createDraft()` e
    `recordSessionUsage()`, criando uma segunda fatura rascunho para a mesma consulta e a contar
    utilização de plano de saúde a dobrar. Corrigido com uma máquina de estados real no backend
    (`pending → confirmed/cancelled`, `confirmed → checked_in/completed/no_show/cancelled`,
    `checked_in → completed/no_show/cancelled`; `completed`/`cancelled`/`no_show` terminais) e,
    como rede de segurança ao nível da BD, `invoices.appointmentId` passou a `UNIQUE` (aplicado via
    `prisma db push --accept-data-loss`, confirmado sem duplicados existentes antes de aplicar).
  - **Falha silenciosa na fatura automática.** Se `createDraft()` falhasse (erro de BD, etc.), a
    consulta ficava concluída na mesma e a UI mostrava um toast de sucesso genérico, sem indicar
    que a fatura nunca foi criada. Agora a resposta do `PATCH .../status` inclui `invoiceWarning`
    quando isso acontece, a UI mostra um toast de aviso em vez de sucesso, e foi adicionado um novo
    endpoint `POST /appointments/:id/invoice` + botão "Gerar Fatura" na ficha da consulta para
    gerar a fatura manualmente depois — seguro para clicar mais do que uma vez, graças à mesma
    constraint `UNIQUE`.
  - **Faturas automáticas nunca emitidas/submetidas à E-Fatura.** Ao contrário de `POST
    /invoices` (que emite e submete à E-Fatura de imediato), `BillingService.createDraft()` nunca
    criava um `EFaturaSubmission` nem definia `issuedAt` — e como `POST /invoices/:id/payments`
    permite pagar uma fatura ainda em rascunho, uma fatura de conclusão de consulta paga
    imediatamente passava de `draft` a `paid` sem nunca ser submetida à autoridade tributária, e a
    coluna "Data" ficava sempre em branco. Corrigido: o primeiro pagamento de uma fatura `draft`
    agora regista `issuedAt` e cria/enfileira o `EFaturaSubmission`, tal como uma fatura criada
    manualmente.
  - **KPI "Receita Cobrada" subcontava.** `GET /bff/billing-summary` somava
    `Invoice.amountPaid` filtrado por `status = 'paid' AND createdAt` do mês — o que ignora faturas
    `partially_paid` e faturas criadas num mês mas pagas noutro (o caso comum do fluxo de
    auto-fatura de consultas). Corrigido para somar `Payment.amount` filtrado por `Payment.paidAt`.
  - Verificação: 133 testes de backend (`appointments`, `billing`, `bff`) a passar, incluindo
    testes novos para a máquina de estados e para `retryInvoice`; `tsc --noEmit` limpo em `api` e
    `web`; fluxo confirmado ao vivo num browser real (Playwright) — consulta levada a Concluída →
    fatura rascunho criada → segunda tentativa de conclusão rejeitada com 400 sem duplicar a fatura
    → pagamento registado → fatura aparece em Financeiro → Entradas → Faturas Pagas → submissão
    E-Fatura criada.
  - Achado à parte, **não corrigido** (fora do âmbito pedido): o resumo do Financeiro filtra
    intervalos de data por fronteiras UTC enquanto a UI escolhe "hoje" pelo relógio local do
    browser — uma entrada registada na última hora local do dia em Cabo Verde pode ficar de fora
    dos totais "este mês" até a data virar em UTC. Ver "Próximo" abaixo.
  - Docs atualizados: `modules/M1-smart-appointment-engine.md` (v1.3), `modules/M6-billing-
    invoicing.md` (v1.7), `API-SPEC.md`, `DATABASE-SCHEMA.md` §6.1.

## Em curso

- (nada)

## Bloqueado

- MFA retroativo — precisa de um realm Keycloak real (só existe dev local).
- M1 canal de lembrete (SMS/email) — precisa de infra de envio de SMS que não existe.

## Próximo

- **Financeiro — filtragem de datas por fronteira UTC vs. fuso horário local.** Achado nesta
  sessão (ver acima): endpoints de intervalo de datas (`/financeiro/summary` e afins) comparam
  `to`/`from` diretamente contra timestamps UTC guardados na BD, mas a UI deriva "hoje"/"este mês"
  do relógio local do browser. Para Cabo Verde (UTC-1), a última hora local de cada dia cai já no
  dia seguinte em UTC, pelo que entradas/pagamentos registados nessa janela podem ficar fora do
  período esperado. Precisa de decidir se a correção é ao nível do fuso da clínica (config) ou
  normalizar sempre para o fuso de Cabo Verde nos endpoints de relatório.
- M4: self-service portal para `corporate_hr` gerir membros/relatórios de utilização (§4/§5 do
  módulo) — a membership existe, mas só é gerível via UI/API de admin/receptionist hoje. Renovação
  automática/agendada continua fora por decisão (ver `modules/M4-health-plan-management.md` §3.4).
- REVIEW.md Secção 6 (sugestões de redesign) — exercício de design, **não** é tarefa de
  implementação.
- Trabalho de feature/infra em `TODO.md`: M3 WhatsApp, M5 Exames, M9 Visitas, Fase 4, k8s,
  backups, testes k6/ZAP — cada um precisa da sua própria conversa de scoping.
