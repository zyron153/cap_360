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

// The test pays the invoice (a paid invoice can't be cancelled or deleted, so it stays); a run that failed first has it cancelled here.
test.afterAll(async ({ request }) => {
  if (patientId) await cleanupPatient(request, patientId);
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
