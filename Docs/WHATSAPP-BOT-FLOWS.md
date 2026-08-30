# CAP 360 — WhatsApp Bot Flows

> **API:** Meta Cloud API via 360dialog or Twilio
> **Language:** Portuguese (pt-CV dialect)
> **Architecture:** Finite State Machine (FSM) stored in Redis per phone number
> **Handoff:** Any flow can escalate to the shared agent inbox at any point

> **Implementation status: 🎭 none of this exists.** There is no bot, no FSM, no agent inbox, no
> `/whatsapp/webhook` — see `modules/M3-whatsapp-integration.md` for the full picture. This
> document is kept as a conversation-design reference for if/when M3 is built. The one factual
> correction worth making now: of the templates in §1, only the four appointment-reminder rows are
> actually sent today (by the Appointments module directly, not by anything described in this
> file) — `appointment_cancelled`, `exam_result_ready`, `invoice_receipt`, `health_plan_expiring`,
> and `welcome_new_patient` are never sent by anything in the codebase.

---

## 1. Approved Message Templates

All outbound messages outside the 24-hour customer service window must use pre-approved templates.

| Template Name | Category | Purpose | Actually sent today? |
|---|---|---|---|
| `appointment_confirmation` | UTILITY | Sent immediately after booking | ✅ yes |
| `appointment_reminder_48h` | UTILITY | 48 hours before appointment | ✅ yes |
| `appointment_reminder_24h` | UTILITY | 24 hours before appointment | ✅ yes |
| `appointment_reminder_2h` | UTILITY | 2 hours before appointment | ✅ yes |
| `appointment_cancelled` | UTILITY | Cancellation confirmation | ❌ no |
| `exam_result_ready` | UTILITY | Notify patient result is ready | ❌ no |
| `invoice_receipt` | UTILITY | Payment receipt | ❌ no |
| `health_plan_expiring` | UTILITY | Renewal reminder | ❌ no |
| `welcome_new_patient` | UTILITY | First-time registration welcome | ❌ no |

---

## 2. Template Definitions

### `appointment_confirmation`
```
Olá {{1}}! ✅

A sua consulta foi marcada com sucesso:

📅 Data: {{2}}
⏰ Hora: {{3}}
🏥 Serviço: {{4}}
👨‍⚕️ Médico: {{5}}

Para confirmar responda *1* · Para cancelar responda *2*

Mais Saúde CV · +238 522 42 00
```

### `appointment_reminder_24h`
```
Lembrete 🔔 — Mais Saúde CV

Olá {{1}}, a sua consulta é *amanhã*:

📅 {{2}} às {{3}}
👨‍⚕️ {{4}} — {{5}}
📍 Palmarejo, Praia

Confirmar: responda *SIM*
Cancelar ou reagendar: responda *NÃO*
```

### `exam_result_ready`
```
Mais Saúde CV — Resultado Disponível 🧪

Olá {{1}}, o resultado do seu exame *{{2}}* está pronto.

Aceda ao resultado aqui (link válido por 72h):
{{3}}

Questões? Responda a esta mensagem.
```

### `health_plan_expiring`
```
⚠️ Plano de Saúde — Aviso de Renovação

Olá {{1}}, o seu *{{2}}* expira em *{{3}} dias* ({{4}}).

Para renovar responda *RENOVAR* ou contacte a recepção.

Mais Saúde CV
```

---

## 3. Bot FSM States

```
IDLE → MENU → [BOOK_SERVICE | EXAM_STATUS | HEALTH_PLAN | AGENT_REQUEST]
                     │
              BOOK_SERVICE → SELECT_SPECIALTY → SELECT_DOCTOR →
                             SELECT_DATE → SELECT_TIME → CONFIRM_PATIENT →
                             CONFIRM_BOOKING → DONE
```

---

## 4. Main Menu Flow

**Trigger:** Any inbound message from an unrecognised number, or keyword `menu` / `oi` / `olá` / `hello`

```
Bot → Patient:
━━━━━━━━━━━━━━━━━━━━━━━━
Bem-vindo(a) à Mais Saúde CV! 👋

Como posso ajudar?

1️⃣ Marcar consulta ou exame
2️⃣ Resultado de exames
3️⃣ Plano de saúde
4️⃣ Falar com a equipa
0️⃣ Informações gerais
━━━━━━━━━━━━━━━━━━━━━━━━

[Interactive List or numbered text]
```

**State:** `MENU`

---

## 5. Flow 1 — Book Appointment

### Step 1: Service Category

**Trigger:** Patient replies `1`

```
Bot:
Que tipo de serviço pretende?

1️⃣ Consulta médica
2️⃣ Exame diagnóstico
3️⃣ Ultrassonografia
4️⃣ Consulta dentária
5️⃣ Visita domiciliária
```

**State:** `BOOK_SERVICE`

---

### Step 2: Select Specialty (if Consultation)

**Trigger:** Patient replies `1`

```
Bot:
Escolha a especialidade:

1️⃣ Cardiologia
2️⃣ Pediatria
3️⃣ Ginecologia
4️⃣ Oftalmologia
5️⃣ Outra (encaminha para equipa)
```

**State:** `BOOK_SPECIALTY`

---

### Step 3: Select Doctor

**Trigger:** Patient selects specialty
API call → `GET /appointments/availability?service_id=...&date_from=today`

```
Bot:
Médicos disponíveis para *Cardiologia*:

1️⃣ Dr. João Andrade — próxima vaga: amanhã às 09:00
2️⃣ Dra. Ana Ferreira — próxima vaga: 16 Jun às 14:00
3️⃣ Sem preferência (primeiro disponível)
```

**State:** `BOOK_DOCTOR`

---

### Step 4: Select Date

```
Bot:
Datas disponíveis com Dr. João Andrade:

1️⃣ Hoje, 15 Jun — 14:30, 16:00
2️⃣ Amanhã, 16 Jun — 09:00, 10:30, 15:00
3️⃣ Quarta, 17 Jun — 09:00, 11:00
4️⃣ Ver mais datas
```

**State:** `BOOK_DATE`

---

### Step 5: Select Time

**Trigger:** Patient selects date

```
Bot:
Horários disponíveis a 16 Jun com Dr. João Andrade:

1️⃣ 09:00
2️⃣ 10:30
3️⃣ 15:00
```

**State:** `BOOK_TIME`

---

### Step 6: Patient Identification

**Trigger:** Patient selects time slot
Check Redis: `patient_phone_map:{phone}` → patient_id

**If returning patient:**
```
Bot:
Confirmo a marcação para:

👤 Maria da Silva
📅 16 Jun às 09:00
👨‍⚕️ Dr. João Andrade — Cardiologia

Confirmar? (Sim / Não)
```

**If new patient:**
```
Bot:
Para concluir a marcação, preciso de alguns dados:

📝 Qual é o seu nome completo?
```
→ collect name, then:
```
📅 Data de nascimento? (ex: 15/03/1985)
```
**State:** `BOOK_NEW_PATIENT`

---

### Step 7: Booking Confirmation

**Trigger:** Patient replies `Sim` / `1`
API call → `POST /appointments`
Send `appointment_confirmation` template

```
Bot:
✅ Consulta marcada com sucesso!

Receberá um lembrete 24h antes.
Para cancelar a qualquer momento, responda *CANCELAR*.

Obrigado por escolher a Mais Saúde CV! 🏥
```

**State:** `IDLE`

**If patient replies `Não`:**
```
Bot:
Sem problema. Quer escolher outra data ou voltar ao menu principal?

1️⃣ Escolher outra data
2️⃣ Menu principal
```

---

## 6. Flow 2 — Exam Results

**Trigger:** Patient replies `2` from main menu
API call → `GET /exam-requests?patient_id=...&status=resulted`

**If results available:**
```
Bot:
Tem *1 resultado* disponível:

🧪 ECG — Dr. João Andrade — 12 Jun 2026

Enviar o link para download? (Sim / Não)
```

On `Sim`:
API call → generate download token
```
Bot:
Aqui está o seu resultado:

🔗 https://files.maissaudecv.com/results/{token}

⚠️ Link válido por 72 horas.
Guarde ou faça download agora.
```

**If no results:**
```
Bot:
Não encontrámos resultados recentes para o seu número.

Para mais informações fale com a nossa equipa:
4️⃣ Falar com a equipa
```

---

## 7. Flow 3 — Health Plan

**Trigger:** Patient replies `3` from main menu
API call → `GET /health-plans?patient_id=...`

**If active plan:**
```
Bot:
O seu plano de saúde:

📋 *Plano Familiar*
✅ Estado: Activo
📅 Validade: 31 Dez 2026
💊 Consultas usadas: 3/6
🔬 Exames usados: 1/3

O que pretende?

1️⃣ Marcar consulta incluída no plano
2️⃣ Ver detalhes do plano
3️⃣ Falar com a equipa sobre renovação
```

**If no plan:**
```
Bot:
Não encontrámos um plano activo associado a este número.

Deseja saber mais sobre os nossos planos?

1️⃣ Plano Familiar
2️⃣ Plano Empresarial
3️⃣ Falar com a equipa
```

---

## 8. Flow 4 — Agent Handoff

**Trigger:** Patient replies `4` from main menu, or types `humano`, `ajuda`, `atendente`, or cannot complete a flow

```
Bot:
A encaminhar para a nossa equipa... ⏳

Um momento, por favor. A equipa será notificada.

⏰ Horário de atendimento: Segunda–Sexta 08:00–18:00, Sábado 08:00–13:00

Fora do horário? Deixe a sua mensagem e responderemos assim que possível.
```

**FSM action:**
1. Set conversation `status → agent`
2. POST to agent inbox webhook
3. Assign to first available receptionist (round-robin)
4. Agent sees full conversation history in inbox UI

**After-hours auto-response:**
```
Bot:
Obrigado pela mensagem! 🏥

Estamos fora do horário de atendimento.
⏰ Horário: Segunda–Sexta 08:00–18:00 · Sábado 08:00–13:00

Para emergências médicas ligue: +238 522 42 00

Responderemos à sua mensagem logo que abrirmos. ✅
```

---

## 9. Flow 5 — Appointment Confirmation Reply

**Trigger:** Patient replies `SIM` to a reminder template

API call → `PATCH /appointments/:id` `{ status: "confirmed" }`

```
Bot:
✅ Consulta confirmada!

📅 {{date}} às {{time}}
👨‍⚕️ {{doctor}} — {{specialty}}
📍 Mais Saúde CV, Palmarejo, Praia

Até breve! 😊
```

**Trigger:** Patient replies `NÃO` to a reminder

```
Bot:
Compreendido. O que pretende fazer?

1️⃣ Reagendar para outra data
2️⃣ Cancelar a consulta
3️⃣ Falar com a equipa
```

---

## 10. Flow 6 — Cancellation

**Trigger:** Patient types `CANCELAR` at any time

API call → check for active upcoming appointments

```
Bot:
Tem a seguinte consulta marcada:

📅 16 Jun às 09:00 — Dr. João Andrade (Cardiologia)

Confirma o cancelamento? (Sim / Não)
```

On `Sim`:
API call → `PATCH /appointments/:id` `{ status: "cancelled" }`
Send `appointment_cancelled` template

```
Bot:
✅ Consulta cancelada.

Se desejar reagendar, responda *1* ou visite maissaudecv.com

Obrigado — esperamos vê-lo(a) em breve! 🏥
```

---

## 11. Fallback & Error Handling

**Unrecognised input (3 consecutive):**
```
Bot:
Não compreendi a sua mensagem. 🤔

Escreva *MENU* para ver as opções, ou *4* para falar com a nossa equipa.
```

**API error / slot taken:**
```
Bot:
Pedimos desculpa, ocorreu um problema ao processar o seu pedido.

Por favor tente novamente ou fale connosco:
4️⃣ Falar com a equipa
```

**Session timeout (30 min inactivity):**
FSM state cleared from Redis. Next message starts fresh from MENU.

---

## 12. Keywords (Always Available)

| Keyword | Action |
|---|---|
| `menu`, `oi`, `olá`, `inicio` | Return to main menu |
| `ajuda`, `help` | Show help text |
| `cancelar` | Start cancellation flow |
| `humano`, `atendente`, `agent` | Immediate agent handoff |
| `sim`, `yes`, `1` | Confirm current action |
| `não`, `no`, `2` | Decline / go back |

---

## 13. Bot State Machine (Technical)

```typescript
// Redis key: wa_bot_state:{phone_number}
// TTL: 30 minutes (reset on each message)

interface BotState {
  state: 'IDLE' | 'MENU' | 'BOOK_SERVICE' | 'BOOK_SPECIALTY' |
         'BOOK_DOCTOR' | 'BOOK_DATE' | 'BOOK_TIME' |
         'BOOK_NEW_PATIENT' | 'EXAM_FLOW' | 'PLAN_FLOW' | 'AGENT';
  data: {
    patient_id?: string;
    service_id?: string;
    staff_id?: string;
    selected_date?: string;
    selected_time?: string;
    new_patient_name?: string;
    conversation_id?: string;
  };
  step: number;
  updated_at: string;
}
```

---

## 14. Agent Inbox Features

Staff see:

- Patient name and phone number
- Full conversation history (bot + human messages)
- Quick-reply templates
- Link to patient CRM profile
- Appointment booking shortcut within inbox
- SLA timer (target: < 30 min during clinic hours)
- Mark as resolved / transfer to another agent

---

*CAP 360 · WhatsApp Bot Flows v1.1 · updated 2026-08-30 — design reference only, not implemented*
