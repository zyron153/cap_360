/**
 * E2E: the doctor's clinical note, driven through the real UI — autosaved draft, resume after a
 * reload, finalize + conclude the consulta in one step, the history filters and paging, two tabs
 * saving the same note (joined section by section, a real conflict decided by the doctor, a note the
 * other tab finalized), discarding a draft, and a colleague's note opening read-only.
 *
 * Setup/teardown via the API directly (helpers inlined below). Cleanup discards every draft note the run
 * left (the paging test creates its 52 notes as drafts for exactly that reason) and cancels what can be
 * cancelled; a FINALIZED note can't be deleted by any API, so each run leaves a handful on the erased test
 * patient (the finalized ones: the one the first test writes, the colleague's, and the ones the
 * "other tab finalized it" tests need — about 4), plus the completed appointment and its paid/cancelled invoice.
 */
import { test, expect, type APIRequestContext, type APIResponse, type Page } from "@playwright/test";

// ── setup helpers — inlined, like every other spec here: Playwright's loader can't import a sibling
// module under every Node version this repo is run with ("context.conditions?.includes is not a function").
// E2E_API points both the setup calls and the browser's /api traffic at a different API instance (e.g. one
// freshly built from the working tree); unset, it is the same API the web app proxies to.
const API = process.env.E2E_API ?? "http://localhost:4000/v1";

/** Redirects a page's /api traffic to E2E_API (a no-op when it is unset). Call it for every page you open. */
async function shim(page: Page) {
  if (!process.env.E2E_API) return;
  await page.route("**/api/**", (route) =>
    route.continue({ url: route.request().url().replace(/^https?:\/\/[^/]+\/api\//, `${API}/`) }),
  );
}

async function createPatient(request: APIRequestContext, fullName: string): Promise<string> {
  const r = await request.post(`${API}/patients`, {
    data: {
      fullName,
      dateOfBirth: "1985-06-20",
      gender: "female",
      phone: `+23897${Math.floor(10000 + Math.random() * 90000)}`, // +238 + 7 digits, random so two specs can't collide
      consentGiven: true,
    },
  });
  expect(r.status(), "create patient").toBe(201);
  return (await r.json()).id;
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

/** Books a slot (see bookNextFreeSlot) and optionally walks it to `checked_in`. */
async function bookAppointment(request: APIRequestContext, patientId: string, opts: { checkIn?: boolean } = {}): Promise<string> {
  const id = await bookNextFreeSlot(request, patientId);
  if (opts.checkIn) {
    for (const status of ["confirmed", "checked_in"]) {
      const r = await request.patch(`${API}/appointments/${id}/status`, { data: { status } });
      expect(r.ok(), `-> ${status}`).toBeTruthy();
    }
  }
  return id;
}

/** Teardown that cannot hide a failure: a swallowed error here is how test patients used to leak. A throttled (429)
 * call is retried (the API allows 300 requests a minute per client, and the paging test alone sends 50+). */
async function must(label: string, call: () => Promise<APIResponse>) {
  let r = await call();
  for (let i = 0; i < 3 && r.status() === 429; i++) {
    await new Promise((res) => setTimeout(res, 5_000));
    r = await call();
  }
  expect(r.ok(), `cleanup: ${label} -> ${r.status()}`).toBeTruthy();
}

async function cleanup(request: APIRequestContext, opts: { appointmentIds?: (string | undefined)[]; patientId?: string }) {
  // Drafts can be discarded (finalized notes can't be deleted by anything).
  if (opts.patientId) {
    for (let page = 1; ; page++) {
      const notes = (await request.get(`${API}/patients/${opts.patientId}/clinical-notes?page=${page}&limit=100`).then((r) => r.json())) as { id: string; finalizedAt: string | null }[];
      for (const n of notes.filter((x) => x.finalizedAt === null)) {
        await must(`discard draft ${n.id}`, () => request.delete(`${API}/clinical-notes/${n.id}`));
      }
      if (notes.length < 100) break;
    }
  }
  for (const id of opts.appointmentIds ?? []) {
    if (!id) continue;
    const a = (await request.get(`${API}/appointments/${id}`).then((r) => r.json())) as { status: string };
    if (["pending", "confirmed", "checked_in"].includes(a.status)) {
      await must(`cancel appointment ${id}`, () => request.patch(`${API}/appointments/${id}/status`, { data: { status: "cancelled" } }));
    }
  }
  if (opts.patientId) {
    // Completing an appointment drafts its invoice; no API deletes an invoice, so an unpaid one is cancelled.
    const invoices = (await request.get(`${API}/invoices?patientId=${opts.patientId}&limit=100`).then((r) => r.json())) as { data: { id: string; status: string }[] };
    for (const inv of invoices.data.filter((i) => !["paid", "cancelled"].includes(i.status))) {
      await must(`cancel invoice ${inv.id}`, () => request.post(`${API}/invoices/${inv.id}/cancel`, { data: { reason: "Limpeza do teste E2E" } }));
    }
    await must("erase the patient", () => request.delete(`${API}/patients/${opts.patientId}`));
  }
}

let patientId: string;
let appointmentId: string;
let appointmentId2: string; // for the two-tab "create" race: needs an appointment with no note yet
const PATIENT = "E2E Nota Clinica Teste";

test.beforeEach(async ({ page }) => shim(page));

test.beforeAll(async ({ request }) => {
  patientId = await createPatient(request, PATIENT);
  appointmentId = await bookAppointment(request, patientId, { checkIn: true });
  appointmentId2 = await bookAppointment(request, patientId, { checkIn: true });
});

test.afterAll(async ({ request }) => {
  test.setTimeout(180_000); // 50+ drafts to discard one by one
  await cleanup(request, { appointmentIds: [appointmentId, appointmentId2], patientId });
});

const notesFor = (request: APIRequestContext) =>
  request.get(`${API}/clinical-notes?appointmentId=${appointmentId}`).then((r) => r.json());

const SECTIONS = { presentingConcerns: "Motivo v1", observations: "Observações v1", assessment: "Avaliação v1", plan: "Plano v1" };

/** A complete draft (all four sections, so it can be finalized) for a patient — the starting point of the two-tab tests. */
async function createDraft(request: APIRequestContext, over: Record<string, unknown> = {}): Promise<{ id: string; updatedAt: string }> {
  const r = await request.post(`${API}/patients/${patientId}/clinical-notes`, {
    data: { sessionType: "individual", ...SECTIONS, draft: true, ...over },
  });
  expect(r.status(), "create draft").toBe(201);
  return r.json();
}

test("autosaves a draft, resumes it after a reload, then finalizes and concludes the consulta in one step", async ({ page, request }) => {
  await page.goto(`/records/note?appointmentId=${appointmentId}`);
  await expect(page.getByRole("heading", { name: `Registo clínico — ${PATIENT}` })).toBeVisible();

  // Opening the page alone must not create an empty draft.
  expect(await notesFor(request)).toHaveLength(0);

  // Typing autosaves once it pauses — and the draft is linked to the appointment.
  const field = (name: string) => page.getByRole("textbox", { name, exact: true });
  const concerns = field("Motivo / Estado apresentado");
  await concerns.fill("Refere dificuldade em dormir.");
  await expect(page.getByText(/Rascunho guardado às/)).toBeVisible({ timeout: 10_000 });
  const [draft] = await notesFor(request);
  expect(draft.finalizedAt).toBeNull();
  expect(draft.presentingConcerns).toBe("Refere dificuldade em dormir.");
  expect(draft.appointmentId).toBe(appointmentId);

  // A reload resumes the same draft (no second one is created).
  await page.reload();
  await expect(field("Motivo / Estado apresentado")).toHaveValue("Refere dificuldade em dormir.");

  // Quick phrases append; the footer says what is still missing until the note is complete.
  await page.getByRole("button", { name: "+ Colaborante e orientado." }).click();
  await expect(field("Observações")).toHaveValue("Colaborante e orientado.");
  const conclude = page.getByRole("button", { name: "Guardar e concluir consulta" });
  await expect(conclude).toBeDisabled();
  await expect(page.getByText(/Para guardar falta: Avaliação, Plano/)).toBeVisible();

  await field("Avaliação").fill("Evolução favorável.");
  await field("Plano").fill("Manter acompanhamento semanal.");
  await expect(conclude).toBeEnabled();
  await conclude.click();

  // One click: note finalized, appointment completed, still a single note.
  await expect.poll(async () => (await notesFor(request)).map((n: { finalizedAt: string | null }) => n.finalizedAt !== null), { timeout: 15_000 }).toEqual([true]);
  await expect
    .poll(async () => (await request.get(`${API}/appointments/${appointmentId}`).then((r) => r.json())).status, { timeout: 15_000 })
    .toBe("completed");
});

test("history lists notes with their state and filters by it", async ({ page, request }) => {
  const draft = await request.post(`${API}/patients/${patientId}/clinical-notes`, {
    data: { sessionType: "individual", presentingConcerns: "Só o motivo por agora.", observations: "", assessment: "", plan: "", draft: true },
  });
  expect(draft.status()).toBe(201);

  await page.goto("/records");
  await page.getByRole("tab", { name: "Histórico" }).click();
  await page.getByLabel("Pesquisar paciente").fill("E2E Nota Clinica");

  const row = page.getByRole("link", { name: new RegExp(`${PATIENT}.*Rascunho`) });
  await expect(row.first()).toBeVisible();
  await expect(row.first()).toContainText("Só o motivo por agora.");

  // Only the draft carries the Rascunho badge; filtering to finalized notes drops it.
  await page.getByLabel("Filtrar por estado").selectOption("final");
  await expect(page.getByRole("link", { name: new RegExp(`${PATIENT}.*Rascunho`) })).toHaveCount(0);
  await page.getByLabel("Filtrar por estado").selectOption("draft");
  await expect(row.first()).toBeVisible();
});

test("history pages past the first 50 notes with 'Carregar mais'", async ({ page, request }) => {
  test.setTimeout(120_000);
  for (let i = 0; i < 52; i++) {
    // Drafts, so the run's cleanup can discard them (a finalized note can't be deleted).
    const r = await request.post(`${API}/patients/${patientId}/clinical-notes`, {
      data: { sessionType: "individual", presentingConcerns: `Nota ${i}`, observations: "o", assessment: "a", plan: "p", draft: true },
    });
    expect(r.status(), `create note ${i}`).toBe(201);
  }

  await page.goto("/records");
  await page.getByRole("tab", { name: "Histórico" }).click();
  // The search is debounced: wait for the *filtered* list before counting, or the unfiltered one
  // (whose newest 50 notes are also this patient's) satisfies the count and the filter then resets it.
  const filtered = page.waitForResponse((r) => r.url().includes("clinical-notes?") && r.url().includes("q=E2E"));
  await page.getByLabel("Pesquisar paciente").fill("E2E Nota Clinica");
  await filtered;

  const rows = page.getByRole("link", { name: new RegExp(PATIENT) });
  await expect(rows).toHaveCount(50);
  await page.getByRole("button", { name: "Carregar mais" }).click();
  // The rest arrive (this patient has 52 notes from this test plus the ones from the tests above)…
  await expect(rows).not.toHaveCount(50);
  expect(await rows.count()).toBeGreaterThanOrEqual(52);
  // …and with a short last page there is nothing more to load.
  await expect(page.getByRole("button", { name: "Carregar mais" })).toHaveCount(0);
});

// ─── two tabs saving the same note ────────────────────────────────────────────────────────────────

const field = (p: Page, name: string) => p.getByRole("textbox", { name, exact: true });
const concernsField = (p: Page) => field(p, "Motivo / Estado apresentado");
const conflictBanner = (p: Page) => p.getByRole("alert").filter({ hasText: "alterada noutro separador" });
const mergeDialog = (p: Page) => p.getByRole("alertdialog", { name: "Juntar as duas versões da nota" });
const mergeNotice = (p: Page) => p.getByRole("status").filter({ hasText: "juntada" });
const saved = (p: Page) => p.getByText(/Rascunho guardado às/);
const serverNote = (request: APIRequestContext, id: string) =>
  request.get(`${API}/clinical-notes/${id}`).then((r) => r.json()) as Promise<Record<string, string>>;

/** Opens the same draft in two tabs, both on the version in `SECTIONS`. */
async function twoTabs(page: Page, context: import("@playwright/test").BrowserContext, request: APIRequestContext) {
  const { id } = await createDraft(request);
  const url = `/records/note?noteId=${id}`;
  const tab2 = await context.newPage();
  await shim(tab2);
  await page.goto(url);
  await tab2.goto(url);
  await expect(field(page, "Plano")).toHaveValue(SECTIONS.plan);
  await expect(field(tab2, "Plano")).toHaveValue(SECTIONS.plan);
  return { id, tab2 };
}

test("two tabs that changed different sections are joined without asking, and both edits reach the server", async ({ page, context, request }) => {
  const { id, tab2 } = await twoTabs(page, context, request);

  // Tab 1 saves a new plan; tab 2, still on the old version, edits the observations and tries to autosave.
  await field(page, "Plano").fill("Plano do separador 1");
  await expect(saved(page)).toBeVisible();
  await field(tab2, "Observações").fill("Observações do separador 2");

  // No question: the plan arrives, the observations stay, and it says what it did.
  await expect(mergeNotice(tab2)).toContainText("2 secções juntadas automaticamente");
  await expect(mergeNotice(tab2)).toContainText("da versão guardada: Plano");
  await expect(mergeNotice(tab2)).toContainText("mantidas as suas: Observações");
  await expect(mergeDialog(tab2)).toHaveCount(0);
  await expect(conflictBanner(tab2)).toHaveCount(0);
  await expect(field(tab2, "Plano")).toHaveValue("Plano do separador 1");
  await expect(field(tab2, "Observações")).toHaveValue("Observações do separador 2");

  // …and the joined note is what gets saved (autosave resumed): nothing either tab typed was lost.
  await expect.poll(async () => (await serverNote(request, id)).observations).toBe("Observações do separador 2");
  const now = await serverNote(request, id);
  expect(now.plan).toBe("Plano do separador 1");
  expect(now.assessment).toBe(SECTIONS.assessment);

  // The notice can be dismissed.
  await mergeNotice(tab2).getByRole("button", { name: "Fechar aviso" }).click();
  await expect(mergeNotice(tab2)).toHaveCount(0);
});

test("a section both tabs changed is shown side by side and decided by the doctor — keeping mine", async ({ page, context, request }) => {
  const { id, tab2 } = await twoTabs(page, context, request);

  // Tab 1 changes the plan AND the assessment; tab 2 changes the plan differently.
  await field(page, "Plano").fill("Plano A (separador 1)");
  await field(page, "Avaliação").fill("Avaliação A (separador 1)");
  await expect(saved(page)).toBeVisible();
  await expect.poll(async () => (await serverNote(request, id)).assessment).toBe("Avaliação A (separador 1)");
  await field(tab2, "Plano").fill("Plano B (separador 2)");

  // The dialog opens by itself, announced as an alert dialog, with the keyboard inside it.
  const dialog = mergeDialog(tab2);
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(":focus")).toHaveCount(1);
  await expect(conflictBanner(tab2)).toContainText("1 secção mudou nas duas versões (Plano)");
  // Only the clash is asked about; the assessment joined by itself and is mentioned.
  await expect(dialog.getByRole("group")).toHaveCount(1);
  await expect(dialog).toContainText("1 secção juntada automaticamente");
  const plan = dialog.getByRole("group", { name: "Plano" });
  await expect(plan).toContainText("Plano A (separador 1)"); // theirs, the saved version
  await expect(plan).toContainText("Plano B (separador 2)"); // mine

  // An explicit choice is required: nothing is pre-selected and Aplicar waits for it.
  const apply = dialog.getByRole("button", { name: "Aplicar escolhas" });
  await expect(plan.getByRole("radio", { checked: true })).toHaveCount(0);
  await expect(apply).toBeDisabled();
  await expect(dialog).toContainText("Falta escolher: Plano");

  // The radios work from the keyboard.
  await plan.getByRole("radio", { name: /A minha versão/ }).focus();
  await tab2.keyboard.press("Space");
  await expect(plan.getByRole("radio", { name: /A minha versão/ })).toBeChecked();
  await expect(apply).toBeEnabled();
  await apply.click();

  // Mine wins for the plan; the assessment came from tab 1; the joined note is saved.
  await expect(dialog).toHaveCount(0);
  await expect(field(tab2, "Plano")).toHaveValue("Plano B (separador 2)");
  await expect(field(tab2, "Avaliação")).toHaveValue("Avaliação A (separador 1)");
  await expect(mergeNotice(tab2)).toContainText("Escolhidas por si: Plano");
  await expect.poll(async () => (await serverNote(request, id)).plan).toBe("Plano B (separador 2)");
  expect((await serverNote(request, id)).assessment).toBe("Avaliação A (separador 1)");
});

test("a section both tabs changed — loading the saved version, and 'Decidir depois' keeps the doctor's text meanwhile", async ({ page, context, request }) => {
  const { id, tab2 } = await twoTabs(page, context, request);

  await field(page, "Plano").fill("Plano A (separador 1)");
  await expect(saved(page)).toBeVisible();
  await field(tab2, "Plano").fill("Plano B (separador 2)");

  const dialog = mergeDialog(tab2);
  await expect(dialog).toBeVisible();

  // Escape / "Decidir depois": the dialog goes, the text stays, saving stays stopped, the banner offers to come back.
  await dialog.getByRole("button", { name: "Decidir depois" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(field(tab2, "Plano")).toHaveValue("Plano B (separador 2)");
  await expect(conflictBanner(tab2)).toBeVisible();
  await tab2.waitForTimeout(2_500); // longer than the autosave pause
  expect((await serverNote(request, id)).plan, "nothing was saved over tab 1's text").toBe("Plano A (separador 1)");

  await conflictBanner(tab2).getByRole("button", { name: "Juntar versões" }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("group", { name: "Plano" }).getByRole("radio", { name: /Versão guardada/ }).check();
  await dialog.getByRole("button", { name: "Aplicar escolhas" }).click();

  await expect(field(tab2, "Plano")).toHaveValue("Plano A (separador 1)");
  await expect(conflictBanner(tab2)).toHaveCount(0);
  // Nothing differs from the server any more: no write, the saved version stands.
  await tab2.waitForTimeout(2_500);
  expect((await serverNote(request, id)).plan).toBe("Plano A (separador 1)");
});

test("several clashes: 'escolher a minha em todas' picks every one at once", async ({ page, context, request }) => {
  const { id, tab2 } = await twoTabs(page, context, request);

  await field(page, "Motivo / Estado apresentado").fill("Motivo A");
  await field(page, "Observações").fill("Observações A");
  await selectRisk(page, "Moderado", "Risco A");
  await expect(saved(page)).toBeVisible();
  await expect.poll(async () => (await serverNote(request, id)).riskLevel).toBe("moderate");

  await field(tab2, "Motivo / Estado apresentado").fill("Motivo B");
  await field(tab2, "Observações").fill("Observações B");
  await selectRisk(tab2, "Elevado", "Risco B");

  const dialog = mergeDialog(tab2);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("group")).toHaveCount(3);
  await expect(dialog.getByRole("group", { name: "Nível de risco" })).toContainText("Risco moderado"); // theirs
  await expect(dialog.getByRole("group", { name: "Nível de risco" })).toContainText("Risco elevado"); // mine
  await dialog.getByRole("button", { name: "Escolher a minha em todas" }).click();
  await dialog.getByRole("button", { name: "Aplicar escolhas" }).click();

  await expect.poll(async () => (await serverNote(request, id)).riskLevel).toBe("high");
  const now = await serverNote(request, id);
  expect([now.presentingConcerns, now.observations, now.riskNotes]).toEqual(["Motivo B", "Observações B", "Risco B"]);
});

async function selectRisk(p: Page, level: "Moderado" | "Elevado", notes: string) {
  await p.getByRole("radio", { name: level, exact: true }).click();
  await p.getByRole("textbox", { name: /Detalhe do risco/ }).fill(notes);
}

test("a note the other tab finalized can only be loaded — and the doctor's unsaved text is shown first", async ({ page, context, request }) => {
  const { id, tab2 } = await twoTabs(page, context, request);

  // Tab 1 finalizes (a complete draft can be finalized with one click).
  await page.getByRole("button", { name: "Guardar nota" }).click();
  await expect.poll(async () => (await serverNote(request, id)).finalizedAt).toBeTruthy();

  await field(tab2, "Plano").fill("Plano que o separador 2 escreveu");
  await expect(tab2.getByRole("alert").filter({ hasText: "foi finalizada noutro separador" })).toBeVisible();
  await expect(mergeDialog(tab2)).toHaveCount(0); // nothing to merge into a finalized note
  const load = tab2.getByRole("button", { name: "Carregar a versão guardada" });
  await expect(load).toBeFocused();
  await expect(tab2.getByRole("button", { name: "Juntar versões" })).toHaveCount(0);

  // What would be lost is shown, copyable.
  const finalizedAlert = tab2.getByRole("alert").filter({ hasText: "foi finalizada noutro separador" });
  await finalizedAlert.getByText(/O que escreveu aqui \(Plano\)/).click();
  await expect(finalizedAlert).toContainText("Plano que o separador 2 escreveu");
  expect((await serverNote(request, id)).plan, "the finalized note was not overwritten").toBe(SECTIONS.plan);

  await load.click();
  await expect(field(tab2, "Plano")).toHaveValue(SECTIONS.plan);
  await expect(tab2.getByRole("alert").filter({ hasText: "foi finalizada" })).toHaveCount(0);
  // It is a finalized note now: no draft save, nothing to discard.
  await expect(tab2.getByRole("button", { name: "Descartar rascunho" })).toHaveCount(0);
});

test("a finalized-elsewhere note with nothing unsaved here is simply loaded, and says so", async ({ page, context, request }) => {
  const { id, tab2 } = await twoTabs(page, context, request);

  await page.getByRole("button", { name: "Guardar nota" }).click();
  await expect.poll(async () => (await serverNote(request, id)).finalizedAt).toBeTruthy();

  // Tab 2 never edited anything: its only move is to press Guardar nota — which loses to the finalization.
  await tab2.getByRole("button", { name: "Guardar nota" }).click();
  await expect(tab2.getByRole("status").filter({ hasText: "finalizada noutro separador" })).toContainText("carregámos a versão guardada");
  await expect(tab2.getByRole("button", { name: "Carregar a versão guardada" })).toHaveCount(0);
  await expect(field(tab2, "Plano")).toHaveValue(SECTIONS.plan);
});

test("a second tab that opened before any draft existed is told, instead of overwriting the first tab's draft", async ({ page, context, request }) => {
  const url = `/records/note?appointmentId=${appointmentId2}`;
  const tab2 = await context.newPage();
  await shim(tab2);
  await page.goto(url); // both tabs open while there is no note for this appointment yet
  await tab2.goto(url);
  await expect(concernsField(page)).toBeVisible();
  await expect(concernsField(tab2)).toBeVisible();

  await concernsField(page).fill("Primeiro separador");
  await expect(saved(page)).toBeVisible();
  await concernsField(tab2).fill("Segundo separador"); // its first save is a create → the note already exists

  // Both tabs wrote the first section from nothing → a real clash, decided by the doctor.
  const dialog = mergeDialog(tab2);
  await expect(dialog).toBeVisible();
  const [note] = await request.get(`${API}/clinical-notes?appointmentId=${appointmentId2}`).then((r) => r.json());
  expect(note.presentingConcerns, "the first tab's draft was not overwritten").toBe("Primeiro separador");

  await dialog.getByRole("group", { name: "Motivo / Estado apresentado" }).getByRole("radio", { name: /Versão guardada/ }).check();
  await dialog.getByRole("button", { name: "Aplicar escolhas" }).click();
  await expect(concernsField(tab2)).toHaveValue("Primeiro separador");
});

// ─── discarding a draft ───────────────────────────────────────────────────────────────────────────

const discardButton = (p: Page) => p.getByRole("button", { name: "Descartar rascunho" });
const discardDialog = (p: Page) => p.getByRole("alertdialog", { name: "Descartar rascunho?" });

test("a draft can be discarded from the editor: a confirmation that starts on Cancelar, then it is gone", async ({ page, request }) => {
  const { id } = await createDraft(request);
  await page.goto(`/records/note?noteId=${id}&returnTo=/records`);
  await expect(field(page, "Plano")).toHaveValue(SECTIONS.plan);

  await discardButton(page).click();
  const dialog = discardDialog(page);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Cancelar" })).toBeFocused(); // the safe choice

  // Escape closes it and the keyboard goes back to the button that opened it; nothing was deleted.
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(discardButton(page)).toBeFocused();
  expect((await request.get(`${API}/clinical-notes/${id}`)).status()).toBe(200);

  await discardButton(page).click();
  const confirm = dialog.getByRole("button", { name: "Descartar rascunho" });
  await confirm.click();
  await expect(page).toHaveURL((u) => u.pathname === "/records");
  expect((await request.get(`${API}/clinical-notes/${id}`)).status(), "the draft is deleted").toBe(404);
});

test("typed but never saved: discarding leaves without creating anything — not even a late autosave", async ({ page, request }) => {
  await page.goto(`/records/note?patientId=${patientId}&returnTo=/records`);
  await concernsField(page).fill("Texto que não vai ficar");
  await discardButton(page).click(); // inside the 1.5s autosave pause
  await discardDialog(page).getByRole("button", { name: "Descartar rascunho" }).click();
  await expect(page).toHaveURL((u) => u.pathname === "/records");
  await page.waitForTimeout(3_000);
  // Newest first: a note created by a late autosave would be at the top.
  const notes = (await request.get(`${API}/patients/${patientId}/clinical-notes?limit=100`).then((r) => r.json())) as { presentingConcerns: string }[];
  expect(notes.some((n) => n.presentingConcerns === "Texto que não vai ficar")).toBe(false);
});

test("a refused discard says why and keeps the editor; one that is already gone says so and leaves", async ({ page, request }) => {
  const { id } = await createDraft(request);
  await page.goto(`/records/note?noteId=${id}&returnTo=/records`);
  await expect(field(page, "Plano")).toHaveValue(SECTIONS.plan);

  // 409 — a prescription refers to the draft.
  await page.route(`**/api/clinical-notes/${id}`, (route) =>
    route.request().method() === "DELETE"
      ? route.fulfill({ status: 409, json: { statusCode: 409, code: "NOTE_HAS_LINKED_RECORDS", message: "This draft has linked records" } })
      : route.fallback(),
  );
  await discardButton(page).click();
  const dialog = discardDialog(page);
  await dialog.getByRole("button", { name: "Descartar rascunho" }).click();
  await expect(dialog.getByRole("alert")).toContainText("tem prescrições ou referenciações associadas");
  await dialog.getByRole("button", { name: "Cancelar" }).click();
  await expect(field(page, "Plano")).toHaveValue(SECTIONS.plan); // still editing the draft

  // 404 — nothing left to discard: say so and go back.
  await page.unroute(`**/api/clinical-notes/${id}`);
  await page.route(`**/api/clinical-notes/${id}`, (route) =>
    route.request().method() === "DELETE" ? route.fulfill({ status: 404, json: { statusCode: 404, message: "not found" } }) : route.fallback(),
  );
  await discardButton(page).click();
  await dialog.getByRole("button", { name: "Descartar rascunho" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "já não existe" })).toBeVisible();
  await expect(page).toHaveURL((u) => u.pathname === "/records");
});

test("a draft discarded in another tab: the next save is told, the text stays, and it can be kept as a new draft", async ({ page, request }) => {
  const { id } = await createDraft(request);
  await page.goto(`/records/note?noteId=${id}`);
  await expect(field(page, "Plano")).toHaveValue(SECTIONS.plan);

  // Another tab/device throws the draft away (the API call stands in for it).
  const del = await request.delete(`${API}/clinical-notes/${id}`);
  expect(del.status()).toBe(204);

  await field(page, "Plano").fill("Plano escrito depois de o rascunho ser descartado");
  const gone = page.getByRole("alert").filter({ hasText: "foi descartado noutro separador" });
  await expect(gone).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "o texto não está guardado" })).toBeVisible();
  await expect(field(page, "Plano")).toHaveValue("Plano escrito depois de o rascunho ser descartado"); // nothing lost
  await expect(page.getByRole("button", { name: "Guardar nota" })).toBeDisabled(); // nothing to save onto
  await expect(discardButton(page)).toHaveCount(0);
  await page.waitForTimeout(2_500); // autosave has stopped: no storm of 404s, no new note behind the doctor's back
  const before = (await request.get(`${API}/patients/${patientId}/clinical-notes?limit=100`).then((r) => r.json())) as { plan: string }[];
  expect(before.some((n) => n.plan === "Plano escrito depois de o rascunho ser descartado")).toBe(false);

  // Leaving now would lose it: asked first (declined here).
  const asked: string[] = [];
  page.once("dialog", (d) => { asked.push(d.message()); void d.dismiss(); });
  await page.getByRole("link", { name: "Voltar" }).click();
  await expect.poll(() => asked.length).toBe(1);

  await gone.getByRole("button", { name: "Guardar como novo rascunho" }).click();
  await expect(page.getByText(/Rascunho guardado às/)).toBeVisible();
  await expect(gone).toHaveCount(0);
  const after = (await request.get(`${API}/patients/${patientId}/clinical-notes?limit=100`).then((r) => r.json())) as { id: string; plan: string; finalizedAt: string | null }[];
  const kept = after.find((n) => n.plan === "Plano escrito depois de o rascunho ser descartado");
  expect(kept, "the text was saved as a new draft").toBeTruthy();
  expect(kept!.id).not.toBe(id);
  expect(new URL(page.url()).searchParams.get("noteId")).toBe(kept!.id);
});

test("a finalized note offers no discard", async ({ page, request }) => {
  const created = await request.post(`${API}/patients/${patientId}/clinical-notes`, {
    data: { sessionType: "individual", ...SECTIONS },
  });
  expect(created.status()).toBe(201);
  await page.goto(`/records/note?noteId=${(await created.json()).id}`);
  await expect(field(page, "Plano")).toHaveValue(SECTIONS.plan);
  await expect(discardButton(page)).toHaveCount(0);
});

// ─── a doctor who put the patient in treatment alone ──────────────────────────────────────────────────

test("a doctor who checked the patient in alone is told why a colleague's notes aren't shown", async ({ page, request }) => {
  const me = await request.get(`${API}/staff/me`).then((r) => r.json());
  // beforeAll checked this appointment in through the API as the dev-bypass admin — so serving /staff/me as a doctor
  // with that same staff id makes this browser "the only person who checked the patient in".
  await page.route("**/api/staff/me", (route) => route.fulfill({ json: { ...me, role: "doctor" } }));
  await page.goto(`/records/note?appointmentId=${appointmentId2}`);

  await expect(page.getByText("Foi só você a pôr este paciente em consulta")).toBeVisible();
  await expect(page.getByText("desde que o check-in tenha sido feito por outra pessoa")).toBeVisible();
});

// ─── a colleague's note ───────────────────────────────────────────────────────────────────────────

test("another clinician's finalized note opens read-only, with their name and no way to save", async ({ page, request }) => {
  const me = await request.get(`${API}/staff/me`).then((r) => r.json());
  const created = await request.post(`${API}/patients/${patientId}/clinical-notes`, {
    data: { sessionType: "individual", presentingConcerns: "Escrita pelo colega", observations: "o", assessment: "a", plan: "p" },
  });
  expect(created.status()).toBe(201);
  const noteId: string = (await created.json()).id;

  // This browser is a doctor who is not that note's author (the dev bypass makes every session the admin,
  // so serve /staff/me as someone else; the API still enforces nothing here — this is the page's behaviour).
  await page.route("**/api/staff/me", (route) =>
    route.fulfill({ json: { ...me, id: "00000000-0000-4000-8000-0000000000aa", role: "doctor" } }),
  );
  await page.goto(`/records/note?noteId=${noteId}`);

  await expect(page.getByText(`Nota de ${me.fullName} — só leitura`)).toBeVisible();
  await expect(concernsField(page)).toHaveValue("Escrita pelo colega");
  await expect(concernsField(page)).toBeDisabled();
  await expect(page.getByRole("button", { name: /Guardar/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^\+ / })).toHaveCount(0); // no quick-phrase chips either
  await expect(discardButton(page)).toHaveCount(0);
});
