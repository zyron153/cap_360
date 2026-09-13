# PROGRESS

> Snapshot overwritten each session. Última atualização: 2026-09-12.
> Detalhe completo em [REVIEW.md](REVIEW.md) e [TODO.md](TODO.md).

## Done

- **M4 Health Plan Management — renovação manual + páginas dedicadas de lista/detalhe.** Decisão de
  âmbito tomada com o utilizador antes de implementar (via Sherlock me): dos itens ainda por fazer
  no TODO.md, ficaram para esta sessão a renovação (**endpoint manual**, não um job automático) e as
  páginas dedicadas; o roster de membros (`POST /health-plans/:id/members`) ficou explicitamente
  fora de âmbito.
  - `POST /health-plans/:id/renew` (admin, receptionist) — estende `endDate` pelo novo campo
    `HealthPlanProduct.durationMonths` (1/3/6/12 meses, `@default(1)` para não quebrar produtos já
    existentes), a partir do que for mais tarde entre o `endDate` atual do plano e hoje, e reativa
    um plano caducado (`active: false → true`). `400` se o produto já estiver desativado. Diff de
    auditoria antes/depois via `RequestContext.setAuditDiff`, mesmo mecanismo do `cancel()` de
    faturas.
  - `GET /health-plans` e `GET /health-plans/:id` passam a incluir `holderPatientName` (lookup
    batched, `HealthPlansRepository.findPatientNamesByIds`) quando o plano tem titular — necessário
    para a lista mostrar quem é o titular sem N+1 queries; nunca aparece num plano sem titular.
  - Frontend: `/health-plans` passou a ter tabs (**Produtos**, a página anterior, inalterada;
    **Planos**, nova — todas as instâncias, pesquisa + filtro por estado [Ativo/A Expirar/
    Expirado/Inativo, calculado no cliente a partir de `active`+`endDate`], ação rápida "Renovar")
    e uma nova `/health-plans/[id]` (mesmo padrão de `billing/[id]`/`InvoiceDetailBody` — wrapper
    fino + corpo partilhado) com a mesma ação de renovação. Ação "Renovar" também adicionada ao
    `PlanModal` do perfil do paciente, e o badge de plano no perfil passou a ligar para a nova
    página de detalhe — as páginas novas ficam alcançáveis a partir de todas as superfícies
    existentes de gestão de planos, não só pela sidebar.
  - **Bug de produção encontrado e corrigido**: `HealthPlansRepository.nextPlanNumber`'s
    `pg_advisory_xact_lock(${NAMESPACE}, ${year})` (sem cast explícito) dá 42883 contra Postgres
    real — o driver do Prisma faz bind de números simples como `bigint`, e não existe overload de
    dois argumentos `bigint` (só a versão de um argumento `bigint`, ou a de dois argumentos `int`).
    Isto significa que **qualquer** criação de plano sem `planNumber` fornecido pelo cliente estava
    partida em produção — invisível porque a suite unitária mocka o repositório por completo.
    Corrigido com `::int` explícito em ambos os argumentos. Só foi apanhado porque este é o
    primeiro teste de integração a exercitar `createPlan()` sem `planNumber` contra uma BD real.
  - **Segundo bug encontrado, mais grave**: toda a suite de testes de integração estava partida —
    `test/integration/setup.ts` ainda chamava `app.useGlobalPipes(new ZodValidationPipe())` sem
    schema, um resquício de antes da correção da REVIEW.md §4.3 que tornou o argumento `schema`
    obrigatório (o `main.ts` real já tinha sido atualizado na altura; este ficheiro de teste não).
    O construtor passou a rebentar, falhando todos os specs de integração antes de correr um único
    teste — nenhum tinha corrido com sucesso desde essa correção. Removida a linha morta, igual ao
    `main.ts`.
  - Testes: 442 testes unitários (27 suites, +15 face aos 427 anteriores — 5 de `renew`, 3 de
    enriquecimento com `holderPatientName`, 7 pré-existentes do módulo revalidados), novo
    `health-plan-renewal.integration-spec.ts` (3 testes — agora 5 specs / 13 testes de integração,
    todos a passar depois da correção do `setup.ts` acima), novo `health-plan-renewal.spec.ts` e2e
    (2 testes — agora 8 specs / 17 testes e2e). Tudo verificado ao vivo contra a dev DB e no browser
    (Playwright), incluindo o próprio fluxo de renovação a mudar o badge de estado em tempo real.
  - Docs atualizados: `TODO.md` (M4, secção Testing), `modules/M4-health-plan-management.md`
    (v1.2), `API-SPEC.md` §4, `DATABASE-SCHEMA.md` §4.2/4.3, `FRONTEND-ROUTES.md`.

## Em curso

- (nada)

## Bloqueado

- MFA retroativo — precisa de um realm Keycloak real (só existe dev local).
- M1 canal de lembrete (SMS/email) — precisa de infra de envio de SMS que não existe.

## Próximo

- M4: roster de membros (`POST /health-plans/:id/members`) — precisa de uma tabela de membership
  nova (`HealthPlan` só liga a um titular via FK direta hoje); ficou fora de âmbito nesta sessão por
  decisão explícita. Renovação automática/agendada também ficou de fora por decisão (ver
  `modules/M4-health-plan-management.md` §3.4) — só faz sentido revisitar se o negócio quiser
  opt-in de renovação automática por plano/produto.
- REVIEW.md Secção 6 (sugestões de redesign) — exercício de design, **não** é tarefa de
  implementação.
- Trabalho de feature/infra em `TODO.md`: M3 WhatsApp, M5 Exames, M9 Visitas, Fase 4, k8s,
  backups, testes k6/ZAP — cada um precisa da sua própria conversa de scoping.
