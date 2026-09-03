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

const API = "http://localhost:4001/v1";

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
  const staffId: string = (await staffRes.json())[0].id;
  const serviceId: string = (await svcRes.json())[0].id;

  // Minute varies per run so a prior run's own appointment (left behind if it failed before
  // afterAll's cleanup, same as this repo's other e2e debris) can never 409-block this one.
  const apptDate = new Date();
  apptDate.setDate(apptDate.getDate() + 4);
  apptDate.setHours(11, Date.now() % 50, 0, 0);

  const ar = await request.post(`${API}/appointments`, {
    data: { patientId, staffId, serviceId, scheduledAt: apptDate.toISOString(), source: "web" },
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
  await page.getByRole("button", { name: "Lista" }).click();

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

  await modal.getByRole("button", { name: "Concluída" }).click();
  await expect(modal.getByText("Concluída")).toBeVisible();

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
