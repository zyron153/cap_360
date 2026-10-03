# PROGRESS

> Snapshot overwritten each session. Última atualização: 2026-10-03.
> Detalhe completo em [REVIEW.md](REVIEW.md) e [TODO.md](TODO.md).

## Done

- **Página 404 + botão para o login, 2026-10-03.** Pedido: aceder ao dashboard sem sessão válida
  rebentava com `todayAppts.filter is not a function` (a API devolve o objeto de erro 401, não uma
  lista). Agora aparece uma página 404 com o botão «Ir para o login».
  - `app/not-found.tsx` (404 de ecrã inteiro) e `app/(app)/error.tsx` (reutiliza o mesmo cartão como
    error boundary das páginas da app).
  - Pendente (não pedido): as `queryFn` fazem `fetch().then(r => r.json())` sem verificar `!res.ok`;
    a correção de raiz é lançar erro aí e redirecionar 401 → `/login`. O boundary mostra «404» para
    qualquer erro de runtime em páginas `(app)`.
  - Verificação: `tsc` sem erros nos ficheiros novos; o resto do `apps/web` tem 6 erros de tipo em
    `billing/FaturasTab.tsx` e `billing/InvoiceDetailBody.tsx` (`atcud`/`efaturaRef` já não existem em
    `EFaturaSubmission` após a reescrita e-Fatura direta) — UI de faturação por atualizar.
  - Docs atualizados: `FRONTEND-ROUTES.md` (secção «Error pages»).

- **Troca de palavra-passe no primeiro login — correção do bloqueio + olho + regras visíveis,
  2026-10-03.** Pedido: o ecrã `/change-password` rejeitava a palavra-passe temporária correta
  ("Palavra-passe atual incorreta"); acrescentar botão de visibilidade e mostrar as regras da nova
  palavra-passe antes de submeter.
  - **Causa:** em dev, o `AUTH_BYPASS` do `SessionAuthGuard` ignorava o cookie de sessão e tratava todos
    os pedidos como o admin semeado — a troca era verificada contra a palavra-passe do admin. Reproduzido
    contra a API real (com a sessão do utilizador novo, `GET /staff/me` devolvia o admin).
  - **Correção:** o bypass só se aplica quando não há sessão válida; uma sessão real tem sempre
    prioridade (cookie obsoleto ou conta desativada continuam a cair no admin). Produção não é afetada.
  - **UI:** botão de mostrar/ocultar em cada campo de palavra-passe (login, `/change-password`,
    `/reset-password`, Definições → Alterar Palavra-passe) e lista de regras sempre visível que fica
    verde à medida que se escreve (10+ caracteres, maiúscula, número, diferente da temporária/atual,
    confirmação igual). Componentes partilhados: `password-input.tsx`, `password-checklist.tsx`,
    `lib/password-policy.ts`.
  - Verificação: 16 testes do guard (4 novos); integração `staff-temporary-password` 8/8 sem bypass;
    e2e `staff-temporary-password.spec.ts` 2/2 (o segundo conclui a troca de ponta a ponta e
    garante que a sessão é a do utilizador novo); `tsc` limpo em `apps/web`; verificado no browser.
  - Docs atualizados: `API-SPEC.md` (nota do bypass + §7), `SECURITY.md` §2.1, `TESTING.md`,
    `FRONTEND-ROUTES.md`, `TODO.md` (M8).

- **CI/CD — deploy de staging/produção por GitHub Actions + rollback automático, 2026-10-03.** Pedido:
  replicar a pipeline do DOPE STUDIO ERP (deploy por git/SSH) com checks de PR, health check +
  rollback e deploy de produção. Adaptado a este repo (imagens no GHCR, Postgres, NestJS/Next) em vez
  de copiar a referência, que constrói na VPS.
  - **Workflows:** `ci.yml` (Lint & Typecheck, Unit Tests, Dependency audit, Docker build check; também
    `workflow_call`), `deploy-staging.yml` (push a `staging` + manual: ci → build → SSH),
    `deploy-production.yml` (só manual e só a partir de `master`; ambiente `PRODUCTION` com aprovação).
    Imagens com tag `<env>-<sha>` — antes a tag `<sha>` era partilhada e o bundle web (que embute
    `NEXT_PUBLIC_API_URL`) de staging e prod podia misturar-se.
  - **`scripts/vps/deploy.sh`:** pull → postgres/redis → backup `pg_dump` (só prod) → `migrate deploy`
    **antes** de recriar → `up -d` → restart do nginx → health check ≤180 s (containers + `/health` via
    nginx, na VPS) → rollback automático das imagens e exit 1 se falhar. Staging e prod na mesma VPS:
    `/opt/cap360-{staging,prod}`, projetos compose `cap360-staging|prod`, nginx do staging em 8080/8443
    (`HTTP_PORT`/`HTTPS_PORT` no `.env.prod`).
  - **Migrações:** o histórico antigo (2 ficheiros obsoletos) foi substituído por uma baseline
    (`20261003000000_baseline`, sem drift face ao `schema.prisma`); o CI aplica `migrate deploy` e falha se
    o schema divergir das migrações; `prisma/migrations/` deixou de estar no `.gitignore`. Bug que o
    serviço `migrate` tinha desde sempre: `prisma db execute` precisa de `--schema`, por isso todos os
    deploys falhavam nesse passo.
  - **Outros:** nginx com `Host $http_host` (os redirects do Next perdiam a porta 8080), healthchecks em
    `127.0.0.1` + healthcheck do web, CI em Node 22 (pnpm 11 exige ≥ 22.13; as imagens continuam em
    Node 20), baseline do audit 0 critical / 32 high.
  - **Verificação:** actionlint, shellcheck, `docker compose config`, typecheck, lint e testes unitários
    limpos; `deploy.sh` ensaiado localmente (sucesso + release com API doente → rollback, exit 1).
    **Por executar:** os workflows no GitHub, push/pull GHCR, SSH, aprovação `PRODUCTION`, backup — não
    existe VPS.
  - **Falta (utilizador):** ambiente `PRODUCTION` + secrets `PRODUCTION_VM_IP/VM_USER/SSH_PRIVATE_KEY` +
    revisores; valores reais das variáveis `STAGING_PUBLIC_APP_URL`/`PUBLIC_APP_URL` (hoje placeholders
    `127.0.0.1`); preparar a VPS (checklist em `DEPLOYMENT.md` §0.4); required checks na branch protection.
  - Docs: `DEPLOYMENT.md` §0/§4/§5/§9, `CONTRIBUTING.md`, `Docs/CLAUDE.md`, `ARCHITECTURE.md`.

- **Gestão de Acesso — utilizadores criados com palavra-passe temporária, sem convite por email,
  2026-10-02.** Pedido do utilizador: remover o convite por email; ao adicionar um utilizador criar e
  atribuir a palavra-passe; forçar a troca no primeiro login.
  - **Criação:** `POST /staff` cria o utilizador logo, com uma palavra-passe aleatória de 14
    caracteres (`PasswordService.generateTemporary`, `crypto.randomInt`, sem caracteres ambíguos),
    devolvida **uma só vez** ao admin (`Cache-Control: no-store`) num modal com botão Copiar; só o
    hash argon2id é guardado. "Redefinir senha" (`POST /staff/:id/reset-password`) volta a emitir uma.
  - **Troca forçada:** novo `Staff.mustChangePassword`. `SessionAuthGuard` responde
    `403 PASSWORD_CHANGE_REQUIRED` a tudo menos `GET /staff/me` e `PATCH /staff/me/password`
    (`@AllowDuringPasswordChange()`), lendo a flag da BD em cada pedido — por isso um reset também
    corta uma sessão já aberta. O login devolve `staff.mustChangePassword` e leva a `/change-password`
    (nova página, não pública); `(app)/password-change-gate.tsx` cobre quem abre um URL da app
    diretamente. A nova palavra-passe tem de ser diferente da temporária.
  - **Removido:** `/staff/invite`, `/staff/invitations*`, `/public/invitations*`, o job `send-invite`
    e a página `/activate`. A tabela `staff_invitations` fica no schema como modelo legado (marcado),
    para o `db:push --accept-data-loss` do CI não a apagar — pode ser removida mais tarde.
  - **Utilizadores existentes** não são forçados a trocar; o botão "Redefinir senha" serve para isso.
    Keycloak não é usado no login de staff, por isso a imposição é só pela flag na app.
  - Verificação: 102 testes unitários nos módulos tocados (novos: gerador, serviço, guard, login);
    novo `staff-temporary-password.integration-spec.ts` (8 testes, sem `AUTH_BYPASS`, contra BD/Redis
    reais); novo e2e `staff-temporary-password.spec.ts`; fluxo da UI conduzido num browser real
    (criar → modal → badge → redefinir). `tsc` limpo em `apps/api`; em `apps/web` só restam tipos
    gerados obsoletos em `.next/` da página `/activate` removida.
  - Também neste commit (alterações já pendentes, não relacionadas): o nome da clínica na sidebar
    passa a vir de `usePermissions()` e os itens do menu ficam ocultos enquanto as permissões carregam.
  - Docs atualizados: `API-SPEC.md` §7/§9, `DATABASE-SCHEMA.md` §1.2/§1.3, `FRONTEND-ROUTES.md`,
    `SECURITY.md` §2.1, `TESTING.md`, `TODO.md` (M8), `modules/M8-staff-resource-scheduler.md`.
    `REVIEW.md` é um registo histórico e não foi alterado.

- **M6 — polimento geral do Financeiro (Faturas/Despesas/Entradas/Saldos), 2026-09-27.** Pedido do
  utilizador: "polish the Financeiro feature including Faturas and everything else". Uma survey
  dedicada (agente Explore) leu todo o módulo (backend `billing/`+`financeiro/`, os 5 separadores
  do frontend) e confirmou que a doc `M6-billing-invoicing.md` está correta em tudo o que foi
  verificado — os problemas reais encontrados foram estes 4, todos corrigidos:
  - **Recepcionista apanhava `403` a concluir a própria fatura que a Nova Fatura convida a criar.**
    Faturar um serviço ainda não catalogado cria um `Service` e liga uma entrada Parametrização
    `TIPO_SERVICO` — ambos os passos (`POST /services`, `PATCH /parametrizacao/:id`) são admin-only,
    mas "Criar fatura" é uma permissão real de recepcionista. Em vez de alargar os endpoints gerais
    (daria à recepção acesso a editar qualquer grupo de Parametrização, não só este), novo
    `POST /invoices/draft-service`, com o âmbito do próprio módulo de faturação
    (`@Roles("admin","receptionist")`), que faz os dois passos como uma ação atómica.
  - **Seletor de paciente na criação de faturas** (modal Nova Fatura e `/billing/new`) era um
    `<select>` limitado aos primeiros 100 pacientes sem pesquisa — a mesma classe de bug já
    corrigida para a marcação de consultas nesta sessão. Extraído o `PatientPicker` dessa correção
    para um componente partilhado (`components/ui/patient-picker.tsx`) e reutilizado nos 3 sítios
    (incluindo a marcação de consultas, de onde veio).
  - **Campo de valor do pagamento ficava vazio** depois de um pagamento parcial, em vez de
    pré-preencher com o novo saldo em dívida — risco real de erro de digitação num valor monetário.
  - **Falha ao gerar fatura automática ao concluir uma consulta a partir de Registos Clínicos**
    (fluxo normal do médico, não Marcações) não tinha forma de repetir — o aviso era só um toast e
    a consulta desaparecia da lista "Check-in Feito" de qualquer forma. Novo banner persistente com
    botão "Gerar Fatura" por tentativa falhada, reutilizando o endpoint de retry já existente.
  - Verificação: 499 testes unitários da API (2 novos); `tsc`/lint limpos em `apps/web`/`apps/api`;
    live-verified contra a API real (criado um serviço em falta via o novo endpoint, confirmado que
    a entrada de Parametrização ficou ligada, dados de teste limpos depois).
  - **`/billing/new` (formulário multi-linha) também corrigido**: era real mas inacessível —
    nenhum link apontava para lá, além dos seus bugs próprios (cap de 100 pacientes, locale
    `pt-PT` inconsistente). Distinto da modal Nova Fatura (vários itens do catálogo vs. um item
    guiado por parametrização), por isso mantido como segunda opção explícita em vez de substituir
    a modal: novo link "Fatura com Vários Itens" junto ao botão "Nova Fatura" no separador Faturas.
  - Docs atualizados: `TODO.md` (M6), `Docs/modules/M6-billing-invoicing.md` (v1.10).

- **M8 — turnos de profissionais (shift overrides), ligados de ponta a ponta (2026-09-27).**
  `StaffShift` era código morto: nenhum endpoint CRUD existia e o único método de leitura
  (`findStaffShift`) nunca era chamado pelo motor de disponibilidade — criar uma linha não tinha
  qualquer efeito (`Docs/modules/M8-staff-resource-scheduler.md` §2.3 documentava isto
  explicitamente). Corrigido dos dois lados:
  - **Backend:** `GET/POST /staff/:id/shifts`, `DELETE /staff/shifts/:id` (escrita admin-only,
    semântica de upsert). Novo `AppointmentsService.resolveDayWindows()`: uma linha `StaffShift`
    para essa data **substitui** o modelo semanal `StaffAvailability` inteiramente nesse dia (não é
    combinado com ele), usado tanto em `getAvailability()` como em `create()`.
  - **Frontend:** novo separador "Turnos" na página de Equipa (`_ShiftPlanner.tsx`), calendário
    genuinamente drag-to-assign — arrastar um intervalo na grelha define um turno, arrastar um
    turno existente muda o dia, redimensionar muda as horas, clicar edita/remove.
    `_CalendarView.tsx` ganhou props opcionais (`selectable`/`onSelect`/`durationEditable`/
    `onEventResize`) só para este uso — o calendário de marcações fica inalterado.
  - Verificação: 497 testes unitários da API (4 novos, cobrindo geração de slots e aceitação/
    rejeição de marcações contra o turno); `tsc`/lint limpos em `apps/web` e `apps/api`. Live-
    verified contra a API real: criado um turno para um médico real, confirmado que
    `getAvailability` passou da janela semanal (08:00–13:00) para a do turno (15:00–17:00),
    confirmado que `create()` rejeita a hora antiga e aceita a nova, removido o turno e confirmado
    que a disponibilidade voltou ao normal — todos os dados de teste limpos depois.
  - Docs atualizados: `TODO.md` (M8), `Docs/modules/M8-staff-resource-scheduler.md` (v1.3).

- **M2 — sistema de etiquetas de pacientes (2026-09-27).** `TODO.md` listava "sem campo no schema".
  Novo `Patient.tags` (`String[]` nativo do Postgres, `@default([])`), guardando códigos (não texto
  livre) de um novo grupo de Parametrização "TAG_PACIENTE" (VIP/Crónico/Novo, seed adicionado) — 
  reutiliza o ecrã de administração de Parametrizações já existente, sem UI de gestão nova. Novo
  `TagPicker`/`TagBadges` (`components/ui/tag-picker.tsx`, mesmo padrão de pesquisa com debounce já
  usado nos planos de saúde) ligado às 3 formas de criar/editar paciente e mostrado como pills na
  lista e no perfil. Não é limpo pelo direito ao apagamento (como `gender`, não identifica por si só).
  Verificação: `tsc --noEmit`/lint limpos em `apps/web` e `apps/api`; 494 testes unitários da API
  continuam verdes; PATCH real contra a API a correr localmente confirmou o round-trip (guardar,
  reler, reverter) e o grupo `TAG_PACIENTE` a devolver os 3 valores semeados.
  - Limpeza incidental: vários processos `node --watch src/main.ts`/`jest` órfãos (de sessões
    anteriores, alguns com 2 dias) estavam a bloquear o `prisma generate` (ficheiro `.dll` da engine
    trancado) — terminados para desbloquear a alteração de schema.
  - Doc atualizado: `TODO.md` (M2 Backend + Frontend).

- **M2 — autocomplete de pacientes no modal "Nova Marcação" (2026-09-27).** O `<select>` de
  paciente desse modal só carregava os primeiros 100 pacientes (`/api/patients?limit=100`, sem
  pesquisa) — qualquer paciente fora dessa página ficava silenciosamente impossível de marcar a
  partir deste, o principal ponto de entrada de marcação (sem `patientId` pré-preenchido, ao
  contrário do link a partir do perfil do paciente ou da lista de espera). Substituído por um
  campo de pesquisa "as-you-type" com debounce (300ms), reutilizando o mesmo padrão já validado em
  `HealthPlanDetailBody.tsx` ("Adicionar Membro"): `/api/patients?q=` (já existente, sem alteração
  no backend). Verificação: `tsc --noEmit` e lint limpos em `apps/web`; endpoint de pesquisa
  confirmado idêntico ao já usado em produção pelos planos de saúde. **UI não verificada no
  browser** — sem ferramenta de automação de browser disponível nesta sessão; a mudança é só de
  frontend e reutiliza um componente/padrão já em uso real.
  - Doc atualizado: `TODO.md` (M2 Frontend).

- **Auditoria pré-deploy (2026-09-25) e correções.** Dois agentes: auditoria de código + testes/build.
  - Lembretes de consultas **nunca eram enviados** (o processor da fila `reminders` era um stub que só
    registava log). Removido; `AppointmentsService` enfileira agora na fila `notifications`, cujo
    `handleReminder` envia via WhatsApp (com verificação de `consentGiven`, ignora consultas
    canceladas/eliminadas, texto conforme o offset 48h/24h/2h).
  - `secretAccessKey` (R2) adicionado ao mascaramento de segredos — `GET /settings` devolvia-o em claro.
  - `trust proxy` = 1 no `main.ts` (o throttle de login por IP via todos os clientes como o IP do proxy).
  - `next` → ≥15.5.24 e `nodemailer` → ≥9.1.0; `pnpm audit --prod`: 0 críticas (25 altas
    transitivas restantes, ex. multer via `@nestjs/platform-express` — exigem upgrade major).
  - Sidebar: removidos badges fictícios ("24", "3") e o selo "Beta" de Analytics.
  - **`/exams` e `/visits` (mockups sem backend) escondidos**: removidos da sidebar e redirecionados para
    `/dashboard` em `middleware.ts` (`HIDDEN_PATHS`). Reativar = apagar a entrada.
  - Teste de integração `health-plan-renewal` corrigido (confirmar antes de concluir a consulta).
  - Verificação: typecheck/lint/build limpos; 490 testes unitários.
  - **Decisões:** arrancar sem MFA (SECURITY.md §2.3 ainda o exige — não implementado no auth
    self-hosted); não iniciar o processo WABA/templates da Meta por agora → lembretes/confirmações só
    entregam dentro da janela de 24h.
  - **Feito depois:** validação de env no arranque (`common/assert-prod-env.ts`, só em produção:
    exige DATABASE_URL/FIELD_ENCRYPTION_KEY/REDIS_HOST/ALLOWED_ORIGINS/WEB_URL, recusa
    `AUTH_BYPASS=true` e origens localhost; 4 testes) e bootstrap de admin real (`seed.ts` com
    `NODE_ENV=production` só cria o admin de `ADMIN_EMAIL`/`ADMIN_PASSWORD` ≥12 chars — sem dados demo
    nem `Teste@1234`; idempotente, não sobrescreve a password).
  - **Infra de deploy (2026-09-26), por verificar por completo:** Dockerfiles reescritos (filtros
    `@cms/*` estavam errados; API compila `@cap/database` para JS só na imagem; web em `standalone`
    com build-args `API_INTERNAL_URL`/`NEXT_PUBLIC_API_URL`), `.dockerignore` (o `.env` ia para a
    imagem), `docker-compose.prod.yml` (serviço `migrate`: `db push` sem `--accept-data-loss` + SQL do
    trigger `audit_log`; serviço `seed` no profile `tools`), CI corrigido (`master` em vez de `main`;
    deploy fictício por `echo` → SSH + smoke test). Imagem da API construída (falta re-testar após o
    fix do `@cap/database`); imagem web ainda por confirmar; compose/CI nunca executados.
  - **Sem VPS nem domínio ainda (decisão 2026-09-26):** só a estrutura/configs ficam prontas.
    nginx agnóstico ao domínio (`nginx.conf` + `conf.d/app.conf` HTTP em qualquer host;
    `tls.conf.example` para ativar HTTPS depois), `.env.prod.example`, `.gitignore` para
    `.env.prod`/certs, e runbook completo em `DEPLOYMENT.md` §0 (o que fazer quando existir a VPS e
    quando existir o domínio). Imagens API e web construídas localmente.
  - **Pressupostos:** deploy num único host Docker via SSH (secrets `DEPLOY_HOST/USER/SSH_KEY/PATH`,
    var `PUBLIC_APP_URL`, `.env.prod` no servidor).
  - **Ainda bloqueia o deploy:** VPS, domínio + certs, backups (`pg_dump` off-server + teste de
    restauro), e a primeira execução real do compose/CI. WhatsApp precisa do domínio (webhook HTTPS).

- **M3 — WhatsApp Hub, Phase 1 (inbox) construído.** Antes: mockup sem backend. Agora:
  `apps/api/src/modules/whatsapp/` com webhook assinado (`GET` verify + `POST` com HMAC
  `X-Hub-Signature-256`, falha fechada sem `appSecret`), dedupe por id da Meta, callbacks de estado de
  entrega (sem regressão read→delivered), tabelas `whatsapp_conversations`/`whatsapp_messages` (corpos
  cifrados AES-256-GCM; uma conversa por número, reaberta em mensagem nova), ligação ao paciente por
  telefone normalizado (`+238…`), API do inbox (listar/thread/responder/atribuir/resolver/associar
  paciente) e a página `/whatsapp` real (Socket.io só com o id da conversa, nunca conteúdo). Resposta
  livre bloqueada fora da janela de 24h da Meta; envio idempotente. Resposta "1"/"SIM" a um lembrete
  confirma a única consulta pendente do paciente; "NÃO"/outras ficam para uma pessoa (nunca cancela
  sozinho). Apagar um paciente (direito ao apagamento) elimina as suas conversas. Envio da Graph API
  extraído para `whatsapp-api.ts` e reutilizado pelo `NotificationsProcessor`. `appSecret` adicionado
  ao mascaramento de segredos e ao formulário de Definições. Selo "Beta" removido da sidebar.
  - Verificação: `tsc`/lint limpos (api + web); 490 testes unitários (31 suites, +25 novos:
    `whatsapp-api.spec`, `whatsapp.service.spec`, erasure); nova `whatsapp-webhook.integration-spec`
    (4 testes, BD real: handshake, assinatura inválida, cifra em repouso, retry deduplicado, resolver/reabrir).
    **UI não verificada no browser** — só typecheck/lint; e2e Playwright por fazer.
  - Por fazer (ver `WHATSAPP_CHECKLIST.md`): pré-requisitos Meta (WABA, templates aprovados, URL público),
    lembretes como templates (texto livre só entrega dentro das 24h), bot FSM, SLA, respostas rápidas.
  - Docs: `M3-whatsapp-integration.md` (v1.2), `API-SPEC.md` §12b, `DATABASE-SCHEMA.md` §10, `TODO.md`,
    `FRONTEND-ROUTES.md`.

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

- M3 (resto): ver `WHATSAPP_CHECKLIST.md` — configurar Meta, templates, e2e, depois bot FSM.
- M4: self-service portal para `corporate_hr` gerir membros/relatórios de utilização (§4/§5 do
  módulo) — a membership existe, mas só é gerível via UI/API de admin/receptionist hoje. Renovação
  automática/agendada continua fora por decisão (ver `modules/M4-health-plan-management.md` §3.4).
- REVIEW.md Secção 6 (sugestões de redesign) — exercício de design, **não** é tarefa de
  implementação.
- Trabalho de feature/infra em `TODO.md`: M5 Exames, M9 Visitas, Fase 4, k8s,
  backups, testes k6/ZAP — cada um precisa da sua própria conversa de scoping.
