/**
 * E2E: admin-created user → first login with the temporary password → forced to /change-password.
 *
 * The user is created through the API (same setup reasoning as booking-flow.spec.ts) and the two
 * screens a human actually uses — login and the change-password form — are driven through the UI.
 *
 * What this deliberately does NOT do: submit a valid password change. The dev stack runs with
 * AUTH_BYPASS, where every API request is treated as the seeded admin, so PATCH /staff/me/password
 * would be checked against the admin's password rather than the new user's. The real enforcement
 * (403 PASSWORD_CHANGE_REQUIRED, change → access restored, admin reset) is covered end-to-end
 * against the real session pipeline by apps/api/test/integration/staff-temporary-password.integration-spec.ts.
 *
 * Cleanup: DELETE /staff/:id (soft-delete). The email is timestamped so a failed run's leftover
 * can't 409 a retry.
 *
 * None of this app's forms pair <label> with its input via htmlFor/id, so locators go by input
 * type rather than getByLabel.
 */
import { test, expect } from "@playwright/test";

const API = "http://localhost:4000/v1";
const email = `e2e-temp-pw-${Date.now()}@example.com`;
let temporaryPassword: string;

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

test("logging in with a temporary password lands on the change-password screen, which validates the new password", async ({ page }) => {
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(temporaryPassword);
  await page.getByRole("button", { name: "Entrar" }).click();

  await expect(page).toHaveURL(/\/change-password/);
  await expect(page.getByRole("heading", { name: "Defina a sua palavra-passe" })).toBeVisible();

  const passwords = page.locator('input[type="password"]');
  const submit = page.getByRole("button", { name: "Guardar e continuar" });

  // New password must differ from the temporary one…
  await passwords.nth(0).fill(temporaryPassword);
  await passwords.nth(1).fill(temporaryPassword);
  await passwords.nth(2).fill(temporaryPassword);
  await submit.click();
  await expect(page.getByText("tem de ser diferente da temporária")).toBeVisible();

  // …meet the policy…
  await passwords.nth(1).fill("curta");
  await passwords.nth(2).fill("curta");
  await submit.click();
  await expect(page.getByText("pelo menos 10 caracteres")).toBeVisible();

  // …and match its confirmation.
  await passwords.nth(1).fill("MyOwnPass123");
  await passwords.nth(2).fill("MyOwnPass124");
  await submit.click();
  await expect(page.getByText("não coincidem")).toBeVisible();

  await expect(page).toHaveURL(/\/change-password/);
});
