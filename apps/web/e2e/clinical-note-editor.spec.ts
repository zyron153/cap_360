/**
 * E2E: the note editor and the day queue under the conditions a doctor really meets — the API failing mid-note, a
 * typo in the duration, a locked note, a risk alert, the clinic's own quick phrases, keyboard-only use, double clicks,
 * leaving mid-save, a phone — plus the day queue itself. Every test here pins a defect found while sweeping the module.
 *
 * Setup/teardown via the API directly (helpers inlined: Playwright's loader can't import a sibling module under every
 * Node version this repo is run with). E2E_API points both the setup calls and the browser's /api traffic at a different
 * API instance (e.g. one freshly built from the working tree); unset, it is the same API the web app proxies to.
 *
 * Where the doctor's role matters the browser serves /api/staff/me as a doctor (the dev bypass makes every session the
 * admin). The day queue needs an appointment dated TODAY: the test serves the queue's own request with a real
 * appointment moved to today (whether the dev doctor has a free slot today is a fact about the calendar, not the queue).
 *
 * Debris: drafts are discarded; the one finalized note (and the completed appointment with its cancelled invoice)
 * the queue test makes stays on the erased test patient — no API deletes them.
 */
import { test, expect, type APIRequestContext, type APIResponse, type Page } from "@playwright/test";

const API = process.env.E2E_API ?? "http://localhost:4000/v1";

async function shim(page: Page) {
  if (!process.env.E2E_API) return;
  await page.route("**/api/**", (route) =>
    route.continue({ url: route.request().url().replace(/^https?:\/\/[^/]+\/api\//, `${API}/`) }),
  );
}

async function must(label: string, call: () => Promise<APIResponse>) {
  let r = await call();
  for (let i = 0; i < 3 && r.status() === 429; i++) {
    await new Promise((res) => setTimeout(res, 5_000));
    r = await call();
  }
  expect(r.ok(), `cleanup: ${label} -> ${r.status()}`).toBeTruthy();
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

async function bookAppointment(request: APIRequestContext, patientId: string, checkIn: boolean): Promise<string> {
  const id = await bookNextFreeSlot(request, patientId);
  if (checkIn) {
    for (const status of ["confirmed", "checked_in"]) {
      const r = await request.patch(`${API}/appointments/${id}/status`, { data: { status } });
      expect(r.ok(), `-> ${status}`).toBeTruthy();
    }
  }
  return id;
}

const PATIENT = "E2E Editor Clinico";
let patientId: string;
let queueApptId: string;
let me: { id: string; fullName: string; role: string; email: string };

test.beforeEach(async ({ page }) => shim(page));

test.beforeAll(async ({ request }) => {
  const r = await request.post(`${API}/patients`, {
    data: {
      fullName: PATIENT, dateOfBirth: "1985-06-20", gender: "female",
      phone: `+23897${Math.floor(10000 + Math.random() * 90000)}`, consentGiven: true,
    },
  });
  expect(r.status(), "create patient").toBe(201);
  patientId = (await r.json()).id;
  queueApptId = await bookAppointment(request, patientId, true);
  me = await request.get(`${API}/staff/me`).then((x) => x.json());
});

test.afterAll(async ({ request }) => {
  if (!patientId) return;
  const notes = (await request.get(`${API}/patients/${patientId}/clinical-notes?limit=100`).then((r) => r.json())) as { id: string; finalizedAt: string | null }[];
  for (const n of notes.filter((x) => x.finalizedAt === null)) {
    await must(`discard draft ${n.id}`, () => request.delete(`${API}/clinical-notes/${n.id}`));
  }
  const a = (await request.get(`${API}/appointments/${queueApptId}`).then((r) => r.json())) as { status: string };
  if (["pending", "confirmed", "checked_in"].includes(a.status)) {
    await must("cancel the appointment", () => request.patch(`${API}/appointments/${queueApptId}/status`, { data: { status: "cancelled" } }));
  }
  const invoices = (await request.get(`${API}/invoices?patientId=${patientId}&limit=100`).then((r) => r.json())) as { data: { id: string; status: string }[] };
  for (const inv of invoices.data.filter((i) => !["paid", "cancelled"].includes(i.status))) {
    await must(`cancel invoice ${inv.id}`, () => request.post(`${API}/invoices/${inv.id}/cancel`, { data: { reason: "Limpeza do teste E2E" } }));
  }
  await must("erase the patient", () => request.delete(`${API}/patients/${patientId}`));
});

const field = (p: Page, name: string) => p.getByRole("textbox", { name, exact: true });
const asDoctor = (page: Page) => page.route("**/api/staff/me", (route) => route.fulfill({ json: { ...me, role: "doctor" } }));
const SECTIONS = { presentingConcerns: "Motivo", observations: "Observações", assessment: "Avaliação", plan: "Plano" };
const NOTES_URL = /\/api\/(clinical-notes(\/[0-9a-f-]+)?|patients\/[0-9a-f-]+\/clinical-notes)(\?.*)?$/;

async function newDraft(request: APIRequestContext, over: Record<string, unknown> = {}): Promise<{ id: string; updatedAt: string; finalizedAt: string | null }> {
  const r = await request.post(`${API}/patients/${patientId}/clinical-notes`, { data: { sessionType: "individual", ...SECTIONS, draft: true, ...over } });
  expect(r.status(), "create draft").toBe(201);
  return r.json();
}

// ─── the API failing under the doctor's hands ──────────────────────────────────────────────────────

test("when saving fails the text stays, the status says so with a retry, and leaving asks first", async ({ page, request }) => {
  const { id } = await newDraft(request);
  await page.goto(`/records/note?noteId=${id}&returnTo=/records`);
  await expect(field(page, "Plano")).toHaveValue(SECTIONS.plan);

  // The API starts answering 500 to note writes.
  await page.route(NOTES_URL, (route) =>
    ["PATCH", "POST"].includes(route.request().method()) ? route.fulfill({ status: 500, json: { message: "boom" } }) : route.fallback(),
  );
  await field(page, "Plano").fill("Plano escrito enquanto a API falha");
  const status = page.getByRole("status").filter({ hasText: "Não foi possível guardar o rascunho" });
  await expect(status).toBeVisible();
  await expect(status).toContainText("o texto continua aqui");
  await expect(field(page, "Plano")).toHaveValue("Plano escrito enquanto a API falha");

  // Leaving with text the server hasn't got: a confirmation (declined here — the doctor stays and keeps typing).
  const asked: string[] = [];
  page.once("dialog", (d) => { asked.push(d.message()); void d.dismiss(); });
  await page.getByRole("link", { name: "Voltar" }).click();
  await expect.poll(() => asked).toEqual(["Há texto por guardar que o servidor ainda não tem. Sair mesmo assim?"]);
  await expect(page).toHaveURL(/\/records\/note/);

  // The API recovers: the retry button saves exactly what is on screen.
  await page.unroute(NOTES_URL);
  await status.getByRole("button", { name: "Tentar novamente" }).click();
  await expect(page.getByText(/Rascunho guardado às/)).toBeVisible();
  expect((await request.get(`${API}/clinical-notes/${id}`).then((r) => r.json())).plan).toBe("Plano escrito enquanto a API falha");
});

test("a failed save is retried by itself when the browser comes back online", async ({ page, context, request }) => {
  const { id } = await newDraft(request);
  await page.goto(`/records/note?noteId=${id}`);
  await expect(field(page, "Plano")).toHaveValue(SECTIONS.plan);

  await context.setOffline(true);
  await field(page, "Plano").fill("Escrito sem rede");
  await expect(page.getByRole("status").filter({ hasText: "Não foi possível guardar o rascunho" })).toBeVisible();
  await context.setOffline(false);
  await expect(page.getByText(/Rascunho guardado às/)).toBeVisible();
  expect((await request.get(`${API}/clinical-notes/${id}`).then((r) => r.json())).plan).toBe("Escrito sem rede");
});

test("a duration typo can't stop the text from saving: it is flagged, left out of the save, and blocks finalizing", async ({ page, request }) => {
  const { id } = await newDraft(request, { durationMinutes: 50 });
  await page.goto(`/records/note?noteId=${id}`);
  const duration = page.getByRole("spinbutton", { name: /Duração/ });
  await expect(duration).toHaveValue("50");

  await duration.fill("700");
  await field(page, "Plano").fill("Plano com duração errada");
  await expect(page.getByText("Use um número inteiro de minutos, entre 1 e 600.")).toBeVisible();
  // The text still reaches the server (autosave drops the bad duration instead of failing the whole save)…
  await expect(page.getByText(/Rascunho guardado às/)).toBeVisible();
  const saved = await request.get(`${API}/clinical-notes/${id}`).then((r) => r.json());
  expect(saved.plan).toBe("Plano com duração errada");
  expect(saved.durationMinutes, "the previous valid duration stands").toBe(50);
  // …and the note can't be finalized with it.
  await expect(page.getByRole("button", { name: "Guardar nota" })).toBeDisabled();
  await duration.fill("45");
  await expect(page.getByText("Use um número inteiro de minutos")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Guardar nota" })).toBeEnabled();
});

// ─── what the page shows ───────────────────────────────────────────────────────────────────────────

test("a note finalized more than 24h ago is locked for its doctor: read-only, no save, a reason", async ({ page, request }) => {
  const { id } = await newDraft(request);
  const note = await request.get(`${API}/clinical-notes/${id}`).then((r) => r.json());
  const old = new Date(Date.now() - 30 * 3_600_000).toISOString();
  await asDoctor(page);
  await page.route(`**/api/clinical-notes/${id}`, (route) =>
    route.request().method() === "GET" ? route.fulfill({ json: { ...note, finalizedAt: old } }) : route.fallback(),
  );
  await page.goto(`/records/note?noteId=${id}`);
  await expect(page.getByText("Esta nota foi bloqueada 24h após ser finalizada")).toBeVisible();
  await expect(field(page, "Plano")).toBeDisabled();
  await expect(page.getByRole("button", { name: /Guardar/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Descartar rascunho" })).toHaveCount(0);
});

test("the risk alert quotes the last session when it was moderate or high; the clinic's quick phrases replace the suggested ones", async ({ page }) => {
  await page.route(`**/api/patients/${patientId}/clinical-notes*`, (route) =>
    route.request().method() === "GET"
      ? route.fulfill({
          json: [{
            id: "00000000-0000-4000-8000-0000000000c1", patientId, appointmentId: null, authorStaffId: me.id, author: { fullName: me.fullName },
            sessionType: "individual", durationMinutes: 50, ...SECTIONS, plan: "Plano da sessão anterior", riskLevel: "high", riskNotes: "Ideação passiva, acordado plano de segurança.",
            finalizedAt: "2026-09-01T10:00:00.000Z", createdAt: "2026-09-01T10:00:00.000Z", updatedAt: "2026-09-01T10:00:00.000Z",
          }],
        })
      : route.fallback(),
  );
  await page.route("**/api/parametrizacao/FRASE_PLANO", (route) => route.fulfill({ json: [{ id: "x1", grupo: "FRASE_PLANO", valor: "Frase do plano da clínica." }] }));
  await page.goto(`/records/note?patientId=${patientId}`);

  const alert = page.getByRole("alert").filter({ hasText: "Risco elevado" });
  await expect(alert).toContainText("Ideação passiva, acordado plano de segurança.");

  const plan = page.getByRole("toolbar", { name: "Frases rápidas — Plano" });
  await expect(plan.getByRole("button", { name: "+ Frase do plano da clínica." })).toBeVisible();
  await expect(plan.getByRole("button", { name: "+ Manter plano terapêutico." })).toHaveCount(0); // the suggested set steps aside
  await expect(plan.getByRole("button", { name: "+ Repetir plano anterior" })).toBeVisible();
  await plan.getByRole("button", { name: "+ Repetir plano anterior" }).click();
  await expect(field(page, "Plano")).toHaveValue("Plano da sessão anterior");
  await plan.getByRole("button", { name: "+ Frase do plano da clínica." }).click();
  await expect(field(page, "Plano")).toHaveValue("Plano da sessão anterior\nFrase do plano da clínica.");
  // A group with no entries of its own keeps the suggested phrases.
  await expect(page.getByRole("toolbar", { name: "Frases rápidas — Avaliação" }).getByRole("button", { name: "+ Evolução favorável face aos objetivos." })).toBeVisible();
});

test("a quick phrase that would pass the 3000-character limit is refused with a message instead of breaking the save", async ({ page }) => {
  await page.goto(`/records/note?patientId=${patientId}`);
  await field(page, "Plano").fill("x".repeat(2990));
  await page.getByRole("button", { name: "+ Manter acompanhamento semanal." }).click();
  await expect(page.getByRole("alert").filter({ hasText: "3000 caracteres" })).toBeVisible();
  await expect(field(page, "Plano")).toHaveValue("x".repeat(2990));
});

// ─── keyboard and screen reader ───────────────────────────────────────────────────────────────────

test("keyboard only: quick phrases are one tab stop each section, arrows move inside, the risk radios take arrows, Ctrl+Enter saves", async ({ page, request }) => {
  const { id } = await newDraft(request);
  await page.goto(`/records/note?noteId=${id}`);
  await expect(field(page, "Plano")).toHaveValue(SECTIONS.plan);

  // Motivo → one stop on its phrase toolbar → Observações (the phrases used to be 4–5 tab stops per section).
  await field(page, "Motivo / Estado apresentado").focus();
  await page.keyboard.press("Tab");
  const toolbar = page.getByRole("toolbar", { name: "Frases rápidas — Motivo / Estado apresentado" });
  const firstChip = toolbar.getByRole("button").first();
  await expect(firstChip).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(toolbar.getByRole("button").nth(1)).toBeFocused();
  await page.keyboard.press("Home");
  await expect(firstChip).toBeFocused();
  await page.keyboard.press("Enter"); // activates the phrase
  await expect(field(page, "Motivo / Estado apresentado")).toHaveValue(`${SECTIONS.presentingConcerns}\nSem queixas novas desde a última sessão.`);
  await page.keyboard.press("Tab");
  await expect(field(page, "Observações")).toBeFocused();

  // The risk level is a radio group: one tab stop, arrows change the selection.
  const none = page.getByRole("radio", { name: "Sem risco", exact: true });
  await expect(none).toHaveAttribute("aria-checked", "true");
  await none.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("radio", { name: "Baixo", exact: true })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("radio", { name: "Baixo", exact: true })).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(none).toHaveAttribute("aria-checked", "true");

  // Ctrl+Enter from a field saves (a complete draft is finalized and the page goes back).
  await field(page, "Plano").focus();
  await page.keyboard.press("Control+Enter");
  await expect.poll(async () => (await request.get(`${API}/clinical-notes/${id}`).then((r) => r.json())).finalizedAt).toBeTruthy();
});

test("the save status is one live region that is always there, so changes are announced", async ({ page, request }) => {
  const { id } = await newDraft(request);
  await page.goto(`/records/note?noteId=${id}`);
  // Matched on what stays the same ("rascunho"): the text itself changes from "O rascunho é guardado…" to "Rascunho guardado às…".
  const live = page.locator('[role="status"][aria-live="polite"]').filter({ hasText: /rascunho/i });
  await expect(live).toBeVisible();
  const handle = await live.elementHandle();
  await field(page, "Plano").fill("Plano novo");
  await expect(live).toContainText(/Rascunho guardado às/);
  // The same element changed its text (a region that is re-created together with its text is not announced).
  expect(await handle!.evaluate((el) => el.isConnected)).toBe(true);
});

// ─── double clicks and leaving mid-save ───────────────────────────────────────────────────────────

test("double-clicking Guardar nota finalizes once", async ({ page, request }) => {
  const { id } = await newDraft(request);
  let finalizes = 0;
  await page.route(NOTES_URL, (route) => {
    const r = route.request();
    if (r.method() === "PATCH" && r.postDataJSON()?.draft === false) finalizes++;
    return route.fallback();
  });
  await page.goto(`/records/note?noteId=${id}&returnTo=/records`);
  await expect(field(page, "Plano")).toHaveValue(SECTIONS.plan);
  await page.getByRole("button", { name: "Guardar nota" }).dblclick();
  await expect(page).toHaveURL((u) => u.pathname === "/records");
  expect(finalizes).toBe(1);
  expect((await request.get(`${API}/clinical-notes/${id}`).then((r) => r.json())).finalizedAt).toBeTruthy();
});

test("leaving through the Voltar link right after typing saves the text on the way out", async ({ page, request }) => {
  await page.goto(`/records/note?patientId=${patientId}&returnTo=/records`);
  await field(page, "Motivo / Estado apresentado").fill("Escrito e abandonado em menos de 1,5 s");
  await page.getByRole("link", { name: "Voltar" }).click(); // inside the autosave pause
  await expect(page).toHaveURL((u) => u.pathname === "/records");
  await expect
    .poll(async () => {
      const notes = (await request.get(`${API}/patients/${patientId}/clinical-notes?limit=100`).then((r) => r.json())) as { presentingConcerns: string }[];
      return notes.some((n) => n.presentingConcerns === "Escrito e abandonado em menos de 1,5 s");
    })
    .toBe(true);
});

// ─── the phone ────────────────────────────────────────────────────────────────────────────────────

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("the editor, the merge dialog and the discard dialog fit the screen", async ({ page, context, request }) => {
    const { id } = await newDraft(request);
    const url = `/records/note?noteId=${id}`;
    const tab2 = await context.newPage();
    await shim(tab2);
    await page.goto(url);
    await tab2.goto(url);
    await expect(field(page, "Plano")).toHaveValue(SECTIONS.plan);
    await expect(field(tab2, "Plano")).toHaveValue(SECTIONS.plan);
    const overflow = (p: Page) => p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(await overflow(page), "the editor scrolls sideways").toBeLessThanOrEqual(0);

    await field(page, "Plano").fill("Plano A");
    await expect(page.getByText(/Rascunho guardado às/)).toBeVisible();
    await field(tab2, "Plano").fill("Plano B");
    const dialog = tab2.getByRole("alertdialog", { name: "Juntar as duas versões da nota" });
    await expect(dialog).toBeVisible();
    const box = (await dialog.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    await expect(dialog.getByRole("button", { name: "Aplicar escolhas" })).toBeVisible();
    expect(await overflow(tab2)).toBeLessThanOrEqual(0);

    await dialog.getByRole("button", { name: "Decidir depois" }).click();
    await page.getByRole("button", { name: "Descartar rascunho" }).click();
    const discard = page.getByRole("alertdialog", { name: "Descartar rascunho?" });
    const b2 = (await discard.boundingBox())!;
    expect(b2.x).toBeGreaterThanOrEqual(0);
    expect(b2.x + b2.width).toBeLessThanOrEqual(390);
    await discard.getByRole("button", { name: "Cancelar" }).click();
  });
});

// ─── the day queue ────────────────────────────────────────────────────────────────────────────────

test("the day queue lists today's patients with their note state; Registar opens the editor; Concluir completes the consulta", async ({ page, request }) => {
  // The queue asks for today's appointments: serve the real checked-in one, dated today.
  const appt = await request.get(`${API}/appointments/${queueApptId}`).then((r) => r.json());
  const today = new Date();
  today.setHours(10, 0, 0, 0);
  const served = { ...appt, scheduledAt: today.toISOString() };
  let completed = false;
  await page.route(/\/api\/appointments\?/, (route) =>
    route.fulfill({ json: [completed ? { ...served, status: "completed" } : served] }),
  );

  await page.goto("/records");
  const row = page.locator("div", { hasText: PATIENT }).filter({ has: page.getByRole("link", { name: "Registar" }) }).last();
  await expect(row).toBeVisible();
  await expect(row).toContainText("Sem nota");
  await expect(page.getByRole("tab", { name: /Em consulta/ })).toContainText("1");

  await row.getByRole("link", { name: "Registar" }).click();
  await expect(page).toHaveURL(new RegExp(`/records/note\\?appointmentId=${queueApptId}`));
  for (const [k, v] of Object.entries({ "Motivo / Estado apresentado": "Motivo", Observações: "Obs", Avaliação: "Aval", Plano: "Plano" })) await field(page, k).fill(v);
  // Not finalized + the consulta is checked in: the primary action finalizes AND concludes.
  await page.route(/\/api\/appointments\/[0-9a-f-]+\/status/, (route) => { completed = true; return route.fallback(); });
  await page.getByRole("button", { name: "Guardar e concluir consulta" }).click();
  await expect(page).toHaveURL((u) => u.pathname === "/records");
  await expect.poll(async () => (await request.get(`${API}/appointments/${queueApptId}`).then((r) => r.json())).status).toBe("completed");

  // Back on the queue: the consulta moved to "Concluídas hoje" with its note state.
  await expect(page.getByRole("heading", { name: "Concluídas hoje" })).toBeVisible();
  await expect(page.getByText("Nota guardada")).toBeVisible();
  await expect(page.getByRole("link", { name: "Ver nota" })).toBeVisible();
});
