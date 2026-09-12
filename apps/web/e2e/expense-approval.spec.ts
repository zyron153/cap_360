/**
 * E2E: Despesa (expense) creation → admin approval, driven through the real UI on the Financeiro
 * → Despesas tab. Nothing else in this repo's e2e suite touches the expense-approval workflow at
 * all — the other Financeiro specs only cover the invoice/payment side.
 *
 * Cleanup via the API directly, same reasoning as the other specs — the created expense's id
 * isn't known up front (it's created through the modal form), so afterAll looks it up by its
 * timestamped description.
 */
import { test, expect } from "@playwright/test";

const API = "http://localhost:4000/v1";
const description = `E2E Despesa Teste ${Date.now()}`;

test.afterAll(async ({ request }) => {
  const list = (await request
    .get(`${API}/financeiro/despesas?limit=50`)
    .then((r) => r.json())) as { data: { id: string; description: string }[] };
  const expenseId = list.data.find((e) => e.description === description)?.id;
  if (expenseId) await request.delete(`${API}/financeiro/despesas/${expenseId}`).catch(() => {});
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
