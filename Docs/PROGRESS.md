# PROGRESS

> Snapshot overwritten each session. Última atualização: 2026-10-06.
> Detalhe completo em [REVIEW.md](REVIEW.md) e [TODO.md](TODO.md).

## Done

- **Registo clínico: passagem de endurecimento por dois agentes em paralelo — 2026-10-06.** Pedido: fechar todos os
  pontos ainda abertos e os problemas encontrados, com o módulo a correr de ponta a ponta sem erros.
  - **Backend (agente 1).** Descartar rascunho (`DELETE /clinical-notes/:id`: autor ou admin, só rascunhos, auditado
    sem o texto); relatório admin de leituras entre autores (`GET /clinical-notes/access-log`); **falha de segurança
    corrigida no interceptor de auditoria** — uma URL com `?` fazia o "recurso" falhar o marcador da leitura entre
    autores (agora só o caminho conta; a URL completa fica em `metadata.url`); ligações de prescrição/referenciação a
    uma nota validadas e FKs `RESTRICT` (migração `20261006000000`), índice parcial para o relatório (`…000100`);
    transições de estado das referenciações (`REFERRAL_STATUS_TRANSITIONS`); **numeração de faturas passou de
    `COUNT+1` para `MAX+1`** sob o lock — apagar uma fatura que não era a última fazia a seguinte colidir e todas as
    criações davam 500.
  - **UI (agente 2).** O conflito de dois separadores é agora uma **junção a 3 vias por secção** com escolha lado a
    lado (`_note-merge.ts`, `M7` §2.1) em vez de "a minha ou a deles"; "Descartar rascunho"; separador admin
    "Acessos entre clínicos"; prescrições com vários medicamentos, duração e instruções; referenciações com escolha do
    colega e botões de estado; "Carregar mais" nas listas do perfil. O agente 2 foi cortado a meio pelo limite de
    sessão da API; o que deixou foi revisto e verificado aqui.
  - **Verificação (esta sessão).** `tsc` limpo (types, API, web), `eslint` limpo; **799 testes unitários (41 suites)**;
    **40 testes de integração com logins reais** (2 specs clínicos + faturas); **84 Playwright**: 81 passaram na
    primeira corrida completa e as 3 falhas eram **testes errados, não o produto** (um localizador filtrava pelo texto
    que o próprio teste altera; um stub de URL sem `*` final que nunca apanhava o GET paginado `?page=&limit=`; um
    clique no sino antes da hidratação, com a máquina sobrecarregada) — corrigidos e repetidos, todos verdes.
  - **Como foi verificado, e um aviso.** A BD de dev **não tinha** a migração `20261007000000_efatura_techplace`
    (outra sessão: e-Fatura Techplace) mas o cliente Prisma regenerado já pede `services.techplaceProductId`: com a BD
    de dev, 39 dos 40 testes de integração davam 500. Em vez de aplicar a migração de outra sessão à BD partilhada,
    cloná-la para uma BD descartável (`pg_dump | psql` dentro do contentor), aplicar lá o SQL, correr tudo contra
    essa cópia e apagá-la. **A BD de dev continua sem essa migração** — ver `TODO.md`.
  - **Ficou aberto (em `TODO.md`):** as 8 decisões que o agente 1 deixou para a clínica; reiniciar/reconstruir as APIs
    compiladas em :4000/:4001; apagar o paciente-marcador "AG1 numbering placeholder" e a sua fatura `INV-2026-0008`;
    `health-plans.repository.ts` ainda numera com `COUNT+1`; 3 testes de integração antigos falham só pela
    disponibilidade do Dr. Silva (uma quinta-feira, 10–11h); notas de teste que sobraram na BD de dev.

- **Os "ainda abertos" pequenos fechados — 2026-10-05 (2.ª passagem).** Pedido: avançar com o que ficou aberto.
  - **Auto-desbloqueio da regra "em tratamento hoje" → fechado, com a opção escolhida ("outra pessoa tem de fazer
    o check-in").** O endpoint de estado passou a registar quem fez o check-in e quem concluiu a consulta
    (`Appointment.checkedInByStaffId` / `completedByStaffId`, migração `20261005000200`, sem FK, `NULL` = desconhecido)
    e a leitura das notas de outros exige que **outra pessoa que não o leitor** tenha feito um dos dois. Provado
    com dois médicos reais: check-in + conclusão do próprio médico (ou concluir direto a partir de `confirmed`)
    não desbloqueia nada; a receção a concluir desbloqueia; ator desconhecido (sistema / linhas antigas) qualifica.
    O editor explica ("Foi só você a pôr este paciente em consulta…") em vez de não mostrar histórico. Custo
    aceite: numa clínica sem receção, o médico que faz ele próprio o check-in não vê as notas do colega (o admin vê).
  - **Pesquisa no telemóvel:** abaixo de 768 px um ícone abre uma barra por cima do topo (mesmo combobox, mesma lista).
  - **`/exams` e `/visits`:** continuam mock-only e inacessíveis (o middleware redireciona). Em vez de mexer em
    páginas mortas sem as poder testar, há um teste-armadilha no guarda responsivo que falha no momento em que
    forem reativadas, a mandar acrescentá-las à verificação de largura de telemóvel.
  - **Verificação:** 685 testes unitários na suite completa da API (38 suites), com testes novos para o registo do ator e para a
    condição da leitura; **14 testes de integração com dois médicos reais** (4 novos: auto-check-in, auto-conclusão,
    conclusão pela receção, ator desconhecido); Playwright: notas 7, topo 5, responsivo 33. Falhas intermédias:
    um nome acessível que continha o de outro campo (de novo) e uma suspensão de rede da máquina a meio de um teste
    (repetido isolado, passou).
  - **Ainda aberto** (pequeno, em `TODO.md`): duas pessoas ainda podem combinar o desbloqueio; o banner de duas
    abas é "a minha ou a deles"; dois pacientes `E2E Paciente…` de 6–7 de setembro (lixo de e2e antigo do repo).

- **Os 4 "ainda abertos" do registo clínico fechados — 2026-10-05.** Pedido: corrigi-los primeiro. Todos feitos;
  a decisão de acesso foi do utilizador (opção A).
  - **Última escrita ganha entre abas → corrigido.** Cada `PATCH` do editor leva `expectedUpdatedAt` e é um
    compare-and-set numa só instrução (`updateMany where updatedAt`); perder dá 409 `NOTE_CHANGED` + a nota atual, e
    o editor pára o autosave e mostra "Carregar a versão guardada" / "Manter a minha versão". Um segundo create para
    a mesma consulta passou a ser 409 (antes *continuava* o rascunho, o que sobrescrevia a outra aba — o meu erro de
    ontem). Ao vivo: 6 primeiros-guardares → 1×201 + 5×409; 2 gravações em corrida → 1×200 + 1×409.
  - **Médico a cobrir vê as notas do colega → regra "em tratamento hoje".** Com consulta de hoje `checked_in` ou
    `completed`, qualquer médico **lê** as notas **finalizadas** dos outros autores (nunca rascunhos), só leitura,
    caduca no fim do dia (Cabo Verde), leitura marcada no `audit_log`. Fraqueza aceite: dá para a desbloquear
    marcando/dando check-in a uma consulta (limitado a um dia e auditado). Documentado em `M7` §3.1, `SECURITY.md`
    §3.1 e `ROLES-PERMISSIONS.md` (que ainda dizia que o M7 não existia).
  - **Telemóvel: a medição estava fraca.** O guarda de ontem tratava `overflow:hidden` como seguro e dizia "0"
    com 20 vistas partidas (tabelas cortadas 100–800 px, 4 páginas com navegação vertical fixa a deixar o conteúdo
    com ~130 px, o layout `1fr 340px` do dashboard com a coluna principal a 2 px, calendário em 7 colunas,
    inbox do WhatsApp). Corrigido: 37 grelhas responsivas, 12 tabelas com o seu `overflow-x-auto`, navegação em tira
    abaixo de `lg`, calendário em vista de um dia abaixo de 768 px, WhatsApp em lista→conversa, linhas que não
    quebravam. Guarda novo (corta/aperta/rola, em todas as abas, a 390 e 820 px).
  - **Topo:** chips e sino ligados a dados reais (marcações por confirmar nos próximos 7 dias; planos ativos que
    terminam em 7 dias; só admin/receção), ponto vermelho só quando há alertas; a pesquisa passou a ser um combobox de
    pacientes ("Abrir paciente", nome acessível distinto do da pesquisa do histórico). Calendários mostravam
    "null — Consulta" para pacientes apagados → "Paciente removido".
  - **Verificação:** 64 testes unitários do módulo e 681 na suite completa da API (38 suites); **10 testes de
    integração com dois médicos reais** (`clinical-note-access.integration-spec.ts`: leitura só em tratamento,
    drafts nunca, escrita 404, auditoria, janela do dia, corridas); Playwright: notas 6, topo 4, responsivo 31.
    As falhas intermédias foram erros meus ou da máquina sobrecarregada (import entre specs que o Playwright não
    resolve no Node 24, "próxima vaga" fora da janela de 7 dias, nome acessível duplicado, corrida entre specs a
    reservar a mesma vaga; um número de telefone com 12 dígitos apanhei ao reler, antes de correr) — corrigidos,
    não contornados.
  - **Ainda aberto** (pequeno, em `TODO.md`): a regra "em tratamento hoje" pode ser desbloqueada por quem marca/dá
    check-in; sem pesquisa no topo abaixo de 768 px; rotas mock `/exams` e `/visits` por tocar.

- **Limites do registo clínico fechados — 2026-10-04.** Pedido: verificar cada limite deixado ontem e propor
  correção; todos os quatro implementados, mais a regra mais estrita escolhida para as notas.
  - **Uma nota por consulta por clínico:** `@@unique([appointmentId, authorStaffId])` (migração
    `20261005000100`, que descola — nunca apaga — duplicados antigos). Um POST repetido é um 409 com a nota
    existente (inicialmente continuava o rascunho; ver a entrada de 2026-10-05: isso sobrescrevia a outra aba) e
    quem perde uma corrida recebe o mesmo 409 em vez de 500. Verificado ao vivo: 6 primeiros-guardares
    simultâneos → 1 nota.
  - **Histórico paginado:** `page`/`limit` (resposta continua um array), "Carregar mais", ordem estável
    `(createdAt, id)`, duplicados de fronteira descartados no cliente.
  - **Frases rápidas editáveis:** grupos `FRASE_MOTIVO/OBSERVACOES/AVALIACAO/PLANO` em Parametrizações (secção
    "Registo clínico"); grupo vazio → frases sugeridas (em produção começam todos vazios: o seed de produção
    só cria o admin).
  - **Médico a cobrir um colega:** alternador "Só os meus / Todos" na fila (lembrado no browser); linha do
    colega mostra o nome e não mostra "Sem nota"; o editor avisa que as notas de outros clínicos não são
    visíveis e não adivinha "Avaliação inicial".
  - **Shell responsiva:** sidebar em gaveta abaixo de `lg` (botão de menu no topo, Escape/clique fora/navegar
    fecham), topbar sem chips <1536px e sem relógio/pesquisa em ecrãs pequenos; 6 rotas com cabeçalhos que
    não quebravam linha (`/appointments`, `/billing`, `/health-plans`, `/staff`, `/parametrizacoes`,
    `/access`) agora quebram. Medido antes/depois: 14 de 15 rotas transbordavam a 390px (e `/appointments`
    também a 820px); agora 0 em 390/820/1024/1280.
  - **Verificação:** 51 testes unitários do módulo; 32 verificações contra a API real (19 anteriores + 13 de
    concorrência/paginação); 1 spec Playwright de notas (3 testes) + 31 testes do guarda de overflow/gaveta; 11 verificações
    de UI ad-hoc (alternador, aviso de colega, frases, persistência). O primeiro teste de paginação falhou
    por corrida com o debounce da pesquisa (erro do teste, não da app) e foi corrigido.
  - **Ainda aberto nessa altura** — fechado em 2026-10-05 (ver a entrada acima): última escrita ganha entre
    abas, médico a cobrir sem acesso às notas do colega, tabelas/grelhas apertadas no telemóvel, chips e pesquisa
    do topo falsos. Docs: `M7`, `TODO.md`, `TESTING.md`.

- **Registo clínico do médico — 2026-10-03.** Pedido: tornar o registo (e a listagem) do médico mais
  amigável, para o doente que está no consultório com a consulta em `checked_in`. Antes: a nota escrevia-se
  num modal na ficha do paciente, longe da fila de check-in, nunca ligada à consulta, sem rascunho, sem
  edição na UI, e a lista cortava as últimas 100 notas **de todos os médicos** antes de filtrar pelas do
  próprio. Agora: página do editor `records/note` (rascunho guardado no servidor, cifrado, ~1,5 s depois de
  parar de escrever; contexto do paciente + plano anterior + alerta de risco ao lado; frases rápidas; tipo de
  sessão e duração pré-preenchidos; "Guardar e concluir consulta" num só clique), fila do dia em "Em consulta"
  (estado da nota por paciente, atualiza sozinha a cada 30 s) e "Histórico" com pesquisa e filtros.
  - **Backend:** `ClinicalNote.finalizedAt` (null = rascunho; a migração preenche as notas existentes), regra
    de finalização única (`finalNoteIssues` em `@cap/types`), bloqueio de 24 h conta desde a finalização,
    `appointmentId` validado (existe e é do mesmo paciente), filtro de autoria feito na query, `PATCH`
    revalida completude e risco.
  - **Decisão:** o rascunho vive no servidor e não no `localStorage` — texto clínico em claro num PC partilhado
    contrariava a cifra AES-256 do módulo.
  - **Verificação:** 41 testes unitários do módulo (658 na suite completa da API); 19 verificações contra a API real; 2 specs Playwright
    (`e2e/clinical-note-draft.spec.ts`) contra o UI real; capturas em desktop/tablet. Limites e pendentes em
    `TODO.md` (M7). Docs: `M7`, `M1`, `TODO.md`.
  - **Atenção:** a shell não tem navegação móvel (sidebar fixa de 240 px) — em telemóvel todas as páginas
    ficam apertadas; o editor é utilizável a partir de tablet vertical.

- **VPS, domínio, TLS e primeiro deploy real — 2026-10-03.** Pedido: pôr o staging numa VPS real e deixar a
  produção preparada. Checklist por fases em [VPS_CONFIG.md](VPS_CONFIG.md); runbook em `DEPLOYMENT.md` §0.
  - **VPS:** Hostinger KVM 2 (2 vCPU, 8 GB, Ubuntu 24.04, Düsseldorf). Endurecida: SSH só por chave (password
    e login root por password desligados; o ficheiro tem de se chamar `00-hardening.conf` porque o
    `50-cloud-init.conf` reativa a password), utilizador `deploy` (grupo docker), ufw (22/80/443/8080/8443),
    fail2ban, unattended-upgrades, Docker 29 + Compose v5 com rotação de logs.
  - **Domínio e TLS:** `cap360.tech` (domínio grátis da Hostinger) com A para a VPS; o AAAA de parking teve de
    sair (o Let's Encrypt prefere IPv6). Certificado Let's Encrypt via certbot standalone + hooks de renovação
    (pre/post param o container que publica a :80, deploy copia o cert para o `infra/nginx/certs` da stack);
    `certbot renew --dry-run` passa. O `tls.conf` vive por clone, sem tocar no `app.conf` rastreado — um 301
    geral no `app.conf` partia o health check do `deploy.sh`.
  - **Staging no ar** em `https://staging.cap360.tech:8443`: hostname próprio porque o cookie `cap_session` é
    `Secure` (um browser descarta-o em HTTP) e cookies ignoram portas, logo `cap360.tech:8443` chocaria com a
    produção. Primeiro admin criado com o serviço `seed`; login por HTTPS verificado.
  - **Bugs apanhados:** (1) `seed` morria com `ERR_UNKNOWN_FILE_EXTENSION` (ts-node vs ESM no node:20) →
    `--compiler-options {"module":"commonjs"}` no compose; (2) o gate `Dependency audit` passou de 32 para 33
    high em menos de uma hora e bloqueou o deploy → override `multer >=2.3.0` (33 → 27 high); (3) esse override só
    no `pnpm-workspace.yaml` partiu o build das imagens (o Docker usa pnpm 9, que lê o `package.json`) → fica nos
    dois sítios; (4) `POSTGRES_PASSWORD` em base64 parte o `DATABASE_URL` → hex.
  - **Backups:** `scripts/vps/backup.sh <staging|prod>` (cron nocturno, 14 dumps, `.tmp` + `gzip -t`, falha não
    deixa ficheiro); restauro testado em staging (38 tabelas + admin). **Ainda sem cópia off-server.**
  - **Produção preparada:** ambiente `PRODUCTION` (revisor obrigatório, só a branch `prod`), secrets criados,
    `/opt/cap360-prod` com `.env.prod` próprio, cert e `tls.conf`. `deploy-production.yml` dispara num push a
    `prod` (+ manual); release = `git push origin master:prod`. Primeira execução disparada em 2026-10-03; a
    aprovação é do utilizador. Falta: seed do admin de prod, backup off-server da `FIELD_ENCRYPTION_KEY` de prod,
    cron de backup de prod.
  - **Atenção:** o repositório é **público**, e `Docs/VPS_CONFIG.md` expõe o IP e a estrutura da VPS; tornar o
    repo privado desliga o revisor obrigatório do ambiente no plano Free.
  - Docs atualizados: `DEPLOYMENT.md`, `VPS_CONFIG.md`, `SECURITY.md`, `ARCHITECTURE.md`, `CODING-READINESS.md`,
    `TODO.md`, `CONTRIBUTING.md`, `CLAUDE.md`.

- **Nota para mais tarde — proteção do repositório e verificação de vulnerabilidades, 2026-10-03.**
  Ainda **não** está configurado: branch protection/rulesets, Dependabot (`.github/dependabot.yml`),
  secret scanning, CodeQL e scan de imagens; o `pnpm audit` do CI é um gate com baseline (falha acima de 0 critical / 32 high; bloqueou um
  deploy em 2026-10-03 até o override do `multer` baixar para 27 high) e há highs por tratar. Proteger só a `master` não afeta o deploy de staging (corre num push
  a `staging` ou manualmente); proteger a própria `staging` obriga a que o deploy venha de um PR.
  Checklist em `TODO.md` → DevOps → «Repository protection & vulnerability checks».

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

- **Gestão de Acesso — o admin define a palavra-passe do utilizador (sem convite por email nem senha
  temporária), 2026-10-03.** Percurso: pediu-se primeiro remover o convite por email (utilizador criado
  com senha gerada + troca forçada no primeiro login); ao testar, a troca falhava em dev e, a seguir,
  pediu-se para remover toda a lógica de senha temporária — o admin passa a escolher a palavra-passe e
  a poder mudá-la depois.
  - **Criação:** `POST /staff` exige `password` (mesma política de todas as palavras-passe,
    `PasswordSchema`: 10–72 caracteres, maiúscula, número). O formulário «Adicionar Utilizador» tem
    palavra-passe + confirmação, botão «Gerar» (palavra-passe forte aleatória gerada no browser com
    `crypto.getRandomValues`, revelada para se poder copiar), «Copiar», um olho por campo e a lista de
    regras sempre visível a ficar verde ao escrever. Só o hash argon2id é guardado; a API nunca gera
    nem devolve palavras-passe. Sem troca forçada no primeiro login.
  - **«Alterar senha»** (substitui «Redefinir senha»): `PATCH /staff/:id/password` + modal com os mesmos
    campos. Termina **todas as sessões abertas** desse utilizador (`SessionService.destroyAllForStaff`,
    varrimento de `session:*` por `staffId`, sem índice por utilizador que possa dessincronizar); se o
    admin muda a sua própria palavra-passe, a sessão atual é poupada. A alteração própria (Definições) e
    o reset por email não terminam outras sessões.
  - **Removido:** o convite por email (`/staff/invite`, `/staff/invitations*`, `/public/invitations*`,
    job `send-invite`, página `/activate`), e a senha temporária (gerador no servidor,
    `Staff.mustChangePassword` — coluna apagada pela migração `20261004000200_drop_staff_must_change_password`
    —, bloqueio `403 PASSWORD_CHANGE_REQUIRED` no guard, página `/change-password` e o redirect na app).
    A tabela `staff_invitations` fica no schema como modelo legado, sem uso.
  - **Bug apanhado pelo caminho:** em dev, o `AUTH_BYPASS` do `SessionAuthGuard` ignorava o cookie de
    sessão e tratava tudo como o admin semeado, por isso a troca de palavra-passe de um utilizador novo
    era verificada contra a do admin («Palavra-passe atual incorreta»). Agora uma sessão real tem sempre
    prioridade sobre o bypass (sessão terminada/cookie obsoleto/conta desativada continuam a cair no
    admin). Produção não é afetada.
  - **Também:** botão mostrar/ocultar e lista de regras em login, `/reset-password` e Definições →
    Alterar Palavra-passe (`password-input.tsx`, `password-checklist.tsx`, `new-password-fields.tsx`,
    `lib/password-policy.ts`).
  - **Dev:** a BD de dev não segue o histórico de migrações novo, por isso o SQL da migração foi aplicado
    à mão (`prisma db execute`), como a outra sessão fez com as migrações e-Fatura.
  - Verificação: 102 testes unitários nos módulos tocados; `staff-admin-password.integration-spec.ts`
    8/8 sem `AUTH_BYPASS` (BD/Redis reais, incluindo o 401 da sessão terminada); e2e
    `staff-admin-password.spec.ts` 1/1 (criar com «Gerar» → utilizador entra → «Alterar senha» → senha
    antiga recusada, nova aceite); `tsc` e lint limpos nos ficheiros tocados; UI vista no browser.
  - Docs atualizados: `API-SPEC.md` (§Auth + §7), `DATABASE-SCHEMA.md` §1.2/§1.3, `FRONTEND-ROUTES.md`,
    `SECURITY.md` §2.1, `TESTING.md`, `TODO.md` (M8), `modules/M8-staff-resource-scheduler.md`.
    `REVIEW.md` é um registo histórico e não foi alterado.

- **CI/CD — deploy de staging/produção por GitHub Actions + rollback automático, 2026-10-03.** Pedido:
  replicar a pipeline do DOPE STUDIO ERP (deploy por git/SSH) com checks de PR, health check +
  rollback e deploy de produção. Adaptado a este repo (imagens no GHCR, Postgres, NestJS/Next) em vez
  de copiar a referência, que constrói na VPS.
  - **Workflows:** `ci.yml` (Lint & Typecheck, Unit Tests, Dependency audit, Docker build check; também
    `workflow_call`), `deploy-staging.yml` (push a `staging` + manual: ci → build → SSH),
    `deploy-production.yml` (hoje: push a `prod` + manual, só a branch `prod`; ambiente `PRODUCTION` com aprovação — era
    «só manual a partir de `master`» até 2026-10-03).
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
  - **Sem VPS nem domínio ainda (decisão 2026-09-26; superado em 2026-10-03, ver a primeira entrada):** só a estrutura/configs ficam prontas.
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
