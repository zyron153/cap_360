/**
 * E2E: Despesa (expense) creation → admin approval, driven through the real UI on the Financeiro
 * → Despesas tab. Nothing else in this repo's e2e suite touches the expense-approval workflow at
 * all — the other Financeiro specs only cover the invoice/payment side.
 *
 * Cleanup via the API directly, same reasoning as the other specs — the created expense's id
 * isn't known up front (it's created through the modal form), so afterAll looks it up by its
 * timestamped description.
 */
import { test, expect, type APIResponse, type Page } from "@playwright/test";

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
const description = `E2E Despesa Teste ${Date.now()}`;

test.afterAll(async ({ request }) => {
  const list = (await request
    .get(`${API}/financeiro/despesas?limit=50`)
    .then((r) => r.json())) as { data: { id: string; description: string }[] };
  const expenseId = list.data.find((e) => e.description === description)?.id;
  if (expenseId) await must("delete the expense", () => request.delete(`${API}/financeiro/despesas/${expenseId}`));
});

test("registering a new expense and approving it updates its status", async ({ page }) => {
  await page.goto("/billing");
  await page.getByRole("button", { name: "Despesas" }).click();

  await page.getByRole("button", { name: "Nova Despesa" }).click();
  await page.getByPlaceholder("Ex: Material de escritório").fill(description);
  await page.getByPlaceholder("Ex: Fornecimentos").fill("Manutenção");
  await page.getByPlaceholder("0").fill("1500");
  await page.getByRole("button", { name: "Registar Despesa" }).click();

  const row = page.locator("tr", { hasText: description });
  await expect(row).toBeVisible({ timeout: 10_000 });
  await expect(row.getByText("Pendente", { exact: true })).toBeVisible();

  await row.getByTitle("Aprovar").click();
  await expect(row.getByText("Aprovada", { exact: true })).toBeVisible();
});
