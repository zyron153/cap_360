# PROGRESS

> Snapshot overwritten each session. Última atualização: 2026-09-11.
> Detalhe completo em [REVIEW.md](REVIEW.md) e [TODO.md](TODO.md).

## Done

- Agendamentos — botão "Faltou" nos detalhes da marcação:
  - Pedido pontual do utilizador (fora do backlog do REVIEW.md), não uma correção de finding.
  - `TRANSITIONS["confirmed"]` (`apps/web/app/(app)/appointments/page.tsx`) passou a incluir a
    transição para `no_show`, ao lado de "Check-in feito" e "Cancelar" — reaproveita o mecanismo
    de config já existente que decide quais botões de ação aparecem no modal de detalhe, por
    estado atual da marcação (chave = `detail.status`), em vez de um `if` ad-hoc no JSX.
  - Efeito: o botão só é visível quando o estado é exatamente `confirmed` ("Confirmado"); clique
    chama `statusMutation` diretamente (mesmo padrão dos outros botões, sem diálogo de confirmação
    extra) e faz `PATCH /appointments/:id/status`.
  - Verificado que a API (`appointments.service.ts`) não tem máquina de estados a restringir
    transições — qualquer valor do enum é aceite — pelo que não foi necessária alteração de backend.
  - `no_show` a partir de `checked_in` (fluxo pré-existente) mantém-se inalterado.

## Em curso

- (nada)

## Bloqueado

- MFA retroativo — precisa de um realm Keycloak real (só existe dev local).
- M1 canal de lembrete (SMS/email) — precisa de infra de envio de SMS que não existe.

## Próximo

- Opções levantadas na análise do M6 (sessão anterior), ainda por escolher/agendar:
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
