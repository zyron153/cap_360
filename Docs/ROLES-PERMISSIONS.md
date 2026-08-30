# CAP 360 — Roles & Permissions (RBAC)

> **Auth Provider:** Keycloak (self-hosted), realm `cap` (not `maissaude` — renamed in the
> Cabo Verde rebrand)
> Roles are assigned per user in Keycloak and embedded in the JWT `realm_access.roles` claim.
> All API routes are guarded by `RolesGuard` in NestJS.

> **Implementation status:** the actual RBAC is **coarse, route-level `@Roles()` guards** — one
> role list per controller/route, checked against the JWT. None of the fine-grained distinctions
> below ("assigned only", "own schedule", per-field/tag visibility, row-level company scoping) are
> real unless explicitly called out — a role either can or cannot call a given route, in full. Every
> row referencing M3 (WhatsApp), M5 (Exams), M7 (Clinical Records), M9 (Home Visits), or M10
> (Analytics) describes access to **features that don't exist at all** (see those modules' own
> docs) — those rows are pure fiction, not a permissions gap.

---

## 1. Role Definitions

| Role ID | Display Name | Description |
|---|---|---|
| `patient` | Paciente | Self-service portal: book, view results, manage own plan |
| `receptionist` | Recepcionista | Front-desk: schedule, check-in, billing, WhatsApp inbox |
| `doctor` | Médico | Clinical: own schedule, write notes, prescriptions, referrals |
| `nurse` | Enfermeira / Técnico | Exams, home visits, results upload, assigned tasks only |
| `lab_tech` | Técnico de Laboratório | Exam worklist and result upload only |
| `admin` | Administrador | Full access to all modules, settings, staff management |
| `corporate_hr` | RH Empresarial | Corporate health plan admin for their company only |

---

## 2. Module-Level Access Matrix

✅ Full access · 📖 Read-only · 🔒 No access · ✏️ Limited write

| Module | patient | receptionist | doctor | nurse | lab_tech | admin | corporate_hr |
|---|---|---|---|---|---|---|---|
| M1 – Appointments | ✅ own | ✅ all | ✅ own | 📖 assigned | 🔒 | ✅ all | 🔒 |
| M2 – Patient CRM | 📖 own | ✅ no-clinical | 📖 clinical | 📖 assigned | 🔒 | ✅ all | 🔒 |
| M3 – WhatsApp Inbox | ✅ own msgs | ✅ full | 📖 | 📖 | 🔒 | ✅ full | 🔒 |
| M4 – Health Plans | 📖 own | ✅ view/assign | 📖 | 🔒 | 🔒 | ✅ full | ✅ own company |
| M5 – Exams & Results | 📖 own | ✅ request | 📖+request | ✅ upload | ✅ worklist+upload | ✅ full | 🔒 |
| M6 – Billing | 📖 own invoices | ✅ create/collect | 📖 | 🔒 | 🔒 | ✅ full | 📖 company bills |
| M7 – Clinical Records | 🔒 | 📖 summary only | ✅ own patients | ✅ assigned | 🔒 | 📖 no-edit | 🔒 |
| M8 – Staff Scheduler | 🔒 | 📖 | 📖 own shifts | 📖 own shifts | 📖 own shifts | ✅ full | 🔒 |
| M9 – Home Visits | ✅ request | ✅ assign | 📖 assigned | ✅ assigned | 🔒 | ✅ full | 🔒 |
| M10 – Analytics | 🔒 | 📖 basic | 📖 own stats | 🔒 | 🔒 | ✅ full | 📖 plan usage |
| Settings / Config | 🔒 | 🔒 | 🔒 | 🔒 | 🔒 | ✅ full | 🔒 |

---

## 3. Detailed Action-Level Permissions

### 3.1 Appointments (M1)

| Action | patient | receptionist | doctor | nurse | lab_tech | admin |
|---|---|---|---|---|---|---|
| Create appointment (self) | ✅ | ✅ | ✅ | 🔒 | 🔒 | ✅ |
| Create appointment (others) | 🔒 | ✅ | ✅ own schedule | 🔒 | 🔒 | ✅ |
| View appointment list | own only | all | own schedule | assigned | 🔒 | all |
| Update appointment status | cancel own | ✅ | check-in/complete | 🔒 | 🔒 | ✅ |
| Drag-and-drop reschedule | 🔒 | ✅ | own schedule | 🔒 | 🔒 | ✅ |
| View full calendar | 🔒 | ✅ | own view | 🔒 | 🔒 | ✅ |
| Manage waitlist | 🔒 | ✅ | 🔒 | 🔒 | 🔒 | ✅ |
| Configure reminder sequences | 🔒 | 🔒 | 🔒 | 🔒 | 🔒 | ✅ |

### 3.2 Patient CRM (M2)

| Action | patient | receptionist | doctor | nurse | lab_tech | admin |
|---|---|---|---|---|---|---|
| View own profile | ✅ | — | — | — | — | — |
| Create patient record | 🔒 | ✅ | 🔒 | 🔒 | 🔒 | ✅ |
| Edit patient demographics | 🔒 | ✅ | 🔒 | 🔒 | 🔒 | ✅ |
| View clinical history | 🔒 | summary only | ✅ | assigned visits | 🔒 | ✅ |
| Add manual notes | 🔒 | ✅ | ✅ | ✅ | 🔒 | ✅ |
| Upload documents | 🔒 | ✅ | ✅ | ✅ | ✅ | ✅ |
| View communication log | own | ✅ | 🔒 | 🔒 | 🔒 | ✅ |
| Assign tags | 🔒 | ✅ | ✅ | 🔒 | 🔒 | ✅ |
| Delete patient record | 🔒 | 🔒 | 🔒 | 🔒 | 🔒 | ✅ (soft) |

### 3.3 Clinical Records (M7)

| Action | patient | receptionist | doctor | nurse | lab_tech | admin |
|---|---|---|---|---|---|---|
| View clinical notes | 🔒 | summary only | own patients | assigned visits | 🔒 | read (no edit) |
| Create SOAP note | 🔒 | 🔒 | ✅ (own patients) | 🔒 | 🔒 | 🔒 |
| Lock note | 🔒 | 🔒 | ✅ auto after 24h | 🔒 | 🔒 | 🔒 |
| Create prescription | 🔒 | 🔒 | ✅ | 🔒 | 🔒 | 🔒 |
| Create referral | 🔒 | 🔒 | ✅ | 🔒 | 🔒 | 🔒 |

### 3.4 Billing (M6)

| Action | patient | receptionist | doctor | nurse | lab_tech | admin |
|---|---|---|---|---|---|---|
| View own invoices | ✅ | — | — | — | — | — |
| Create invoice | 🔒 | ✅ | 🔒 | 🔒 | 🔒 | ✅ |
| Record payment | 🔒 | ✅ | 🔒 | 🔒 | 🔒 | ✅ |
| Issue credit/refund | 🔒 | 🔒 | 🔒 | 🔒 | 🔒 | ✅ |
| View revenue reports | 🔒 | 🔒 | own consultations | 🔒 | 🔒 | ✅ |
| Export to Excel/PDF | 🔒 | 🔒 | 🔒 | 🔒 | 🔒 | ✅ |

---

## 4. Data Isolation Rules

### 4.1 Clinical Data Isolation

❌ **Not real.** M7 (clinical notes) doesn't exist (see its module doc). What does exist —
`patient_notes` on the Patient CRM — is visible identically to admin, receptionist, doctor, *and*
nurse; there is no "assigned patients only" filter for any role, and no 24h lock/admin-unlock
mechanism.

### 4.2 Corporate HR Isolation

❌ **Not enforced — confirmed gap.** `GET /health-plans?companyId=...` takes the company ID as a
**caller-supplied query parameter**, not one derived from the JWT. A `corporate_hr` user can pass
any `companyId` (or omit it) and read subscription data for **any** company, not just their own.
There is no membership/utilisation data to isolate in the first place (§3.2 of `M4-health-plan-management.md`),
and no billing-scope restriction either.

### 4.3 Patient Self-Service Isolation

✅ **Real.** `GET /patients/me` resolves strictly from the JWT's own `patient_id` claim — a patient
cannot pass an arbitrary ID to read another patient's record this way. ❌ Exam result download
tokens: moot, M5 has no result/download feature at all.

---

## 5. Keycloak Configuration

🟡 This section is illustrative and has not been re-verified line-by-line against the live realm
export (`infra/cap-realm.json`) — treat specific field values below with caution. The realm name
itself is confirmed real.

### 5.1 Realm: `cap`

```json
{
  "realm": "cap",
  "enabled": true,
  "internationalizationEnabled": true,
  "supportedLocales": ["pt", "en"],
  "defaultLocale": "pt",
  "passwordPolicy": "length(10) and upperCase(1) and digits(1)",
  "bruteForceProtected": true,
  "failureFactor": 5,
  "waitIncrementSeconds": 60
}
```

### 5.2 Client: `api-server`

```json
{
  "clientId": "api-server",
  "protocol": "openid-connect",
  "publicClient": false,
  "directAccessGrantsEnabled": false,
  "serviceAccountsEnabled": true,
  "authorizationServicesEnabled": true
}
```

### 5.3 Client: `web-app`

```json
{
  "clientId": "web-app",
  "protocol": "openid-connect",
  "publicClient": true,
  "redirectUris": [
    "https://app.maissaudecv.com/*",
    "https://maissaudecv.com/*"
  ],
  "webOrigins": ["+"]
}
```

### 5.4 Role Mapper

Each role in Keycloak maps to a NestJS guard check:

```typescript
// NestJS decorator usage
@Roles('doctor', 'admin')
@Get('/patients/:id/clinical-notes')
getClinicalNotes(@Param('id') patientId: string) { ... }
```

---

## 6. MFA Policy

🟡 Not verified as actually configured in the realm — dev-environment Keycloak has event logging
disabled entirely (see `SECURITY.md`), and no MFA-related code or config was found during this
review.


| Role | MFA Required | Method |
|---|---|---|
| admin | ✅ Mandatory | TOTP (Google Authenticator) |
| doctor | ✅ Mandatory | TOTP |
| receptionist | 🔶 Recommended | TOTP |
| nurse / lab_tech | 🔶 Recommended | TOTP |
| patient | 🔷 Optional | SMS OTP |
| corporate_hr | ✅ Mandatory | TOTP |

---

*CAP 360 · Roles & Permissions v1.1 · updated 2026-08-30 against the current implementation*
