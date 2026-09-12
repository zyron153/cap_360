/**
 * E2E: check-in → completion → payment, driven through the real UI.
 *
 * booking-flow.spec.ts already covers patient pages, the billing detail page, and the receipt
 * endpoint — this one instead exercises the status-transition buttons on /appointments (a
 * pending appointment has never been walked through confirmed → checked_in → completed via the
 * UI anywhere else) and the "Registar Pagamento" form on the invoice page (booking-flow.spec.ts
 * pays via a raw API call). Setup/teardown via the API directly, same reasoning as that file.
 */
import { test, expect } from "@playwright/test";

const API = "http://localhost:4000/v1";

let patientId: string;
let appointmentId: string;
let invoiceId: string;

test.beforeAll(async ({ request }) => {
  const pr = await request.post(`${API}/patients`, {
    data: {
      fullName: "E2E CheckIn Teste",
      dateOfBirth: "1985-06-20",
      gender: "male",
      phone: `+23898${String(Date.now()).slice(-5)}`,
      consentGiven: true,
    },
  });
  expect(pr.status(), "create patient").toBe(201);
  patientId = (await pr.json()).id;

  const [staffRes, svcRes] = await Promise.all([
    request.get(`${API}/staff`),
    request.get(`${API}/services`),
  ]);
  const staff = await staffRes.json();
  // Needs a real doctor — StaffAvailability is enforced at booking time, and admin/receptionist/
  // etc. have none configured.
  const staffId: string = staff.find((s: { role: string }) => s.role === "doctor").id;
  const serviceId: string = (await svcRes.json())[0].id;

  // Ask the real availability endpoint for a slot within the next 2 weeks — same reasoning as
  // booking-flow.spec.ts: the doctor's configured hours are seed data, not something to hardcode
  // a guess about. Still varies per run so a prior run's own leftover appointment (left behind
  // if it failed before afterAll's cleanup, same as this repo's other e2e debris) never 409s this one.
  let scheduledAt: string | undefined;
  for (let offset = 4; offset < 18 && !scheduledAt; offset++) {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    const dateStr = d.toISOString().slice(0, 10);
    const slots = await request
      .get(`${API}/appointments/availability?serviceId=${serviceId}&staffId=${staffId}&date=${dateStr}`)
      .then((r) => r.json());
    scheduledAt = slots.find((s: { available: boolean; start: string }) => s.available)?.start;
  }
  expect(scheduledAt, "found an available slot for the doctor within 2 weeks").toBeTruthy();

  const ar = await request.post(`${API}/appointments`, {
    data: { patientId, staffId, serviceId, scheduledAt, source: "web" },
  });
  expect(ar.status(), "create appointment").toBe(201);
  appointmentId = (await ar.json()).id;
});

test.afterAll(async ({ request }) => {
  if (appointmentId) {
    await request.patch(`${API}/appointments/${appointmentId}/status`, {
      data: { status: "cancelled" },
    }).catch(() => {});
  }
  if (patientId) await request.delete(`${API}/patients/${patientId}`);
});

test("walking a pending appointment through confirmed → checked_in → completed creates a payable invoice", async ({ page }) => {
  await page.goto("/appointments");
  // exact: true — a "Lista de Espera" tab button also matches "Lista" as a substring otherwise.
  await page.getByRole("button", { name: "Lista", exact: true }).click();

  // The row's own text isn't clickable — only its "Ver →" button (revealed on hover, but still
  // present/clickable off-hover) opens the detail modal.
  const row = page.locator("tr", { hasText: "E2E CheckIn Teste" });
  await row.getByRole("button", { name: "Ver →" }).click();
  // The shared Modal component sets no role="dialog" — its fixed/inset-0/z-50 wrapper is the
  // only one of those on this page at a time, so it's a safe, specific scope.
  const modal = page.locator("div.fixed.inset-0.z-50");
  await expect(modal.getByText("Pendente")).toBeVisible();

  await modal.getByRole("button", { name: "Confirmar" }).click();
  await expect(modal.getByText("Confirmada")).toBeVisible();

  await modal.getByRole("button", { name: "Check-in feito" }).click();
  await expect(modal.getByText("Presente")).toBeVisible();

  // "Concluída" only opens the duration-confirmation panel (added later, to derive the
  // auto-drafted invoice's price from the confirmed duration) — it doesn't fire the transition
  // itself. Accept the pre-filled scheduled duration via "Confirmar Conclusão".
  await modal.getByRole("button", { name: "Concluída" }).click();
  await modal.getByRole("button", { name: "Confirmar Conclusão" }).click();
  // Longer timeout: this PATCH also creates the draft invoice (+ health-plan discount lookup),
  // slower than the plain status-only transitions above.
  await expect(modal.getByText("Concluída")).toBeVisible({ timeout: 10_000 });

  // Give the async createDraft a moment to persist (mirrors booking-flow.spec.ts).
  await new Promise((r) => setTimeout(r, 500));
});

test("recording a payment through the invoice form marks it paid", async ({ page, request }) => {
  const billing = await request.get(`${API}/invoices?patientId=${patientId}&limit=20`);
  const { data } = (await billing.json()) as { data: { id: string; appointmentId: string }[] };
  const invoice = data.find((i) => i.appointmentId === appointmentId);
  expect(invoice, "auto-created draft invoice").toBeTruthy();
  invoiceId = invoice!.id;

  await page.goto(`/billing/${invoiceId}`);
  await expect(page.locator("h1").filter({ hasText: /INV-/ })).toBeVisible({ timeout: 10_000 });

  const form = page.locator("form", { hasText: "Registar Pagamento" });
  // Amount input defaults to the full amount due — pay it off in one go.
  await form.getByRole("button", { name: "Registar Pagamento" }).click();

  await expect(page.getByText("Paga", { exact: true })).toBeVisible();
});
