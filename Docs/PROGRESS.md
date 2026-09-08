# PROGRESS

> Snapshot overwritten each session. Última atualização: 2026-09-08.
> Detalhe completo em [REVIEW.md](REVIEW.md) e [TODO.md](TODO.md).

## Done

- REVIEW.md Secções 1–3 — findings críticos, privacidade/compliance, e o passe de bug-fix
  M1/M2/M6/M8 — todos fechados em sessões anteriores.
- REVIEW.md §4.1 — componente `Field` partilhado (`apps/web/components/ui/field.tsx`), 10 cópias
  locais removidas.
- REVIEW.md §4.2 — hook `useDebouncedValue`; pesquisa de pacientes com debounce.
- REVIEW.md §4.3 — `ZodValidationPipe` global (no-op) removido do `main.ts`; `schema` agora
  obrigatório.
- REVIEW.md §4.4 — todos os `console.*` em `apps/api/src` passaram a `Logger` do NestJS.
- REVIEW.md §4.5 — specs de serviço para `services`, `companies`, `parametrizacao`, `public`;
  **todos os módulos da API têm agora spec** (386 testes, 27 suites).
- REVIEW.md §5.1 — validação de formulários: schemas partilhados `dateOfBirthSchema` (sem datas
  futuras), `nifSchema` (9 dígitos), `caboVerdePhoneSchema` (regra única partilhada com o
  servidor); `max={hoje}` + hints nos 3 formulários de paciente.
- `Docs/CLAUDE.md` + `Docs/PROGRESS.md` criados.

## Em curso

- (nada)

## Bloqueado

- MFA retroativo — precisa de um realm Keycloak real (só existe dev local).
- M1 canal de lembrete (SMS/email) — precisa de infra de envio de SMS que não existe.

## Próximo

- REVIEW.md Secção 6 (sugestões de redesign) — exercício de design, **não** é tarefa de
  implementação.
- Trabalho de feature/infra em `TODO.md`: M3 WhatsApp, M5 Exames, M9 Visitas, M10 Analytics,
  Fase 4, k8s, backups, testes k6/ZAP — cada um precisa da sua própria conversa de scoping.
- A lista de correções do REVIEW.md (Secções 1–5) está **fechada** — nada acionável resta.
