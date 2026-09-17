# PROGRESS

> Snapshot overwritten each session. Última atualização: 2026-09-17.
> Detalhe completo em [REVIEW.md](REVIEW.md) e [TODO.md](TODO.md).

## Done

- **M6 — Saldos em Aberto/Contas a Receber ignoravam faturas em rascunho.** Pedido via Sherlock
  me: depois de gerada, uma fatura deve aparecer em Saldos em Aberto como entrada pendente. As três
  queries de "outstanding" (`FinanceiroRepository.outstandingInvoices` /
  `outstandingInvoicesDetailed` / `outstandingInvoicesForPatient`) só contavam
  `issued`/`partially_paid`/`overdue` — uma fatura `draft` (o rascunho automático de conclusão de
  consulta, ou uma manual ainda não emitida) não aparecia em lado nenhum como dívida do paciente até
  ser emitida, o que agora (desde a correção da sessão anterior) só acontece no primeiro pagamento —
  ou seja, ia diretamente de invisível a paga, sem estado "pendente" no meio. Corrigido: `draft`
  passa a contar como saldo em aberto nas três queries, refletido tanto no cartão "Contas a Receber"
  do Overview como na tab/lista Saldos em Aberto e no painel de saldo do paciente. Adicionada
  etiqueta "Rascunho" ao mapa de status do painel de paciente (`PatientBalancePanel.tsx`), que antes
  mostraria a palavra em inglês "draft" sem tradução para este novo caso.
  - Verificação (âmbito escolhido pelo utilizador: código + testes, sem browser): 35 testes de
    `financeiro.service.spec.ts` continuam a passar (mockam a chamada ao repositório, não são
    afetados pelo filtro); `tsc --noEmit` limpo em `api`/`web`; verificação ao vivo via `curl`
    contra a API real — fatura `draft` existente (`INV-2026-0085`) passou a aparecer em
    `GET /financeiro/saldos/:patientId` e no total agregado de `GET /financeiro/saldos`, e o
    `receivables.totalOutstanding` do `GET /financeiro/summary` subiu para refletir isso; confirmado
    que `overdueCount` não é afetado (rascunhos não têm `dueDate`, nunca contam como vencidos).
  - Docs atualizados: `modules/M6-billing-invoicing.md` (v1.8, §2.5 também corrigida — já existia
    lista dedicada Saldos em Aberto, a nota antiga a dizer que não existia estava desatualizada),
    `API-SPEC.md`, `DATABASE-SCHEMA.md` §6.1.

- **Ambiente de dev — múltiplos processos `nest start`/`nest --watch` órfãos a corromper a mesma
  `dist/`.** Durante a verificação acima, descobri (via `Get-CimInstance Win32_Process`, não pelo
  PID que o Bash tool reporta — esse é só o wrapper, não o processo real no Windows) **seis**
  processos de API concorrentes acumulados de sessões anteriores (dois `nest start --watch`, um
  `nest start`, três `dist/main` a correr diretamente), todos a apagar/reescrever a mesma pasta
  `dist/` (`deleteOutDir: true` no `nest-cli.json`) e a competir pela porta 4000 — a causa provável
  do erro "Internal S... is not valid JSON" que o utilizador viu ao testar o fluxo da sessão
  anterior (um 500 em texto simples, não em JSON, típico de um proxy dev a falhar a meio de um
  restart). Todos morto e reiniciado como uma única árvore limpa via `pnpm dev` (turbo) na raiz do
  repo. Lição para sessões futuras: `taskkill /T` num PID do Bash tool não garante matar a árvore
  real no Windows — confirmar sempre via `Get-CimInstance`/`netstat` antes de assumir que está limpo.

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
