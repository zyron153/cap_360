# CAP 360 — Roles & Permissions (RBAC)

> **Auth Provider:** none — self-hosted (Keycloak was removed 2026-08-31; see `SECURITY.md` §2).
> Roles are assigned per `Staff` row (`StaffRole` enum in Postgres) and captured into the Redis
> session at login time (`SessionService`) — not re-checked against the database per request, and
> not live-updated if a role changes mid-session (see below).
> All API routes are guarded by `RolesGuard` in NestJS.

> **Implementation status:** the actual RBAC is **coarse, route-level `@Roles()` guards** — one
> role list per controller/route, checked against the session. None of the fine-grained distinctions
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

## 5. How Roles Actually Reach a Guard Check

No realm, no client config, no external identity provider — this whole section used to describe a
Keycloak realm that has since been deleted (`infra/keycloak/`) and is not coming back. The real
flow:

1. `POST /auth/login` looks up the `Staff` row by email, verifies the password (argon2id), and
   builds a session object `{ staffId, email, roles: [staff.role] }` — a **single-element roles
   array**, since each `Staff` row has exactly one `StaffRole`, not a set of roles
2. `SessionService.create()` stores that object in Redis under a random session id, returned to
   the browser as the `cap_session` cookie
3. On every subsequent request, `SessionAuthGuard` reads the cookie, looks up the session in
   Redis, and sets `request.user = { sub: staffId, email, roles }`
4. `RolesGuard` reads `request.user.roles` and checks it against the route's `@Roles(...)` list:

```typescript
// Real, current guard check — apps/api/src/common/guards/roles.guard.ts
const userRoles: string[] = user?.roles ?? [];
return requiredRoles.some((role) => userRoles.includes(role));
```

```typescript
// Real, current decorator usage — apps/api/src/modules/patients/patients.controller.ts
@Roles("admin", "receptionist", "doctor", "nurse")
@Get(":id")
findOne(@Param("id", ParseUUIDPipe) id: string) { ... }
```

Because the role is captured once at login and never re-checked against Postgres, changing a
staff member's role (`PATCH /staff/:id`) doesn't take effect until they log out and back in — a
real, if minor, operational gotcha worth knowing.

---

## 6. MFA Policy

❌ **Not implemented at all**, for any role — see `SECURITY.md` §2.3. The table below is the
original design's target, kept only for reference; it assumed a Keycloak-provided mechanism that
no longer exists and has no replacement.

| Role | MFA Required | Method |
|---|---|---|
| admin | ✅ Mandatory | TOTP (Google Authenticator) |
| doctor | ✅ Mandatory | TOTP |
| receptionist | 🔶 Recommended | TOTP |
| nurse / lab_tech | 🔶 Recommended | TOTP |
| patient | 🔷 Optional | SMS OTP |
| corporate_hr | ✅ Mandatory | TOTP |

---

*CAP 360 · Roles & Permissions v1.2 · updated 2026-08-31 — Keycloak removed, self-hosted auth*
