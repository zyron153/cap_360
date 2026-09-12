# PROGRESS

> Snapshot overwritten each session. Última atualização: 2026-09-12.
> Detalhe completo em [REVIEW.md](REVIEW.md) e [TODO.md](TODO.md).

## Done

- **Bug real de produção encontrado e corrigido**: `nextInvoiceNumber()` (`billing.repository.ts`)
  e `nextPlanNumber()` (`health-plans.repository.ts`) usavam `pg_advisory_lock`/`pg_advisory_unlock`
  como duas chamadas Prisma top-level separadas — um lock de âmbito de *sessão* Postgres, mas o
  pool de ligações do Prisma não garante que lock e unlock caem na mesma ligação física. Reproduzido
  ao vivo nesta sessão: uma ligação obteve o lock do ano (`2026`), foi devolvida ao pool ainda a
  segurá-lo, e reutilizada mais tarde para uma query completamente não relacionada — bloqueando
  para sempre qualquer nova fatura ou número de plano (3 sessões presas em `pg_advisory_lock`,
  confirmado via `pg_locks`/`pg_stat_activity`; uma delas ficou bloqueada 3m28s antes de eu libertar
  manualmente a ligação órfã com `pg_terminate_backend`). Isto explicava a falha "isolada" de
  `checkin-payment.spec.ts` que a sessão anterior tinha deixado como pendente — não é uma
  fragilidade do teste, é a app a bloquear de verdade ao marcar uma consulta como concluída.
  **Corrigido** em ambos os repositórios: lock+query+unlock agora vive dentro de um único
  `prisma.$transaction`, usando `pg_advisory_xact_lock` (âmbito de transação, libertado
  automaticamente no commit/rollback — sem unlock manual a esquecer, e a transação fixa uma única
  ligação física durante todo o bloco). Verificado com 8 conclusões de consulta concorrentes reais
  (paralelas via `Promise.all`) — todas ~100-200ms, zero locks pendentes em `pg_locks` depois.
  Suite completa de unidade (427 testes) e e2e (15 testes, 7 specs) a passar depois da correção.

- Corrigido `apps/web/e2e/checkin-payment.spec.ts` (falha pré-existente, sinalizada como pendente
  na sessão anterior): clicar "Concluída" no modal de agendamento já não dispara a transição de
  estado diretamente — abre agora o painel de confirmação de duração (funcionalidade adicionada
  numa sessão anterior, para calcular o valor da fatura a partir da duração real). O teste nunca
  tinha sido atualizado para clicar em "Confirmar Conclusão". Corrigido, mais um timeout alargado
  (10s) nessa asserção específica, já que este PATCH também cria o rascunho de fatura + verificação
  de cobertura de plano de saúde.

## Em curso

- (nada)

## Bloqueado

- MFA retroativo — precisa de um realm Keycloak real (só existe dev local).
- M1 canal de lembrete (SMS/email) — precisa de infra de envio de SMS que não existe.

## Próximo

- Vale a pena um pente-fino a outros usos de `pg_advisory_lock`/`unlock` (ou padrões
  lock-then-later-unlock em chamadas Prisma separadas) no resto da API — os dois únicos usos
  existentes (faturas, planos de saúde) estão corrigidos, mas o padrão era fácil de copiar para
  código novo sem notar o problema de pooling.
- REVIEW.md Secção 6 (sugestões de redesign) — exercício de design, **não** é tarefa de
  implementação.
- Trabalho de feature/infra em `TODO.md`: M3 WhatsApp, M5 Exames, M9 Visitas, M10 Analytics,
  Fase 4, k8s, backups, testes k6/ZAP — cada um precisa da sua própria conversa de scoping.
- A lista de correções do REVIEW.md (Secções 1–5) está **fechada** — nada acionável resta, para
  além do pente-fino de advisory locks listado acima.
