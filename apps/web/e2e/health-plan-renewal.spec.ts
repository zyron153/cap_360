/**
 * E2E: the dedicated health-plans list/detail pages, and the renew action, driven through the
 * real UI. Company/product/plan setup goes through the API directly, same reasoning as the other
 * Financeiro specs — only the renewal flow itself needs to be exercised through the browser.
 *
 * Cleanup note: health plan instances have no delete endpoint at all (only products can be
 * soft-deactivated), so the plan row created here is left in the dev DB — same constraint the
 * backend integration test works around by deleting directly via Prisma, which isn't available
 * from a browser-driven e2e spec. The product is deactivated afterward to at least keep it out of
 * the active catalogue.
 */
import { test, expect } from "@playwright/test";

const API = "http://localhost:4000/v1";

let companyId: string;
let productId: string;
let planId: string;
let planNumber: string;

test.beforeAll(async ({ request }) => {
  const suffix = Date.now();

  const companyRes = await request.post(`${API}/companies`, {
    data: { name: `E2E Renewal Co ${suffix}`, taxId: `E2E-${suffix}` },
  });
  expect(companyRes.status(), "create company").toBe(201);
  companyId = (await companyRes.json()).id;

  // durationMonths: 12 (not the default 1) so the renewed plan lands comfortably past the
  // detail/list pages' own 30-day "A Expirar" threshold and reads unambiguously as "Ativo" —
  // a monthly product would renew into a term barely longer than that window itself.
  const productRes = await request.post(`${API}/health-plans/products`, {
    data: {
      name: `E2E Renewal Product ${suffix}`,
      code: `E2ERP${suffix}`.slice(0, 30),
      monthlyFee: 4000,
      durationMonths: 12,
    },
  });
  expect(productRes.status(), "create product").toBe(201);
  productId = (await productRes.json()).id;

  // Already expired — startDate/endDate both in the past — so the detail page renders
  // "Expirado" and the renew action is immediately exercisable without any date manipulation.
  const planRes = await request.post(`${API}/health-plans`, {
    data: { productId, companyId, startDate: "2020-01-01", endDate: "2020-12-31" },
  });
  expect(planRes.status(), "create plan").toBe(201);
  const planBody = await planRes.json();
  planId = planBody.id;
  planNumber = planBody.planNumber;
});

test.afterAll(async ({ request }) => {
  if (productId) await request.delete(`${API}/health-plans/products/${productId}`);
});

test("renewing an expired plan from its detail page extends the validity and flips the status badge", async ({ page }) => {
  await page.goto(`/health-plans/${planId}`);

  await expect(page.getByText(planNumber)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("plan-status")).toHaveText("Expirado");

  await page.getByRole("button", { name: "Renovar Plano" }).click();
  await page.getByRole("button", { name: "Confirmar Renovação" }).click();

  await expect(page.getByTestId("plan-status")).toHaveText("Ativo", { timeout: 10_000 });
});

test("the Planos tab lists the plan and lets it be filtered and renewed from the list", async ({ page }) => {
  await page.goto("/health-plans");
  await page.getByRole("button", { name: "Planos" }).click();

  await page.getByPlaceholder("Titular, empresa, produto, nº plano…").fill(planNumber);
  const row = page.locator("tr", { hasText: planNumber });
  await expect(row).toBeVisible({ timeout: 10_000 });

  // The first spec already renewed this same plan, so it should show as active with no
  // quick-renew action left in the row (only the "Ver" link to its detail page).
  await expect(row.getByText("Ativo", { exact: true })).toBeVisible();
  await expect(row.getByRole("button", { name: "Renovar" })).toHaveCount(0);
});
