# PROGRESS

> Snapshot overwritten each session. Última atualização: 2026-09-18.
> Detalhe completo em [REVIEW.md](REVIEW.md) e [TODO.md](TODO.md).

## Done

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

- **Financeiro — filtragem de datas por fronteira UTC vs. fuso horário local.** Achado numa sessão
  anterior: endpoints de intervalo de datas (`/financeiro/summary` e afins) comparam `to`/`from`
  diretamente contra timestamps UTC guardados na BD, mas a UI deriva "hoje"/"este mês" do relógio
  local do browser. Para Cabo Verde (UTC-1), a última hora local de cada dia cai já no dia seguinte
  em UTC, pelo que entradas/pagamentos registados nessa janela podem ficar fora do período
  esperado. Precisa de decidir se a correção é ao nível do fuso da clínica (config) ou normalizar
  sempre para o fuso de Cabo Verde nos endpoints de relatório.
- M4: self-service portal para `corporate_hr` gerir membros/relatórios de utilização (§4/§5 do
  módulo) — a membership existe, mas só é gerível via UI/API de admin/receptionist hoje. Renovação
  automática/agendada continua fora por decisão (ver `modules/M4-health-plan-management.md` §3.4).
- REVIEW.md Secção 6 (sugestões de redesign) — exercício de design, **não** é tarefa de
  implementação.
- Trabalho de feature/infra em `TODO.md`: M3 WhatsApp, M5 Exames, M9 Visitas, Fase 4, k8s,
  backups, testes k6/ZAP — cada um precisa da sua própria conversa de scoping.
