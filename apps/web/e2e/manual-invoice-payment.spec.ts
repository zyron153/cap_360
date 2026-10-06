/**
 * E2E: manually-created invoice → partial payment → full payment → receipt, driven through the
 * real UI.
 *
 * Every other Financeiro e2e spec (booking-flow, checkin-payment) only exercises the
 * auto-generated draft invoice that appointment completion creates, and always pays it off in one
 * shot. Neither covers the "Nova Fatura" manual-creation form at /billing/new, nor a partial
 * payment leaving an invoice in `partially_paid` before a second payment closes it out — both are
 * exercised here. Setup/teardown via the API directly, same reasoning as those files.
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

let patientId: string;
let invoiceId: string;
let servicePrice: number;

test.beforeAll(async ({ request }) => {
  const pr = await request.post(`${API}/patients`, {
    data: {
      fullName: "E2E Fatura Manual Teste",
      dateOfBirth: "1988-03-10",
      gender: "female",
      phone: `+23897${String(Date.now()).slice(-5)}`,
      consentGiven: true,
    },
  });
  expect(pr.status(), "create patient").toBe(201);
  patientId = (await pr.json()).id;

  const svcRes = await request.get(`${API}/services`);
  const services = (await svcRes.json()) as { id: string; price: number }[];
  servicePrice = Number(services[0].price);
});

// The test pays the invoice off (a paid invoice stays); a run that failed midway has it cancelled here.
test.afterAll(async ({ request }) => {
  if (patientId) await cleanupPatient(request, patientId);
});

test("creating an invoice via the Nova Fatura form, then paying it off in two installments", async ({ page }) => {
  await page.goto("/billing/new");

  // Scoped to the form card — the sidebar has its own <select> (clinic/location switcher) that
  // otherwise wins `getByRole("combobox").first()`.
  const formCard = page.locator("div.max-w-2xl");
  await formCard.getByRole("combobox").first().selectOption({ label: "E2E Fatura Manual Teste" });
  // Second combobox in the form is the first line item's service picker.
  await formCard.getByRole("combobox").nth(1).selectOption({ index: 1 });

  await formCard.getByRole("button", { name: "Emitir Fatura" }).click();

  await expect(page).toHaveURL(/\/billing\/[0-9a-f-]+$/);
  invoiceId = page.url().split("/").pop()!;

  await expect(page.locator("h1").filter({ hasText: /INV-/ })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("Emitida", { exact: true })).toBeVisible();

  // Pay half up front — the invoice should land on "partially_paid", not "paid".
  const half = Math.floor(servicePrice / 2);
  const form = page.locator("form", { hasText: "Registar Pagamento" });
  const amountInput = form.locator('input[type="number"]').first();
  await amountInput.fill(String(half));
  await form.getByRole("button", { name: "Registar Pagamento" }).click();

  await expect(page.getByText("Pag. Parcial", { exact: true })).toBeVisible();
  await expect(page.getByText(/Em dívida/)).toBeVisible();

  // Pay the remainder. The amount input is uncontrolled and was just hand-filled with the first
  // installment above, so it does not auto-refresh to the new outstanding balance — fill it
  // explicitly rather than rely on its (stale) displayed value.
  const remaining = servicePrice - half;
  await amountInput.fill(String(remaining));
  await form.getByRole("button", { name: "Registar Pagamento" }).click();
  await expect(page.getByText("Paga", { exact: true })).toBeVisible();

  // Two separate payments should both be listed.
  await expect(page.getByText("Pagamentos Registados")).toBeVisible();
  await expect(page.locator("text=/\\+.*CVE/")).toHaveCount(2);
});

test("receipt PDF button opens a URL for the paid invoice", async ({ page }) => {
  expect(invoiceId, "invoiceId must be set from previous test").toBeTruthy();
  await page.goto(`/billing/${invoiceId}`);

  // Assert on the API response the button consumes rather than following the popup it opens —
  // in dev (no R2 configured) that URL is a non-resolving placeholder domain
  // (files.cap.cv, see billing.service.ts), so navigating to it always dead-ends on Chrome's
  // own error page regardless of whether the feature itself works correctly.
  const [response] = await Promise.all([
    page.waitForResponse((r) => r.url().includes(`/api/invoices/${invoiceId}/receipt`) && r.request().method() === "GET"),
    page.getByRole("button", { name: "Recibo PDF" }).click(),
  ]);
  const body = (await response.json()) as { url: string };
  expect(body.url).toMatch(/^https?:\/\//);
});
