/**
 * E2E: recording a payment with the "Plano de Saúde" method, driven through the real UI.
 *
 * Every other Financeiro e2e spec that records a payment leaves the method on its default
 * ("Numerário"/cash) — none of them touch the method <select> at all. This only covers the
 * existing payment-recording behavior for that method (it's just another value of the
 * `PaymentMethod` enum as far as `POST /invoices/:id/payments` is concerned); it does NOT cover
 * health-plan co-pay/discount calculation or `HealthPlan.usageCount` incrementing, since neither
 * exists yet for invoice payments (see PROGRESS.md's M6 backlog) — there is nothing to assert on.
 *
 * Invoice creation goes through the API directly, same reasoning as invoice-cancellation.spec.ts.
 */
import { test, expect } from "@playwright/test";

const API = "http://localhost:4000/v1";

let patientId: string;
let invoiceId: string;

test.beforeAll(async ({ request }) => {
  const pr = await request.post(`${API}/patients`, {
    data: {
      fullName: "E2E Plano Saude Teste",
      dateOfBirth: "1982-05-14",
      gender: "female",
      phone: `+23895${String(Date.now()).slice(-5)}`,
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

test("recording a payment with the health-plan method pays off the invoice and labels the payment", async ({ page }) => {
  await page.goto(`/billing/${invoiceId}`);
  await expect(page.locator("h1").filter({ hasText: /INV-/ })).toBeVisible({ timeout: 10_000 });

  const form = page.locator("form", { hasText: "Registar Pagamento" });
  await form.getByRole("combobox").selectOption({ label: "Plano de Saúde" });
  await form.getByRole("button", { name: "Registar Pagamento" }).click();

  await expect(page.getByText("Paga", { exact: true })).toBeVisible();
  await expect(page.getByText("Pagamentos Registados")).toBeVisible();
  // The payment-history line renders the raw PaymentMethod enum value (`method.replace("_", " ")`,
  // CSS-capitalized), not the form's PT-PT dropdown label — so "health plan", not "Plano de Saúde".
  await expect(page.getByText(/health plan/i)).toBeVisible();
});
