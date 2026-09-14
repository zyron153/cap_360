/**
 * E2E: adding and removing health-plan members through the real detail-page UI, plus an explicit
 * check that the patient-list "Plano de Saúde" modal no longer offers a renew action — renewal now
 * lives only on the plan's own detail page (see health-plan-renewal.spec.ts).
 *
 * Company/product/plan/patient setup goes through the API directly, same reasoning as the other
 * Financeiro/health-plan specs — only the member add/remove flow itself needs the browser.
 */
import { test, expect } from "@playwright/test";

const API = "http://localhost:4000/v1";

let productId: string;
let planId: string;
let planNumber: string;
let memberPatientId: string;
let memberPatientName: string;
let solePatientId: string;

test.beforeAll(async ({ request }) => {
  const suffix = Date.now();

  const productRes = await request.post(`${API}/health-plans/products`, {
    data: { name: `E2E Members Product ${suffix}`, code: `E2EMP${suffix}`.slice(0, 30), monthlyFee: 4000 },
  });
  expect(productRes.status(), "create product").toBe(201);
  productId = (await productRes.json()).id;

  const patientRes = await request.post(`${API}/patients`, {
    data: {
      fullName: `E2E Membro Teste ${suffix}`,
      dateOfBirth: "1988-03-10",
      gender: "female",
      phone: `+23896${String(suffix).slice(-5)}`,
      consentGiven: true,
    },
  });
  expect(patientRes.status(), "create member patient").toBe(201);
  const patientBody = await patientRes.json();
  memberPatientId = patientBody.id;
  memberPatientName = patientBody.fullName;

  const solePatientRes = await request.post(`${API}/patients`, {
    data: {
      fullName: `E2E Titular Sozinho ${suffix}`,
      dateOfBirth: "1979-11-02",
      gender: "male",
      phone: `+23897${String(suffix).slice(-5)}`,
      consentGiven: true,
    },
  });
  expect(solePatientRes.status(), "create sole-plan patient").toBe(201);
  solePatientId = (await solePatientRes.json()).id;

  const planRes = await request.post(`${API}/health-plans`, {
    data: { productId, startDate: "2026-01-01", memberPatientIds: [solePatientId] },
  });
  expect(planRes.status(), "create plan").toBe(201);
  const planBody = await planRes.json();
  planId = planBody.id;
  planNumber = planBody.planNumber;
});

test.afterAll(async ({ request }) => {
  if (planId && memberPatientId) await request.delete(`${API}/health-plans/${planId}/members/${memberPatientId}`);
  if (solePatientId) await request.delete(`${API}/patients/${solePatientId}`);
  if (memberPatientId) await request.delete(`${API}/patients/${memberPatientId}`);
  if (productId) await request.delete(`${API}/health-plans/products/${productId}`);
});

test("adding and removing a member from the plan detail page updates the Membros list", async ({ page }) => {
  await page.goto(`/health-plans/${planId}`);
  await expect(page.getByText(planNumber)).toBeVisible({ timeout: 10_000 });

  await page.getByRole("button", { name: "Adicionar Membro" }).click();
  await page.getByPlaceholder("Nome, telefone ou NIF…").fill(memberPatientName);
  await page.getByRole("button", { name: memberPatientName }).click();

  await expect(page.getByText("Membro adicionado com sucesso!")).toBeVisible({ timeout: 10_000 });
  const memberRow = page.locator("div", { hasText: memberPatientName }).last();
  await expect(memberRow).toBeVisible();

  await page.getByRole("button", { name: "Remover" }).first().click();
  await page.getByRole("button", { name: "Confirmar" }).click();

  await expect(page.getByText("Membro removido com sucesso.")).toBeVisible({ timeout: 10_000 });
});

test("the patient-list plan modal has no Renovar action — renewal lives only on the detail page", async ({ page }) => {
  await page.goto("/patients");
  await page.getByPlaceholder("Pesquisar por nome, telefone ou NIF…").fill("E2E Titular Sozinho");
  const row = page.locator("tr", { hasText: "E2E Titular Sozinho" });
  await expect(row).toBeVisible({ timeout: 10_000 });
  await row.getByRole("button", { name: "Gerir Plano" }).click();

  await expect(page.getByText("Plano de Saúde", { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("button", { name: "Renovar" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Ver Plano" })).toBeVisible();
});
