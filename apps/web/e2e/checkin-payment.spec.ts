/**
 * E2E: check-in → completion → payment, driven through the real UI.
 *
 * booking-flow.spec.ts already covers patient pages, the billing detail page, and the receipt
 * endpoint — this one instead exercises the status-transition buttons on /appointments (a
 * pending appointment has never been walked through confirmed → checked_in → completed via the
 * UI anywhere else) and the "Registar Pagamento" form on the invoice page (booking-flow.spec.ts
 * pays via a raw API call). Setup/teardown via the API directly, same reasoning as that file.
 */
import { test, expect, type APIRequestContext, type APIResponse, type Page } from "@playwright/test";

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

type StaffRow = { id: string; role: string; availability?: { startTime: string; endTime: string }[] };
const minutesOf = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/** Books the next free slot, 4+ days out, of the doctor with the broadest weekly availability (falling back to the next
 * doctor when one has none free). A 409 means another spec (they can run in parallel) just took that slot: move on. */
async function bookNextFreeSlot(request: APIRequestContext, patientId: string): Promise<string> {
  const [staffRes, svcRes] = await Promise.all([request.get(`${API}/staff`), request.get(`${API}/services`)]);
  const doctors = ((await staffRes.json()) as StaffRow[])
    .filter((s) => s.role === "doctor")
    .map((s) => ({ id: s.id, weekly: (s.availability ?? []).reduce((n, a) => n + minutesOf(a.endTime) - minutesOf(a.startTime), 0) }))
    .filter((d) => d.weekly > 0)
    .sort((a, b) => b.weekly - a.weekly);
  const serviceId: string = (await svcRes.json())[0].id;
  for (const doctor of doctors) {
    for (let offset = 4; offset < 18; offset++) {
      const d = new Date();
      d.setDate(d.getDate() + offset);
      const slots: { available: boolean; start: string }[] = await request
        .get(`${API}/appointments/availability?serviceId=${serviceId}&staffId=${doctor.id}&date=${d.toISOString().slice(0, 10)}`)
        .then((r) => r.json());
      for (const slot of slots.filter((s) => s.available).slice(0, 6)) {
        const ar = await request.post(`${API}/appointments`, { data: { patientId, staffId: doctor.id, serviceId, scheduledAt: slot.start, source: "web" } });
        if (ar.status() === 201) return (await ar.json()).id;
        expect(ar.status(), "create appointment (only a just-taken slot may be skipped)").toBe(409);
      }
    }
  }
  throw new Error("no free slot for any doctor within 2 weeks — the dev calendar is used up (completed appointments keep their slots)");
}

/** Leaves nothing live behind. Open appointments are cancelled and unpaid invoices cancelled (no API deletes an invoice
 * or a completed appointment: those, and a paid invoice, stay attached to the erased patient), then the patient is erased. */
async function cleanupPatient(request: APIRequestContext, patientId: string, appointmentIds: (string | undefined)[] = []) {
  for (const id of appointmentIds) {
    if (!id) continue;
    const a = (await request.get(`${API}/appointments/${id}`).then((r) => r.json())) as { status: string };
    if (["pending", "confirmed", "checked_in"].includes(a.status)) {
      await must(`cancel appointment ${id}`, () => request.patch(`${API}/appointments/${id}/status`, { data: { status: "cancelled" } }));
    }
  }
  const invoices = (await request.get(`${API}/invoices?patientId=${patientId}&limit=100`).then((r) => r.json())) as { data: { id: string; status: string }[] };
  for (const inv of invoices.data) {
    if (!["paid", "cancelled"].includes(inv.status)) {
      await must(`cancel invoice ${inv.id}`, () => request.post(`${API}/invoices/${inv.id}/cancel`, { data: { reason: "Limpeza do teste E2E" } }));
    }
  }
  await must("erase the patient", () => request.delete(`${API}/patients/${patientId}`));
}

let patientId: string;
let appointmentId: string;
let invoiceId: string;

test.beforeAll(async ({ request }) => {
  const pr = await request.post(`${API}/patients`, {
    data: {
      fullName: "E2E CheckIn Teste",
      dateOfBirth: "1985-06-20",
      gender: "male",
      phone: `+23898${String(Date.now()).slice(-5)}`,
      consentGiven: true,
    },
  });
  expect(pr.status(), "create patient").toBe(201);
  patientId = (await pr.json()).id;

  // Needs a real doctor (StaffAvailability is enforced at booking time) and a real free slot: the availability endpoint decides.
  appointmentId = await bookNextFreeSlot(request, patientId);
});

// The first test completes the appointment (it can't be cancelled afterwards) and the second pays its invoice — both stay,
// attached to the erased patient (no API removes them); a run that failed earlier is cancelled/cancelled-out here.
test.afterAll(async ({ request }) => {
  if (patientId) await cleanupPatient(request, patientId, [appointmentId]);
});

test("walking a pending appointment through confirmed → checked_in → completed creates a payable invoice", async ({ page }) => {
  await page.goto("/appointments");
  // exact: true — a "Lista de Espera" tab button also matches "Lista" as a substring otherwise.
  await page.getByRole("button", { name: "Lista", exact: true }).click();

  // The row's own text isn't clickable — only its "Ver →" button (revealed on hover, but still
  // present/clickable off-hover) opens the detail modal.
  const row = page.locator("tr", { hasText: "E2E CheckIn Teste" });
  await row.getByRole("button", { name: "Ver →" }).click();
  // The shared Modal component sets no role="dialog" — its fixed/inset-0/z-50 wrapper is the
  // only one of those on this page at a time, so it's a safe, specific scope.
  const modal = page.locator("div.fixed.inset-0.z-50");
  await expect(modal.getByText("Pendente")).toBeVisible();

  await modal.getByRole("button", { name: "Confirmar" }).click();
  await expect(modal.getByText("Confirmada")).toBeVisible();

  await modal.getByRole("button", { name: "Check-in feito" }).click();
  await expect(modal.getByText("Presente")).toBeVisible();

  // "Concluída" only opens the duration-confirmation panel (added later, to derive the
  // auto-drafted invoice's price from the confirmed duration) — it doesn't fire the transition
  // itself. Accept the pre-filled scheduled duration via "Confirmar Conclusão".
  await modal.getByRole("button", { name: "Concluída" }).click();
  await modal.getByRole("button", { name: "Confirmar Conclusão" }).click();
  // Longer timeout: this PATCH also creates the draft invoice (+ health-plan discount lookup),
  // slower than the plain status-only transitions above.
  await expect(modal.getByText("Concluída")).toBeVisible({ timeout: 10_000 });

  // Give the async createDraft a moment to persist (mirrors booking-flow.spec.ts).
  await new Promise((r) => setTimeout(r, 500));
});

test("recording a payment through the invoice form marks it paid", async ({ page, request }) => {
  const billing = await request.get(`${API}/invoices?patientId=${patientId}&limit=20`);
  const { data } = (await billing.json()) as { data: { id: string; appointmentId: string }[] };
  const invoice = data.find((i) => i.appointmentId === appointmentId);
  expect(invoice, "auto-created draft invoice").toBeTruthy();
  invoiceId = invoice!.id;

  await page.goto(`/billing/${invoiceId}`);
  await expect(page.locator("h1").filter({ hasText: /INV-/ })).toBeVisible({ timeout: 10_000 });

  const form = page.locator("form", { hasText: "Registar Pagamento" });
  // Amount input defaults to the full amount due — pay it off in one go.
  await form.getByRole("button", { name: "Registar Pagamento" }).click();

  await expect(page.getByText("Paga", { exact: true })).toBeVisible();
});
