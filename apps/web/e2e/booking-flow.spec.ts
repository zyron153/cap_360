/**
 * E2E: full booking + billing flow
 *
 * Uses the API directly for setup/teardown (faster and auth-independent)
 * and the browser for UI assertions. Auth bypass is active in dev (NODE_ENV !== "production").
 */
import { test, expect } from "@playwright/test";

const API = "http://localhost:4001/v1";

// IDs created during the run — shared across tests in this file
let patientId: string;
let appointmentId: string;
let invoiceId: string;

// ──────────────────────────────────────────────────────────────────────────────
// Setup: seed a patient and pick an existing staff + service
// ──────────────────────────────────────────────────────────────────────────────
test.beforeAll(async ({ request }) => {
  // Create patient
  const pr = await request.post(`${API}/patients`, {
    data: {
      fullName: "E2E Paciente Teste",
      dateOfBirth: "1990-01-15",
      gender: "female",
      phone: `+23899${String(Date.now()).slice(-5)}`,
      consentGiven: true,
    },
  });
  expect(pr.status(), "create patient").toBe(201);
  patientId = (await pr.json()).id;

  // Fetch first active staff + service (seeded in dev DB)
  const [staffRes, svcRes] = await Promise.all([
    request.get(`${API}/staff`),
    request.get(`${API}/services`),
  ]);
  const staff = await staffRes.json();
  const services = await svcRes.json();
  const staffId: string = staff[0].id;
  const serviceId: string = services[0].id;

  // Book appointment ~3 days out at 14:00 local, nudged off any weekend the clinic is closed —
  // a fixed +3 lands on a different weekday each time this runs and can hit a closed Sunday/Saturday.
  const apptDate = new Date();
  apptDate.setDate(apptDate.getDate() + 3);
  if (apptDate.getDay() === 0) apptDate.setDate(apptDate.getDate() + 1); // Sun -> Mon
  if (apptDate.getDay() === 6) apptDate.setDate(apptDate.getDate() + 2); // Sat -> Mon
  apptDate.setHours(14, 0, 0, 0);

  const ar = await request.post(`${API}/appointments`, {
    data: {
      patientId,
      staffId,
      serviceId,
      scheduledAt: apptDate.toISOString(),
      source: "web",
    },
  });
  expect(ar.status(), "create appointment").toBe(201);
  appointmentId = (await ar.json()).id;
});

// ──────────────────────────────────────────────────────────────────────────────
// Cleanup: soft-delete the patient (cascades to timeline)
// ──────────────────────────────────────────────────────────────────────────────
test.afterAll(async ({ request }) => {
  if (appointmentId) {
    await request.patch(`${API}/appointments/${appointmentId}/status`, {
      data: { status: "cancelled" },
    }).catch(() => {});
  }
  if (patientId) await request.delete(`${API}/patients/${patientId}`);
});

// ──────────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────────
test("patient profile page renders after creation", async ({ page }) => {
  await page.goto(`/patients/${patientId}`);
  await expect(page.getByText("E2E Paciente Teste")).toBeVisible();
  await expect(page.getByRole("link", { name: "Editar dados" })).toBeVisible();
});

test("edit patient page pre-fills and saves", async ({ page }) => {
  await page.goto(`/patients/${patientId}/edit`);
  const nameInput = page.getByLabel(/nome completo/i);
  await expect(nameInput).toHaveValue("E2E Paciente Teste");

  await nameInput.fill("E2E Paciente Editado");
  await page.getByRole("button", { name: /guardar/i }).click();

  // Should redirect back to profile
  await expect(page).toHaveURL(new RegExp(`/patients/${patientId}$`));
  await expect(page.getByText("E2E Paciente Editado")).toBeVisible();
});

test("mark appointment completed → invoice auto-created", async ({ request }) => {
  const res = await request.patch(`${API}/appointments/${appointmentId}/status`, {
    data: { status: "completed" },
  });
  expect(res.status(), "mark completed").toBe(200);

  // Give the async createDraft a moment to persist
  await new Promise((r) => setTimeout(r, 500));

  // Invoice should exist for this appointment (filter by patient since list has no appointmentId param)
  const billing = await request.get(`${API}/invoices?patientId=${patientId}&limit=20`);
  expect(billing.status()).toBe(200);
  const { data } = await billing.json() as { data: { id: string; appointmentId: string; status: string }[] };
  const autoInvoice = data.find((i) => i.appointmentId === appointmentId);
  expect(autoInvoice, "auto-created draft invoice").toBeTruthy();
  expect(autoInvoice!.status).toBe("draft");
  invoiceId = autoInvoice!.id;
});

test("record payment → invoice transitions to paid", async ({ request }) => {
  // First we need to know the invoice total — fetch it
  const invRes = await request.get(`${API}/invoices/${invoiceId}`);
  const inv = await invRes.json() as { total: string };
  const total = Number(inv.total);

  const pr = await request.post(`${API}/invoices/${invoiceId}/payments`, {
    data: { amount: total, method: "cash" },
  });
  expect(pr.status(), "record payment").toBe(201);

  const updated = await request.get(`${API}/invoices/${invoiceId}`);
  const updatedInv = await updated.json() as { status: string };
  expect(updatedInv.status).toBe("paid");
});

test("billing page shows the invoice", async ({ page }) => {
  await page.goto("/billing");
  // /billing lands on the Financeiro overview tab (charts, no invoice numbers) — Faturas is a
  // separate client-side tab, not its own route.
  await page.getByRole("button", { name: "Faturas" }).click();
  await expect(page.getByText("INV-").first()).toBeVisible();
});

test("invoice detail page renders", async ({ page }) => {
  expect(invoiceId, "invoiceId must be set from previous test").toBeTruthy();
  await page.goto(`/billing/${invoiceId}`);
  await expect(page.locator("h1").filter({ hasText: /INV-/ })).toBeVisible({ timeout: 10_000 });
});

test("receipt endpoint returns a URL", async ({ request }) => {
  expect(invoiceId, "invoiceId must be set from previous test").toBeTruthy();
  const res = await request.get(`${API}/invoices/${invoiceId}/receipt`);
  expect(res.status()).toBe(200);
  const body = await res.json() as { url: string };
  expect(body.url).toMatch(/^https?:\/\//);
});
