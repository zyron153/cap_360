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
import { test, expect } from "@playwright/test";

const API = "http://localhost:4000/v1";

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

test.afterAll(async ({ request }) => {
  if (patientId) await request.delete(`${API}/patients/${patientId}`);
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
