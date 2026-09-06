/**
 * E2E: staff invitation → activation → login, driven through the real UI for the two screens a
 * human actually uses (activation form, login form) and the API directly to send the invite —
 * same setup reasoning as booking-flow.spec.ts / checkin-payment.spec.ts.
 *
 * Cleanup: DELETE /staff/:id (soft-delete via deletedAt) — activation happens through the UI, so
 * the created staff id isn't known up front; afterAll looks it up by email instead. The email is
 * timestamped so a failed run's leftover (if cleanup itself never got to run) can't 409 a retry.
 *
 * None of this app's forms pair <label> with its input via htmlFor/id (checked activate + login
 * pages directly), so locators below go by input type/placeholder rather than getByLabel.
 */
import { test, expect } from "@playwright/test";

const API = "http://localhost:4000/v1";
const email = `e2e-invite-${Date.now()}@example.com`;
const password = "Sup3rSecret!";

test.afterAll(async ({ request }) => {
  const staff = (await request.get(`${API}/staff`).then((r) => r.json())) as { id: string; email: string }[];
  const staffId = staff.find((s) => s.email === email)?.id;
  if (staffId) await request.delete(`${API}/staff/${staffId}`).catch(() => {});
});

test("inviting a new staff member, activating the account, and logging in all work end-to-end", async ({ page, request }) => {
  const inviteRes = await request.post(`${API}/staff/invite`, {
    data: { fullName: "E2E Invite Teste", email, role: "receptionist" },
  });
  expect(inviteRes.status(), "create invite").toBe(201);
  const { token } = (await inviteRes.json()) as { token: string };
  expect(token, "invite response carries the activation token").toBeTruthy();

  await page.goto(`/activate?token=${token}`);
  await expect(page.getByText(email, { exact: true })).toBeVisible();

  const passwordInputs = page.locator('input[type="password"]');
  await passwordInputs.nth(0).fill(password);
  await passwordInputs.nth(1).fill(password);
  await page.getByRole("button", { name: "Ativar Conta" }).click();

  await expect(page).toHaveURL(/\/login\?activated=1/);

  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();

  await expect(page).toHaveURL(/\/dashboard/);
});
