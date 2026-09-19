# PROGRESS

> Snapshot overwritten each session. Última atualização: 2026-09-19.
> Detalhe completo em [REVIEW.md](REVIEW.md) e [TODO.md](TODO.md).

## Done

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
