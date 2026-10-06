/**
 * E2E: cancelling an issued invoice through the real UI, plus a look at the E-Factura panel that
 * sits right next to the cancel button on every invoice detail page.
 *
 * Nothing else in the e2e suite exercises "Cancelar Fatura" — booking-flow/checkin-payment/
 * manual-invoice-payment all walk an invoice to `paid`, never to `cancelled`. The E-Factura
 * assertion here is deliberately narrow: this dev environment has no `integration_efatura`
 * Setting configured (no sandbox credentials), so `EFaturaProcessor.handleSubmit` always leaves
 * the submission on `pending` (see `efatura.processor.ts`) — that's the one E-Factura state this
 * suite can assert on deterministically without reaching a real (or sandbox) tax-authority API.
 *
 * Invoice creation goes through the API directly — the manual-creation form itself is already
 * covered by manual-invoice-payment.spec.ts — so this spec's UI interaction is the cancellation
 * flow alone.
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

test.beforeAll(async ({ request }) => {
  const pr = await request.post(`${API}/patients`, {
    data: {
      fullName: "E2E Cancelamento Teste",
      dateOfBirth: "1979-11-02",
      gender: "male",
      phone: `+23896${String(Date.now()).slice(-5)}`,
      consentGiven: true,
    },
  });
  expect(pr.status(), "create patient").toBe(201);
  patientId = (await pr.json()).id;

  const svcRes = await request.get(`${API}/services`);
  const services = (await svcRes.json()) as { id: string; name: string; price: string }[];
  const service = services[0];

  const invRes = await request.post(`${API}/invoices`, {
    data: {
      patientId,
      items: [{ serviceId: service.id, description: service.name, quantity: 1, unitPrice: Number(service.price) }],
    },
  });
  expect(invRes.status(), "create invoice").toBe(201);
  invoiceId = (await invRes.json()).id;
});

// The test cancels the invoice itself; a run that failed first has it cancelled here.
test.afterAll(async ({ request }) => {
  if (patientId) await cleanupPatient(request, patientId);
});

test("cancelling an issued invoice requires a reason and updates its status", async ({ page }) => {
  await page.goto(`/billing/${invoiceId}`);
  await expect(page.locator("h1").filter({ hasText: /INV-/ })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("Emitida", { exact: true })).toBeVisible();

  // A freshly-issued invoice with no E-Factura integration configured in this dev environment
  // sits on "Pendente" — the processor deliberately leaves it there rather than failing the job.
  await expect(page.getByText("E-Factura")).toBeVisible();
  await expect(page.getByText("Pendente", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Cancelar Fatura" }).click();

  // Confirming with an empty reason is disabled — the button itself gates on 3+ chars, so
  // confirm it doesn't fire the mutation rather than expecting a rendered validation message.
  const confirmButton = page.getByRole("button", { name: "Confirmar Cancelamento" });
  await expect(confirmButton).toBeDisabled();

  await page.getByPlaceholder("Motivo do cancelamento (obrigatório)…").fill("Paciente pediu cancelamento por engano.");
  await expect(confirmButton).toBeEnabled();
  await confirmButton.click();

  await expect(page.getByText("Cancelada", { exact: true })).toBeVisible();
  await expect(page.getByText(/Paciente pediu cancelamento por engano\./)).toBeVisible();

  // A cancelled invoice can no longer be cancelled again or paid.
  await expect(page.getByRole("button", { name: "Cancelar Fatura" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Registar Pagamento" })).toHaveCount(0);
});
