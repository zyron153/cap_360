/**
 * E2E: the dashboard survives the 403s a doctor/nurse/lab_tech gets. `/api/health-plans` is admin/receptionist/
 * corporate_hr only (`/api/invoices` likewise), and the dashboard asks for both unconditionally. A 403 body is an
 * error object, not a list, so `healthPlans.filter` threw and `(app)/error.tsx` painted its "404 Página não
 * encontrada" screen right after login. The 403s are served by the test (AUTH_BYPASS makes every dev session the
 * admin, so the real API would answer 200); nothing here touches data.
 */
import { test, expect } from "@playwright/test";

test.use({ viewport: { width: 1280, height: 800 } });

test("dashboard renders (no 404 screen) when health-plans and invoices answer 403", async ({ page }) => {
  const forbidden = { statusCode: 403, message: "Forbidden resource", error: "Forbidden" };
  for (const pattern of ["**/api/health-plans*", "**/api/invoices*"]) {
    await page.route(pattern, (route) =>
      route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify(forbidden) }),
    );
  }

  // The card renders from its `[]` default before the 403 arrives, so asserting right after goto passes even on
  // the broken page; wait for the 403, then give React a beat to render it (the crash lands one render later).
  const plans = page.waitForResponse((r) => r.url().includes("/api/health-plans"));
  await page.goto("/dashboard");
  await plans;
  await page.waitForTimeout(1_500);

  await expect(page.getByText("Página não encontrada")).toHaveCount(0);
  await expect(page.getByText("Planos de Saúde Ativos")).toBeVisible();
  await expect(page.getByText("Pacientes Recentes")).toBeVisible();
});
