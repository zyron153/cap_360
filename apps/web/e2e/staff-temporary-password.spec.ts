/**
 * E2E: admin-created user → first login with the temporary password → forced to /change-password.
 *
 * The user is created through the API (same setup reasoning as booking-flow.spec.ts) and the two
 * screens a human actually uses — login and the change-password form — are driven through the UI.
 *
 * The dev stack runs with AUTH_BYPASS, which treats requests with no session as the seeded admin.
 * A real login cookie takes precedence over it (SessionAuthGuard), so the browser below is the new
 * user, not the admin, and a full password change works end to end. The 403 PASSWORD_CHANGE_REQUIRED
 * enforcement and admin reset are covered against the real session pipeline by
 * apps/api/test/integration/staff-temporary-password.integration-spec.ts.
 *
 * Cleanup: DELETE /staff/:id (soft-delete). The email is timestamped so a failed run's leftover
 * can't 409 a retry.
 *
 * None of this app's forms pair <label> with its input via htmlFor/id, so locators go by input
 * type / the show-hide buttons' accessible names rather than getByLabel.
 */
import { test, expect } from "@playwright/test";

const API = "http://localhost:4000/v1";
const email = `e2e-temp-pw-${Date.now()}@example.com`;
const NEW_PASSWORD = "MyOwnPass123";
let temporaryPassword: string;

// The two tests share one user: the second finishes the change the first only validates.
test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ request }) => {
  const res = await request.post(`${API}/staff`, {
    data: { fullName: "E2E Senha Temporaria", email, role: "receptionist" },
  });
  expect(res.status(), "create user").toBe(201);
  const body = (await res.json()) as { temporaryPassword: string };
  expect(body.temporaryPassword, "response carries the one-time temporary password").toBeTruthy();
  temporaryPassword = body.temporaryPassword;
});

test.afterAll(async ({ request }) => {
  const staff = (await request.get(`${API}/staff`).then((r) => r.json())) as { id: string; email: string }[];
  const staffId = staff.find((s) => s.email === email)?.id;
  if (staffId) await request.delete(`${API}/staff/${staffId}`).catch(() => {});
});

async function loginWith(page: import("@playwright/test").Page, password: string) {
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
}

test("first login lands on /change-password, which shows the rules up front and validates the new password", async ({ page }) => {
  await loginWith(page, temporaryPassword);

  await expect(page).toHaveURL(/\/change-password/);
  await expect(page.getByRole("heading", { name: "Defina a sua palavra-passe" })).toBeVisible();

  const newPasswordField = page.locator("input").nth(1);
  const rules = page.getByRole("list", { name: "Requisitos da palavra-passe" }).first();

  // The rules are visible before anything is typed, all still unmet…
  await expect(rules).toContainText("Pelo menos 10 caracteres");
  await expect(rules).toContainText("Uma letra maiúscula");
  await expect(rules).toContainText("Um número");
  await expect(rules.getByText("(cumprido)")).toHaveCount(0);

  // …and tick off as the user types (the "differs from temporary" rule needs the temporary one filled in).
  await page.locator("input").nth(0).fill(temporaryPassword);
  await newPasswordField.fill("MyOwnPass123");
  await expect(rules.getByText("(cumprido)")).toHaveCount(4); // length, uppercase, digit, differs from temporary

  // Show/hide, per field.
  await expect(newPasswordField).toHaveAttribute("type", "password");
  await page.getByRole("button", { name: "Mostrar nova palavra-passe" }).click();
  await expect(newPasswordField).toHaveAttribute("type", "text");
  await page.getByRole("button", { name: "Ocultar nova palavra-passe" }).click();
  await expect(newPasswordField).toHaveAttribute("type", "password");

  const passwords = page.locator("input"); // temporary, new, confirmation — in that order
  const submit = page.getByRole("button", { name: "Guardar e continuar" });
  const alert = page.locator("main").getByRole("alert"); // not Next's own route announcer, which is also role=alert

  // New password must differ from the temporary one…
  await passwords.nth(0).fill(temporaryPassword);
  await passwords.nth(1).fill(temporaryPassword);
  await passwords.nth(2).fill(temporaryPassword);
  await submit.click();
  await expect(alert).toContainText("tem de ser diferente da temporária");

  // …meet the policy…
  await passwords.nth(1).fill("curta");
  await passwords.nth(2).fill("curta");
  await submit.click();
  await expect(alert).toContainText("pelo menos 10 caracteres");

  // …and match its confirmation.
  await passwords.nth(1).fill(NEW_PASSWORD);
  await passwords.nth(2).fill("MyOwnPass124");
  await submit.click();
  await expect(alert).toContainText("não coincidem");

  await expect(page).toHaveURL(/\/change-password/);
});

test("changing the password completes the first login and the session is the new user's", async ({ page }) => {
  await loginWith(page, temporaryPassword);
  await expect(page).toHaveURL(/\/change-password/);

  const passwords = page.locator("input");
  await passwords.nth(0).fill(temporaryPassword);
  await passwords.nth(1).fill(NEW_PASSWORD);
  await passwords.nth(2).fill(NEW_PASSWORD);
  await page.getByRole("button", { name: "Guardar e continuar" }).click();

  await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 }); // dev server may still be compiling /dashboard

  // Regression: the dev bypass used to ignore the login cookie, so this resolved to the seeded
  // admin and "Palavra-passe atual incorreta" blocked the change above.
  const me = await page.request.get("/api/staff/me").then((r) => r.json());
  expect(me).toMatchObject({ email, mustChangePassword: false });
});
