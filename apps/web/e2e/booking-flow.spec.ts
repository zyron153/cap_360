/**
 * E2E: full booking + billing flow
 *
 * Uses the API directly for setup/teardown (faster and auth-independent)
 * and the browser for UI assertions. Auth bypass is active in dev (NODE_ENV !== "production").
 */
import { test, expect, type APIRequestContext, type APIResponse, type Page } from "@playwright/test";

// E2E_API points both the setup calls and the browser's /api traffic at a different API instance (e.g. one freshly
// built from the working tree); unset, it is the same API the web app proxies to.
const API = process.env.E2E_API ?? "http://localhost:4000/v1";

/** Redirects a page's /api traffic to E2E_API (a no-op when it is unset). */
async function shim(page: Page) {
  if (!process.env.E2E_API) return;
  await page.route("**/api/**", (route) =>
    route.continue({ url: route.request().url().replace(/^https?:\/\/[^/]+\/api\//, `${API}/`) }),
  );
}

test.beforeEach(async ({ page }) => shim(page));

/** Teardown that cannot hide a failure: a swallowed error here is how test patients used to leak. A throttled (429)
 * call is retried; `allow` lists statuses that are fine for this call (e.g. 404 for something the test already removed). */
async function must(label: string, call: () => Promise<APIResponse>, allow: number[] = []) {
  let r = await call();
  for (let i = 0; i < 3 && r.status() === 429; i++) {
    await new Promise((res) => setTimeout(res, 5_000));
    r = await call();
  }
  expect(r.ok() || allow.includes(r.status()), `cleanup: ${label} -> ${r.status()}`).toBeTruthy();
}

type StaffRow = { id: string; role: string; availability?: { startTime: string; endTime: string }[] };
const minutesOf = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/** Books the next free slot, 4+ days out, of the doctor with the broadest weekly availability (falling back to the next
 * doctor when one has none free). A 409 means another spec (they can run in parallel) just took that slot: move on. */
async function bookNextFreeSlot(request: APIRequestContext, patientId: string): Promise<string> {
  const [staffRes, svcRes] = await Promise.all([request.get(`${API}/staff`), request.get(`${API}/services`)]);
  const doctors = ((await staffRes.json()) as StaffRow[])
    .filter((s) => s.role === "doctor")
    .map((s) => ({ id: s.id, weekly: (s.availability ?? []).reduce((n, a) => n + minutesOf(a.endTime) - minutesOf(a.startTime), 0) }))
    .filter((d) => d.weekly > 0)
    .sort((a, b) => b.weekly - a.weekly);
  const serviceId: string = (await svcRes.json())[0].id;
  for (const doctor of doctors) {
    for (let offset = 4; offset < 18; offset++) {
      const d = new Date();
      d.setDate(d.getDate() + offset);
      const slots: { available: boolean; start: string }[] = await request
        .get(`${API}/appointments/availability?serviceId=${serviceId}&staffId=${doctor.id}&date=${d.toISOString().slice(0, 10)}`)
        .then((r) => r.json());
      for (const slot of slots.filter((s) => s.available).slice(0, 6)) {
        const ar = await request.post(`${API}/appointments`, { data: { patientId, staffId: doctor.id, serviceId, scheduledAt: slot.start, source: "web" } });
        if (ar.status() === 201) return (await ar.json()).id;
        expect(ar.status(), "create appointment (only a just-taken slot may be skipped)").toBe(409);
      }
    }
  }
  throw new Error("no free slot for any doctor within 2 weeks — the dev calendar is used up (completed appointments keep their slots)");
}

/** Leaves nothing live behind. Open appointments are cancelled and unpaid invoices cancelled (no API deletes an invoice
 * or a completed appointment: those, and a paid invoice, stay attached to the erased patient), then the patient is erased. */
async function cleanupPatient(request: APIRequestContext, patientId: string, appointmentIds: (string | undefined)[] = []) {
  for (const id of appointmentIds) {
    if (!id) continue;
    const a = (await request.get(`${API}/appointments/${id}`).then((r) => r.json())) as { status: string };
    if (["pending", "confirmed", "checked_in"].includes(a.status)) {
      await must(`cancel appointment ${id}`, () => request.patch(`${API}/appointments/${id}/status`, { data: { status: "cancelled" } }));
    }
  }
  const invoices = (await request.get(`${API}/invoices?patientId=${patientId}&limit=100`).then((r) => r.json())) as { data: { id: string; status: string }[] };
  for (const inv of invoices.data) {
    if (!["paid", "cancelled"].includes(inv.status)) {
      await must(`cancel invoice ${inv.id}`, () => request.post(`${API}/invoices/${inv.id}/cancel`, { data: { reason: "Limpeza do teste E2E" } }));
    }
  }
  await must("erase the patient", () => request.delete(`${API}/patients/${patientId}`));
}

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

  // The real availability endpoint (same one the booking UI uses) decides the slot — the doctors' configured hours are
  // seed data, not something this test should hardcode a guess about.
  appointmentId = await bookNextFreeSlot(request, patientId);
});

// ──────────────────────────────────────────────────────────────────────────────
// Cleanup: erase the patient. The appointment is completed by the third test (a completed appointment can't be
// cancelled) and its paid invoice stays — no API removes either; only the patient is erased.
// ──────────────────────────────────────────────────────────────────────────────
test.afterAll(async ({ request }) => {
  if (patientId) await cleanupPatient(request, patientId, [appointmentId]);
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
