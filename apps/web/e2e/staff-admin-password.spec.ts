/**
 * E2E: Gestão de Acesso → an admin sets a user's password, and can change it later.
 *
 * Driven through the real UI: the admin creates the user in the "Adicionar Utilizador" form (using
 * the "Gerar" button for the password), the new user logs in straight into the app (no forced
 * change), then the admin uses "Alterar senha" and the old password stops working.
 *
 * The dev stack runs with AUTH_BYPASS, which treats a browser with no login session as the seeded
 * admin — so `page` below is the admin. The user logs in from separate browser contexts so their
 * cookie doesn't leak into the admin's page. The 401 on the user's already-open session after an
 * admin password change (and the role checks) are covered against the real session pipeline, with no
 * bypass, by apps/api/test/integration/staff-admin-password.integration-spec.ts: here, a revoked
 * session would just fall back to the bypass admin.
 *
 * Cleanup: DELETE /staff/:id (soft-delete). The email is timestamped so a failed run's leftover
 * can't 409 a retry. /auth/login is throttled to 5/min per IP; this spec logs in 3 times.
 */
import { test, expect, type Browser } from "@playwright/test";

const API = "http://localhost:4000/v1";
const email = `e2e-admin-pw-${Date.now()}@example.com`;
const NEW_PASSWORD = "AdminChosen-9x";

test.afterAll(async ({ request }) => {
  const staff = (await request.get(`${API}/staff`).then((r) => r.json())) as { id: string; email: string }[];
  const staffId = staff.find((s) => s.email === email)?.id;
  if (staffId) await request.delete(`${API}/staff/${staffId}`).catch(() => {});
});

/** Logs in through the real login form in a fresh browser context (no bypass admin involved). */
async function loginInNewContext(browser: Browser, password: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  return { page, context };
}

test("admin creates a user with a generated password, the user logs in, the admin changes it", async ({ page, browser }) => {
  // ── Admin: create the user ───────────────────────────────────────────────
  await page.goto("/access");
  await page.getByRole("button", { name: "Adicionar Utilizador" }).click();
  await page.getByPlaceholder("Ex: Dra. Maria Silva").fill("E2E Senha Admin");
  await page.getByPlaceholder("+238 991 0000").fill("+2389912345");
  await page.getByPlaceholder("nome@cap.cv").fill(email);

  const rules = page.getByRole("list", { name: "Requisitos da palavra-passe" }).first();
  const passwordField = page.getByPlaceholder("Defina a palavra-passe");

  // The rules are listed up front, all unmet until something is typed.
  await expect(rules).toContainText("Pelo menos 10 caracteres");
  await expect(rules.getByText("(cumprido)")).toHaveCount(0);

  // "Gerar" fills a policy-compliant password and reveals it so the admin can read/copy it.
  await page.getByRole("button", { name: "Gerar" }).click();
  await expect(passwordField).toHaveAttribute("type", "text");
  const generated = await passwordField.inputValue();
  expect(generated.length).toBeGreaterThanOrEqual(10);
  await expect(rules.getByText("(cumprido)")).toHaveCount(3);
  await expect(page.getByPlaceholder("Repita a palavra-passe")).toHaveValue(generated);

  await page.getByRole("button", { name: "Criar Utilizador" }).click();
  const row = page.locator("div.px-5.py-3\\.5", { hasText: email });
  await expect(row).toBeVisible();
  await expect(row.getByText("Senha temporária")).toHaveCount(0); // no forced-change state exists any more

  // ── User: logs in with it, straight into the app ─────────────────────────
  const first = await loginInNewContext(browser, generated);
  await expect(first.page).toHaveURL(/\/dashboard/, { timeout: 30_000 }); // dev server may still be compiling
  await first.context.close();

  // ── Admin: "Alterar senha" ───────────────────────────────────────────────
  await row.getByRole("button", { name: "Alterar senha" }).click();
  await expect(page.getByRole("heading", { name: "Alterar senha" })).toBeVisible();
  await page.getByPlaceholder("Defina a palavra-passe").fill("fraca");
  await page.getByPlaceholder("Repita a palavra-passe").fill("fraca");
  await page.getByRole("button", { name: "Guardar palavra-passe" }).click();
  await expect(page.getByText("pelo menos 10 caracteres, uma maiúscula e um número")).toBeVisible();

  await page.getByPlaceholder("Defina a palavra-passe").fill(NEW_PASSWORD);
  await page.getByPlaceholder("Repita a palavra-passe").fill(NEW_PASSWORD);
  await page.getByRole("button", { name: "Guardar palavra-passe" }).click();
  await expect(page.getByText("Palavra-passe de E2E Senha Admin alterada")).toBeVisible();

  // ── User: the old password is dead, the new one works ────────────────────
  const old = await loginInNewContext(browser, generated);
  await expect(old.page.getByText("Email ou palavra-passe incorretos")).toBeVisible();
  await expect(old.page).toHaveURL(/\/login/);
  await old.context.close();

  const fresh = await loginInNewContext(browser, NEW_PASSWORD);
  await expect(fresh.page).toHaveURL(/\/dashboard/, { timeout: 30_000 });
  await fresh.context.close();
});
