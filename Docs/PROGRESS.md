# PROGRESS

> Snapshot overwritten each session. Última atualização: 2026-09-14.
> Detalhe completo em [REVIEW.md](REVIEW.md) e [TODO.md](TODO.md).

## Done

- **M4 Health Plan Management — campo Seguradora nos produtos.** Pedido rápido de follow-up à
  sessão anterior (via Sherlock me): ao criar um produto de plano, novo campo obrigatório
  "Seguradora" (`<select>`), carregado do grupo de parametrização `TIPO_SEGURADORA` (mesmo padrão
  do campo "Tipo" existente, que já lia `TIPO_PLANO_SAUDE`). Guardado dentro do JSON
  `coverageRules` (`coverageRules.seguradora`), sem alteração de schema — mas com validação real no
  backend (`HealthPlansService.createProduct` rejeita com `400` se faltar). Editável depois via o
  modal "Gerir" do produto (antes só de leitura). Descoberta a meio da implementação: o grupo
  `TIPO_SEGURADORA` **já existia** na BD de dev, criado manualmente pelo utilizador via
  Parametrizações (GARANTIA/IMPAR/ALIANÇA) — o seed script foi ajustado para espelhar esses valores
  reais em vez de um palpite genérico. Decisão explícita do utilizador: este novo campo
  **substitui** a antiga etiqueta "Seguradora" do modal "Gerir" (que na verdade mostrava
  `product.company.name`, a ligação real à empresa) — essa ligação `companyId`/`Company` continua a
  existir no schema para o que já usava, só deixou de aparecer rotulada como "Seguradora" em
  qualquer sítio da UI de produtos. Verificado ao vivo contra a API real (criar sem seguradora →
  400; com ela → 201 e persistida; `PATCH` a editar → funciona).

- **M4 Health Plan Management — modelo de membership real, quota de sessões partilhada, botão de
  renovação consolidado.** Decisão de âmbito tomada com o utilizador antes de implementar (via
  Sherlock me), em duas rondas de perguntas: membership via **nova tabela de junção**
  (`health_plan_members`), substituindo por completo `HealthPlan.holderPatientId`; `Patient
  .healthPlanId` **removido por completo** (sem ponteiro desnormalizado, tudo derivado da
  membership); **uma pool de sessões partilhada** por plano (não por membro); decremento de sessão
  **só em `completed`**; renovação **reabastece** as sessões ao total do produto; botão "Renovar"
  fica **só** na página de detalhe do plano.
  - Schema: novo modelo `HealthPlanMember` (`healthPlanId`, `patientId`, `addedAt`, `removedAt`
    nullable para remoção suave); `HealthPlanProduct.sessionsPerCycle` (sessões por ciclo, `null` =
    ilimitado); `HealthPlan.sessionsRemaining` (contagem regressiva do ciclo atual, semeada/
    reabastecida a partir do produto). Migração em 3 passos respeitando a convenção `db push` do
    repo: push aditivo → script de backfill (uniu os dois ponteiros antigos, incluindo um caso real
    de desincronização nos dados seed) → push destrutivo a remover `holderPatientId`/
    `Patient.healthPlanId` de vez, já com todo o código migrado a ler só a nova tabela.
  - Regras de negócio novas em `HealthPlansService`: um paciente só pode ter uma membership ativa
    de cada vez (409 caso contrário); `HealthPlanProduct.maxMembers` passa a ser realmente aplicado
    (400 se excedido); remoção é sempre suave (`removedAt`), nunca hard-delete, e é idempotente;
    `recordSessionUsage` substitui `incrementUsage` — incrementa `usageCount` (tally vitalício) e
    decrementa `sessionsRemaining` (nunca abaixo de 0, via `updateMany` guardado) em conjunto,
    chamado sem condição a partir de `AppointmentsService` (antes só disparava se
    `patient.healthPlanId` estivesse definido). `getActiveCoverage` (usado pelo desconto de
    faturação) passa a exigir também sessões restantes, não só plano/produto ativos e não expirados.
  - Novas rotas: `POST /health-plans/:id/members` e `DELETE /health-plans/:id/members/:patientId`
    (admin, receptionist). `POST /health-plans` deixa de aceitar `holderPatientId` e passa a aceitar
    `memberPatientIds[]` opcional, criando o plano e associando membros na mesma transação.
  - Estado "a expirar" no frontend passa de um limiar único de 30 dias para 5 dias **ou** ≤5
    sessões restantes (o que vier primeiro) — separado da cadência de notificação 30/15/7 dias, que
    fica inalterada.
  - Frontend: página de detalhe do plano ganha um cartão **Membros** (listar/adicionar/remover,
    pesquisa de pacientes com debounce) e um indicador de sessões; a tab Planos troca a coluna
    "Titular" por "Membros" (+contagem) e ganha uma coluna "Sessões", perdendo a ação rápida
    "Renovar"; o modal de plano na lista de pacientes perde o botão "Renovar" e ganha um link "Ver
    Plano" para a página de detalhe; a tab Produtos ganha campos "Sessões por Ciclo"/"Máx. Membros".
  - Consumidores de backend migrados para a membership: `patients.service.ts` (filtro de plano e
    listagem), `bff.service.ts` (ecrã do paciente), `analytics.service.ts` (distribuição de plano),
    `notifications.processor.ts` (lembretes de expiração agora mensageiam todos os membros ativos e,
    independentemente, a empresa, em vez do modelo titular-XOR-empresa anterior).
  - Testes: specs unitários de `health-plans.service`, `appointments.service`,
    `notifications.processor`, `analytics.service` e `patients.service`/`repository` reescritos para
    o novo modelo; novo `health-plan-members.integration-spec.ts` (add/remove, limite de membros,
    plano duplicado, reativação após remoção, remoção idempotente, plano inexistente);
    `health-plan-renewal.integration-spec.ts` estendido com o ciclo de vida completo de sessões
    (completar consulta → pool esvazia → renovar → pool reabastece); novo
    `health-plan-members.spec.ts` e2e e `health-plan-renewal.spec.ts` atualizado (sem botão
    "Renovar" na lista, novo placeholder de pesquisa).
  - Docs atualizados: `modules/M4-health-plan-management.md` (v1.3), `API-SPEC.md` §4,
    `DATABASE-SCHEMA.md` §1.1/§4, `modules/M6-billing-invoicing.md` (nota sobre o gate de sessões no
    desconto).

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
