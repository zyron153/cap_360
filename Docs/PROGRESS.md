# PROGRESS

> Snapshot overwritten each session. Última atualização: 2026-09-12.
> Detalhe completo em [REVIEW.md](REVIEW.md) e [TODO.md](TODO.md).

## Done

- Financeiro — "Impacto Financeiro de Faltas" só contava agendamentos `no_show`, mostrando 0/0
  para períodos só com cancelamentos. `FinanceiroRepository.noShowAppointments` alargado para
  `status: { in: ["no_show", "cancelled"] }`; nome do campo (`noShowImpact`) mantido por ser uma
  alteração pequena e não quebrar a API. 25/25 testes do módulo a passar.
- Faturação — botão "Detalhes" na lista de faturas passou a abrir num modal em vez de navegar
  para `/billing/:id`:
  - Extraída a experiência de detalhe de fatura (linha de itens, pagamentos, cancelamento,
    estado E-Factura, formulário de registo de pagamento) do `billing/[id]/page.tsx` para um
    componente partilhado `InvoiceDetailBody.tsx`, usado tanto pela página completa como pelo novo
    `InvoiceDetailModal` em `FaturasTab.tsx` — evita duas implementações a divergir.
  - Verificado ao vivo com Playwright num dev server real: o URL nunca sai de `/billing`, o modal
    mostra dados reais, o formulário de pagamento e o painel de cancelamento (motivo obrigatório)
    funcionam dentro do modal.
- Bug encontrado e corrigido durante a verificação acima: várias faturas na base de dev referenciam
  pacientes apagados por direito ao esquecimento (`Patient.fullName = null`), e o cabeçalho/avatar
  da fatura mostrava em branco em vez do fallback já usado no resto da app ("Paciente removido").
  Corrigido em `InvoiceDetailBody.tsx` e `FaturasTab.tsx` (lista + preview).
- Dashboard — o mesmo problema (`fullName` nulo por apagamento) fazia a função `initials()` rebentar
  com `TypeError: Cannot read properties of null (reading 'trim')` ao renderizar consultas de hoje,
  pacientes recentes ou faturas recentes que referenciam um paciente apagado. `initials()` agora é
  null-safe e as 3 listas mostram "Paciente removido" em vez de rebentar.
- REVIEW.md / M6 module doc atualizados para refletir tudo o que precede (ver
  `Docs/modules/M6-billing-invoicing.md` v1.5).
- Recibo em PDF não mostrava o NIF do paciente (só o da clínica no rodapé), ao contrário da
  pré-visualização no ecrã (`FaturaPreviewModal`), que já mostrava ambos. Pedido do utilizador
  para confirmar que o NIF da CAP vem de Configurações → Clínica e o NIF do cliente vem do registo
  do paciente — a pré-visualização já estava correta; o gap real estava no PDF:
  `BillingRepository.findById` já decripta `patient.nif`, mas `BillingService.getReceiptUrl` nunca
  o passava para `generateReceiptPdf`, e `ReceiptData.patient` nem tinha o campo. Corrigido em
  `receipt.pdf.ts` (tipo + render, com o mesmo fallback "Consumidor Final") e `billing.service.ts`;
  2 testes novos em `billing.service.spec.ts`, 39/39 a passar.

## Em curso

- (nada)

## Bloqueado

- MFA retroativo — precisa de um realm Keycloak real (só existe dev local).
- M1 canal de lembrete (SMS/email) — precisa de infra de envio de SMS que não existe.

## Próximo

- Opções levantadas na análise do M6 (sessões anteriores), ainda por escolher/agendar:
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
