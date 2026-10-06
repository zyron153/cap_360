/**
 * E2E: the topbar is live, not decoration — the patient search finds and opens a patient, and the bell
 * lists real alerts (unconfirmed appointments in the next 7 days, active plans ending in the next 7 days).
 *
 * The search runs against the real API with a real patient (setup/teardown via the API). The bell's two
 * data queries are served by the test instead: whether the doctor has a free slot inside any given 7-day
 * window is a fact about the calendar, not about the topbar, and a test that depends on it fails for the
 * wrong reason. Desktop width: the search box is hidden below `md`.
 *
 * The setup helpers are inlined, like every other spec here: Playwright's loader can't import a sibling
 * module under every Node version this repo is run with ("context.conditions?.includes is not a function").
 * E2E_API points both the setup calls and the browser's /api traffic at a different API instance (e.g. one
 * freshly built from the working tree); unset, it is the same API the web app proxies to.
 */
import { test, expect, type APIRequestContext, type APIResponse, type Page } from "@playwright/test";

const API = process.env.E2E_API ?? "http://localhost:4000/v1";

async function shim(page: Page) {
  if (!process.env.E2E_API) return;
  await page.route("**/api/**", (route) =>
    route.continue({ url: route.request().url().replace(/^https?:\/\/[^/]+\/api\//, `${API}/`) }),
  );
}

test.use({ viewport: { width: 1280, height: 800 } });

let patientId: string;
const UNIQUE = `Topbar${Date.now().toString().slice(-6)}`;
const PATIENT = `E2E ${UNIQUE} Busca`;

test.beforeEach(async ({ page }) => shim(page));

test.beforeAll(async ({ request }: { request: APIRequestContext }) => {
  const r = await request.post(`${API}/patients`, {
    data: {
      fullName: PATIENT,
      dateOfBirth: "1985-06-20",
      gender: "female",
      phone: `+23897${Math.floor(10000 + Math.random() * 90000)}`, // +238 + 7 digits, random so two specs can't collide
      consentGiven: true,
    },
  });
  expect(r.status(), "create patient").toBe(201);
  patientId = (await r.json()).id;
});

/** Teardown that cannot hide a failure (a swallowed error is how test patients used to leak); a throttled (429) call is retried. */
async function must(label: string, call: () => Promise<APIResponse>) {
  let r = await call();
  for (let i = 0; i < 3 && r.status() === 429; i++) {
    await new Promise((res) => setTimeout(res, 5_000));
    r = await call();
  }
  expect(r.ok(), `cleanup: ${label} -> ${r.status()}`).toBeTruthy();
}

test.afterAll(async ({ request }: { request: APIRequestContext }) => {
  if (patientId) await must("erase the patient", () => request.delete(`${API}/patients/${patientId}`));
});

test("search finds a patient by name and opens their profile", async ({ page }) => {
  await page.goto("/dashboard");
  const search = page.getByRole("combobox", { name: "Abrir paciente" });
  await search.fill(UNIQUE);

  const option = page.getByRole("option", { name: new RegExp(PATIENT) });
  await expect(option).toBeVisible();
  await search.press("ArrowDown"); // keyboard: highlight stays on the (only) result…
  await search.press("Enter"); // …and Enter opens it
  await expect(page).toHaveURL(new RegExp(`/patients/${patientId}$`));
});

test("search says so when nobody matches", async ({ page }) => {
  await page.goto("/dashboard");
  await page.getByRole("combobox", { name: "Abrir paciente" }).fill("zzzz-ninguem-assim");
  await expect(page.getByText("Nenhum paciente encontrado.")).toBeVisible();
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("a search icon opens a bar over the topbar; a result opens the profile; Cancelar closes it", async ({ page }) => {
    await page.goto("/dashboard");
    const search = page.getByRole("combobox", { name: "Abrir paciente" });
    await expect(search).toBeHidden(); // no box in the topbar at this width — just the icon

    await page.getByRole("button", { name: "Abrir pesquisa de pacientes" }).click();
    await expect(search).toBeFocused();
    await search.fill(UNIQUE);
    await page.getByRole("option", { name: new RegExp(PATIENT) }).click();
    await expect(page).toHaveURL(new RegExp(`/patients/${patientId}$`));

    await page.goto("/dashboard");
    await page.getByRole("button", { name: "Abrir pesquisa de pacientes" }).click();
    await expect(search).toBeVisible();
    await page.getByRole("button", { name: "Cancelar" }).click();
    await expect(search).toBeHidden();
  });
});

// ─── the bell ─────────────────────────────────────────────────────────────────────────────────────

/** The same local-calendar day strings the topbar builds its queries from. */
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const inDays = (n: number) => ymd(new Date(Date.now() + n * 86_400_000));

/** Serve the topbar's two queries (and only those: the dashboard asks for appointments too). */
async function serveAlerts(page: Page, data: { appointments: { status: string }[]; plans: { active: boolean; endDate: string | null }[] }) {
  await page.route(/\/api\/appointments\?/, (route) =>
    route.request().url().includes(`to=${inDays(7)}`) ? route.fulfill({ json: data.appointments }) : route.fallback(),
  );
  await page.route(/\/api\/health-plans$/, (route) => route.fulfill({ json: data.plans }));
}

test("the bell lists the live alerts, counts only what belongs, and links to each page", async ({ page }) => {
  await serveAlerts(page, {
    appointments: [{ status: "pending" }, { status: "confirmed" }, { status: "pending" }, { status: "cancelled" }],
    plans: [
      { active: true, endDate: `${inDays(3)}T00:00:00.000Z` }, // ends this week → counted
      { active: true, endDate: `${inDays(30)}T00:00:00.000Z` }, // not this week
      { active: false, endDate: `${inDays(2)}T00:00:00.000Z` }, // already inactive
      { active: true, endDate: null }, // no end date
    ],
  });
  await page.goto("/dashboard");

  await page.getByRole("button", { name: "Alertas (2)" }).click();
  const appts = page.getByRole("link", { name: "2 marcações por confirmar (próximos 7 dias)" });
  const plans = page.getByRole("link", { name: "1 plano termina nos próximos 7 dias" });
  await expect(appts).toHaveAttribute("href", "/appointments");
  await expect(plans).toHaveAttribute("href", "/health-plans");

  await page.keyboard.press("Escape");
  await expect(appts).toBeHidden();
});

test("with nothing to chase the bell says so and shows no dot", async ({ page }) => {
  await serveAlerts(page, { appointments: [{ status: "confirmed" }], plans: [] });
  await page.goto("/dashboard");

  const bell = page.getByRole("button", { name: "Alertas", exact: true }); // no "(n)" when there are none
  // The button is in the server-rendered HTML before React is attached, and nothing here (unlike "Alertas (2)" above) waits
  // for data: a click that lands too early does nothing on a slow machine. Click only while closed, until it opens.
  await expect(async () => {
    if ((await bell.getAttribute("aria-expanded")) !== "true") await bell.click();
    await expect(page.getByText("Sem alertas.")).toBeVisible({ timeout: 3_000 });
  }).toPass();
  await expect(bell.locator("span.bg-red-500")).toHaveCount(0);
});
