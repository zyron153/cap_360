# PROGRESS

> Snapshot overwritten each session. Última atualização: 2026-09-12.
> Detalhe completo em [REVIEW.md](REVIEW.md) e [TODO.md](TODO.md).

## Done

- **M10 Analytics — backend real para as métricas de agendamentos/pacientes** (a receita já era
  real de uma sessão anterior). Novo `apps/api/src/modules/analytics/` — `GET
  /analytics/summary?from=&to=` — substitui todos os arrays mock que restavam em
  `analytics/page.tsx`:
  - `appointmentsByMonth`, `totalAppointments`, `topServices` (top 8) e `peakHours`
    (hora-do-dia, só horas com dados) — tudo agregado a partir de **uma única** query de
    agendamentos no período (`scheduledAt` entre `from`/`to`), à semelhança do padrão de
    "bump map" que `FinanceiroService.getSummary()` já usava para os totais mensais.
  - `attendanceRate` = `completed / (completed + no_show)` no período — pendentes/confirmadas
    (ainda não resolvidas) e canceladas (paciente nunca teve intenção de vir) ficam de fora de
    ambos os lados da conta, conforme decidido na conversa de scoping.
  - `activePatients` (pacientes com ≥1 consulta nos últimos 12 meses) e `planDistribution`
    (esses mesmos pacientes agrupados pelo nome do produto do plano de saúde ativo, ou
    "Particular") são um **snapshot atual**, independente do `from`/`to` — mesma lógica do
    `receivables` do Financeiro.
  - Sem tabela nova nem repositório — só `PrismaService` direto, mesmo padrão do `BffService`
    (não havia motivo para SQL bruto aqui, então esta funcionalidade não herda a classe de bug
    dos advisory locks corrigida na sessão anterior).
  - `analytics/page.tsx` reescrita: já não tem nenhum array `const` mock. Ganhou o mesmo seletor
    de intervalo de datas (mês/trimestre/ano/personalizado) que `billing/ResumoTab.tsx` já tinha —
    Receita YTD/Mensal passam a respeitar o período escolhido em vez de ficarem fixas ao
    ano-corrente.
  - 7 testes novos (`analytics.service.spec.ts`, 434 no total da API). Verificado ao vivo no
    browser (Playwright) — todos os KPIs e gráficos mostram dados reais da dev DB. Suite e2e
    completa (15 testes, 7 specs) e suite unitária completa (434 testes) a passar depois da
    mudança.
  - Decisões de scoping tomadas com o utilizador antes de implementar: "pacientes activos" =
    consulta nos últimos 12 meses (não "todos os não-eliminados"); taxa de presença exclui
    pendentes/canceladas do denominador; distribuição por plano usa o nome real de cada produto
    (não 3 categorias inventadas); seletor de intervalo adicionado (não ficou fixo a YTD).
  - Docs atualizados: `API-SPEC.md` (nova §12, Não Implementado renumerada; também corrigida uma
    linha stale nessa mesma tabela que ainda listava M7 Clinical Records como "sem backend" —
    tem backend real há sessões), `FRONTEND-ROUTES.md` (mesma correção do M7 + M10 movido da
    tabela de mockups), `TODO.md`, `modules/M10-analytics-reporting.md` (v1.2), `CLAUDE.md`
    (índice de docs).
  - Fora do âmbito desta sessão, continua por fazer: materialised views, exportação PDF/Excel/CSV,
    breakdown por médico/staff, demografia de pacientes, atribuição de origem de marcação,
    renovação/churn de planos, e o portal `corporate_hr` — ver `TODO.md`/módulo M10 para a lista
    completa.

- **Bug real de produção da sessão anterior, revalidado**: `nextInvoiceNumber()`/`nextPlanNumber()`
  (advisory-lock deadlock sob connection pooling do Prisma) — já corrigido, sem regressões
  detetadas nesta sessão. Auditoria rápida confirmou que são os únicos dois usos de `$executeRaw`/
  `$queryRaw` em toda a `apps/api/src` — nada mais desta classe de bug para corrigir.

## Em curso

- (nada)

## Bloqueado

- MFA retroativo — precisa de um realm Keycloak real (só existe dev local).
- M1 canal de lembrete (SMS/email) — precisa de infra de envio de SMS que não existe.

## Próximo

- Continuação natural do M10: materialised views (só vale a pena revisitar se o volume de dados
  crescer o suficiente para as queries atuais deixarem de ser triviais), exportação PDF/Excel/CSV,
  breakdown por médico/staff, demografia de pacientes.
- REVIEW.md Secção 6 (sugestões de redesign) — exercício de design, **não** é tarefa de
  implementação.
- Trabalho de feature/infra em `TODO.md`: M3 WhatsApp, M5 Exames, M9 Visitas, Fase 4, k8s,
  backups, testes k6/ZAP — cada um precisa da sua própria conversa de scoping.
