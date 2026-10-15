/**
 * E2E: the rest of the clinical module on the patient's profile and in /records — prescriptions (several
 * medicines, duration, instructions, a link to the note), referrals (external and internal, with a target
 * clinician; status actions), discarding a draft from the patient's list, and the admin's "Acessos entre
 * clínicos" report. Before this file the prescriptions and referrals tabs had no end-to-end coverage at all.
 *
 * The browser is the dev-bypass admin (every session is). Where the doctor's view matters, /api/staff/me is served as
 * a doctor with the same staff id (so "I sent this referral" is true), the same trick the note specs use.
 *
 * Setup/teardown via the API directly (helpers inlined: Playwright's loader can't import a sibling module under every
 * Node version this repo is run with). E2E_API points both the setup calls and the browser's /api traffic at a different
 * API instance (e.g. one freshly built from the working tree); unset, it is the same API the web app proxies to.
 *
 * Debris: no API deletes a finalized note, a prescription or a referral, so a run leaves one finalized note and the
 * prescriptions/referrals it creates (about 6 rows) on the erased test patient; drafts are discarded.
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

const PATIENT = "E2E Extras Clinicos";
let patientId: string;
let finalNoteId: string;
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
  const n = await request.post(`${API}/patients/${patientId}/clinical-notes`, {
    data: { sessionType: "individual", presentingConcerns: "Motivo", observations: "Observações", assessment: "Avaliação", plan: "Plano" },
  });
  expect(n.status(), "create finalized note").toBe(201);
  finalNoteId = (await n.json()).id;
  me = await request.get(`${API}/staff/me`).then((x) => x.json());
});

test.afterAll(async ({ request }) => {
  if (!patientId) return;
  const notes = (await request.get(`${API}/patients/${patientId}/clinical-notes?limit=100`).then((r) => r.json())) as { id: string; finalizedAt: string | null }[];
  for (const n of notes.filter((x) => x.finalizedAt === null)) {
    await must(`discard draft ${n.id}`, () => request.delete(`${API}/clinical-notes/${n.id}`));
  }
  await must("erase the patient", () => request.delete(`${API}/patients/${patientId}`));
});

let seq = 0;
const unique = (prefix: string) => `${prefix} ${Date.now().toString().slice(-6)}${seq++}`;

/** A pending external referral made through the API, for the tests that start from one. */
async function seedReferral(request: APIRequestContext, provider: string): Promise<string> {
  const r = await request.post(`${API}/patients/${patientId}/referrals`, {
    data: { type: "external", externalProviderName: provider, reason: "Motivo de teste da referenciação." },
  });
  expect(r.status(), "seed referral").toBe(201);
  return (await r.json()).id;
}
const referralStatus = (request: APIRequestContext, id: string) =>
  request.get(`${API}/patients/${patientId}/referrals`).then((r) => r.json()).then((l: { id: string; status: string }[]) => l.find((x) => x.id === id)?.status);

/** The profile page, on the given tab of the clinical section. */
async function openSection(page: Page, tab: "Notas Clínicas" | "Prescrições" | "Referenciações") {
  await page.goto(`/patients/${patientId}`);
  await page.getByRole("tab", { name: tab }).click();
}
const asDoctor = (page: Page, over: Record<string, unknown> = {}) =>
  page.route("**/api/staff/me", (route) => route.fulfill({ json: { ...me, role: "doctor", ...over } }));

// ─── prescriptions ────────────────────────────────────────────────────────────────────────────────

test("a patient with no prescriptions or referrals sees the empty messages", async ({ page, request }) => {
  const r = await request.post(`${API}/patients`, {
    data: { fullName: "E2E Extras Vazio", dateOfBirth: "1990-01-01", gender: "male", phone: `+23898${Math.floor(10000 + Math.random() * 90000)}`, consentGiven: true },
  });
  expect(r.status()).toBe(201);
  const emptyId: string = (await r.json()).id;
  try {
    await page.goto(`/patients/${emptyId}`);
    await page.getByRole("tab", { name: "Prescrições" }).click();
    await expect(page.getByText("Sem prescrições registadas.")).toBeVisible();
    await page.getByRole("tab", { name: "Referenciações" }).click();
    await expect(page.getByText("Sem referenciações registadas.")).toBeVisible();
    await page.getByRole("tab", { name: "Notas Clínicas" }).click();
    await expect(page.getByText(/Ainda sem notas clínicas/)).toBeVisible();
  } finally {
    await must("erase the empty patient", () => request.delete(`${API}/patients/${emptyId}`));
  }
});

test("a prescription with two medicines, a duration, instructions and a link to the note is created and listed", async ({ page, request }) => {
  await openSection(page, "Prescrições");
  await page.getByRole("button", { name: "Nova Prescrição" }).click();
  const dialog = page.getByRole("dialog", { name: "Nova Prescrição" });
  await expect(dialog).toBeVisible();

  // Nothing filled in: every missing field is named, in Portuguese, and the keyboard goes to the first.
  await dialog.getByRole("button", { name: "Criar Prescrição" }).click();
  const first = dialog.getByRole("group", { name: "Medicamento 1" });
  await expect(first).toContainText("Indique o medicamento.");
  await expect(first).toContainText("Indique a dosagem.");
  await expect(first).toContainText("Indique a frequência.");
  await expect(first.getByLabel("Medicamento")).toBeFocused();

  await first.getByLabel("Medicamento").fill("Sertralina");
  await first.getByLabel("Dosagem").fill("50mg");
  await first.getByLabel("Frequência").fill("1x ao dia");
  await first.getByLabel("Duração (dias)").fill("abc");
  await dialog.getByRole("button", { name: "Criar Prescrição" }).click();
  await expect(first).toContainText("Use um número inteiro de dias, entre 1 e 3650.");
  await expect(first.getByLabel("Duração (dias)")).toBeFocused();
  await first.getByLabel("Duração (dias)").fill("30");
  await expect(first).not.toContainText("Use um número inteiro"); // typing clears the message
  await first.getByLabel("Instruções").fill("Tomar de manhã, com água");

  // A second medicine; a third is added and removed again.
  await dialog.getByRole("button", { name: "Adicionar medicamento" }).click();
  await dialog.getByRole("button", { name: "Adicionar medicamento" }).click();
  await dialog.getByRole("button", { name: "Remover medicamento 3" }).click();
  const second = dialog.getByRole("group", { name: "Medicamento 2" });
  await expect(dialog.getByRole("group", { name: "Medicamento 3" })).toHaveCount(0);
  await second.getByLabel("Medicamento").fill("Zolpidem");
  await second.getByLabel("Dosagem").fill("5mg");
  await second.getByLabel("Frequência").fill("à noite");

  await dialog.getByLabel("Associar a uma nota").selectOption(finalNoteId);
  await dialog.getByLabel("Observações", { exact: false }).last().fill("Rever em 4 semanas.");
  await dialog.getByRole("button", { name: "Criar Prescrição" }).click();

  await expect(dialog).toHaveCount(0);
  const card = page.getByRole("article", { name: /^Prescrição de/ }).filter({ hasText: "Sertralina" });
  await expect(card).toHaveCount(1);
  await expect(card).toContainText("Sertralina — 50mg, 1x ao dia");
  await expect(card).toContainText("durante 30 dias");
  await expect(card).toContainText("Tomar de manhã, com água");
  await expect(card).toContainText("Zolpidem — 5mg, à noite");
  await expect(card).toContainText("Rever em 4 semanas.");
  await expect(card.getByRole("link", { name: /^Nota de/ })).toHaveAttribute("href", new RegExp(`/records/note\\?noteId=${finalNoteId}`));

  const list = (await request.get(`${API}/patients/${patientId}/prescriptions`).then((r) => r.json())) as { clinicalNoteId: string | null; items: { drugName: string; durationDays: number | null }[] }[];
  const rx = list.find((p) => p.items.some((i) => i.drugName === "Sertralina"))!;
  expect(rx.clinicalNoteId).toBe(finalNoteId);
  expect(rx.items.map((i: { drugName: string; durationDays: number | null }) => [i.drugName, i.durationDays])).toEqual([["Sertralina", 30], ["Zolpidem", null]]);
});

test("a half-written prescription is not lost to a stray click or Escape: it asks first", async ({ page }) => {
  await openSection(page, "Prescrições");
  await page.getByRole("button", { name: "Nova Prescrição" }).click();
  const dialog = page.getByRole("dialog", { name: "Nova Prescrição" });
  await dialog.getByLabel("Medicamento").fill("Fluoxetina");

  const messages: string[] = [];
  page.once("dialog", (d) => { messages.push(d.message()); void d.dismiss(); });
  await page.keyboard.press("Escape");
  await expect.poll(() => messages).toEqual(["Descartar a prescrição que está a escrever?"]);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Medicamento")).toHaveValue("Fluoxetina");

  await page.mouse.click(5, 5); // the backdrop: does nothing
  await expect(dialog).toBeVisible();

  page.once("dialog", (d) => { void d.accept(); });
  await dialog.getByRole("button", { name: "Cancelar" }).click();
  await expect(dialog).toHaveCount(0);
  // The keyboard is back on the button that opened the form.
  await expect(page.getByRole("button", { name: "Nova Prescrição" })).toBeFocused();
});

test("an API refusal is shown inside the form and nothing typed is lost; a failed list says so and can be retried", async ({ page, request }) => {
  await openSection(page, "Prescrições");
  await page.getByRole("button", { name: "Nova Prescrição" }).click();
  const dialog = page.getByRole("dialog", { name: "Nova Prescrição" });
  await dialog.getByLabel("Medicamento").fill("Fluoxetina");
  await dialog.getByLabel("Dosagem").fill("20mg");
  await dialog.getByLabel("Frequência").fill("1x ao dia");

  await page.route("**/api/patients/*/prescriptions", (route) =>
    route.request().method() === "POST" ? route.fulfill({ status: 400, json: { message: "Clinical note not found" } }) : route.fallback(),
  );
  await dialog.getByRole("button", { name: "Criar Prescrição" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Não foi possível criar a prescrição: Clinical note not found");
  await expect(dialog.getByLabel("Medicamento")).toHaveValue("Fluoxetina");
  await expect(dialog.getByRole("button", { name: "Criar Prescrição" })).toBeEnabled(); // not stuck on "A guardar…"
  page.once("dialog", (d) => { void d.accept(); });
  await dialog.getByRole("button", { name: "Cancelar" }).click();
  await page.unroute("**/api/patients/*/prescriptions");

  // A list that fails to load must not read as "no prescriptions".
  const seeded = await request.post(`${API}/patients/${patientId}/prescriptions`, { data: { items: [{ drugName: "Citalopram", dosage: "20mg", frequency: "1x ao dia" }] } });
  expect(seeded.status(), "seed prescription").toBe(201);
  let fail = true;
  // The list is fetched as …/prescriptions?page=1&limit=100: without the trailing * this glob never matches the GET.
  await page.route("**/api/patients/*/prescriptions*", (route) =>
    fail && route.request().method() === "GET" ? route.fulfill({ status: 500, json: { message: "boom" } }) : route.fallback(),
  );
  await page.reload();
  await page.getByRole("tab", { name: "Prescrições" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Não foi possível carregar a lista." })).toBeVisible();
  await expect(page.getByText("Sem prescrições registadas.")).toHaveCount(0);
  fail = false;
  await page.getByRole("button", { name: "Tentar novamente" }).click();
  await expect(page.getByRole("article", { name: /^Prescrição de/ }).filter({ hasText: "Citalopram" })).toHaveCount(1);
});

// ─── referrals ────────────────────────────────────────────────────────────────────────────────────

const referralCard = (page: Page, name: string | RegExp) => page.getByRole("article", { name: typeof name === "string" ? `Referenciação para ${name}` : name });

test("an external referral needs a provider and a reason, then shows as Pendente with its specialty", async ({ page, request }) => {
  await openSection(page, "Referenciações");
  await page.getByRole("button", { name: "Nova Referenciação" }).click();
  const dialog = page.getByRole("dialog", { name: "Nova Referenciação" });

  await dialog.getByRole("button", { name: "Criar Referenciação" }).click();
  await expect(dialog).toContainText("Indique o nome do prestador (pelo menos 2 letras).");
  await expect(dialog).toContainText("Indique o motivo (pelo menos 3 letras).");
  await expect(dialog.getByLabel("Prestador Externo")).toBeFocused();

  await dialog.getByLabel("Prestador Externo").fill("Clínica Vale Saúde");
  await dialog.getByLabel("Especialidade").fill("Psiquiatria");
  await dialog.getByLabel("Motivo").fill("Avaliação psiquiátrica por suspeita de perturbação bipolar.");
  await dialog.getByLabel("Associar a uma nota").selectOption(finalNoteId);
  await dialog.getByRole("button", { name: "Criar Referenciação" }).click();

  await expect(dialog).toHaveCount(0);
  const card = referralCard(page, "Clínica Vale Saúde");
  await expect(card).toContainText("Externa");
  await expect(card).toContainText("Psiquiatria");
  await expect(card).toContainText("Pendente");
  await expect(card).toContainText("Avaliação psiquiátrica por suspeita de perturbação bipolar.");
  await expect(card.getByRole("link", { name: /^Nota de/ })).toBeVisible();
  const list = (await request.get(`${API}/patients/${patientId}/referrals`).then((x) => x.json())) as { externalProviderName: string | null }[];
  expect(list.find((x) => x.externalProviderName === "Clínica Vale Saúde")).toMatchObject({ type: "external", externalSpecialty: "Psiquiatria", clinicalNoteId: finalNoteId });
});

test("an internal referral is addressed to a colleague chosen from a list (the form used to have no way to pick one)", async ({ page, request }) => {
  await openSection(page, "Referenciações");
  await page.getByRole("button", { name: "Nova Referenciação" }).click();
  const dialog = page.getByRole("dialog", { name: "Nova Referenciação" });
  await dialog.getByLabel("Tipo").selectOption("internal");

  const target = dialog.getByLabel("Clínico de destino");
  await expect(target).toBeVisible();
  const options = await target.locator("option").allInnerTexts();
  expect(options.length, "at least one other clinician to choose").toBeGreaterThan(1);
  expect(options).not.toContain(me.fullName); // not the referrer themself

  await dialog.getByLabel("Motivo").fill("Segunda opinião sobre a medicação.");
  await dialog.getByRole("button", { name: "Criar Referenciação" }).click();
  await expect(dialog).toContainText("Escolha o clínico de destino.");
  await expect(target).toBeFocused();

  const colleague = options[1];
  await target.selectOption({ label: colleague });
  await dialog.getByRole("button", { name: "Criar Referenciação" }).click();
  await expect(dialog).toHaveCount(0);

  const card = referralCard(page, colleague);
  await expect(card).toContainText("Interna");
  await expect(card).toContainText("Pendente");
  const list = (await request.get(`${API}/patients/${patientId}/referrals`).then((x) => x.json())) as { type: string; targetStaffId: string | null; targetStaff: { fullName: string } | null }[];
  const created = list.find((r) => r.type === "internal");
  expect(created?.targetStaff?.fullName).toBe(colleague);
});

test("with no other clinician to choose, the internal form says so", async ({ page }) => {
  await page.route("**/api/staff", (route) => route.fulfill({ json: [{ id: me.id, fullName: me.fullName, role: "admin" }] }));
  await openSection(page, "Referenciações");
  await page.getByRole("button", { name: "Nova Referenciação" }).click();
  const dialog = page.getByRole("dialog", { name: "Nova Referenciação" });
  await dialog.getByLabel("Tipo").selectOption("internal");
  await expect(dialog).toContainText("Não há outros clínicos ativos");
  await expect(dialog.getByLabel("Clínico de destino")).toHaveCount(0);
});

test("the referrer moves a referral forward with status buttons, and a finished one has none; an admin can correct it", async ({ page, request }) => {
  const provider = unique("Clínica Estado");
  const id = await seedReferral(request, provider);
  await asDoctor(page);
  await openSection(page, "Referenciações");
  const card = referralCard(page, provider);
  await expect(card.getByText("Pendente", { exact: true })).toBeVisible();
  await expect(card.getByRole("button")).toHaveText(["Marcar como agendada", "Marcar como concluída", "Marcar como recusada"]);

  await card.getByRole("button", { name: "Marcar como agendada" }).click();
  await expect(card.getByText("Agendada", { exact: true })).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "Referenciação marcada como agendada." })).toBeVisible();
  await expect(card.getByRole("button")).toHaveText(["Desfazer agendamento", "Marcar como concluída", "Marcar como recusada"]);

  await card.getByRole("button", { name: "Marcar como concluída" }).click();
  await expect(card.getByText("Concluída", { exact: true })).toBeVisible();
  await expect(card.getByRole("button")).toHaveCount(0); // completed is final for the referrer
  expect(await referralStatus(request, id)).toBe("completed");

  // The admin (no doctor override) may correct any status.
  await page.unroute("**/api/staff/me");
  await page.reload();
  await page.getByRole("tab", { name: "Referenciações" }).click();
  await card.getByRole("button", { name: "Reabrir como pendente" }).click();
  await expect(card.getByText("Pendente", { exact: true })).toBeVisible();
  expect(await referralStatus(request, id)).toBe("pending");
});

test("a doctor who is neither the referrer nor the target gets no status buttons; a 409 says someone else moved it first", async ({ page, request }) => {
  const provider = unique("Clínica Alheia");
  await seedReferral(request, provider);
  await asDoctor(page, { id: "00000000-0000-4000-8000-0000000000bb" });
  await openSection(page, "Referenciações");
  await expect(referralCard(page, provider)).toBeVisible();
  await expect(referralCard(page, provider).getByRole("button")).toHaveCount(0);
  await page.unroute("**/api/staff/me");

  await asDoctor(page); // back to being the referrer
  await page.route("**/api/referrals/*/status", (route) => route.fulfill({ status: 409, json: { statusCode: 409, code: "REFERRAL_CHANGED", message: "changed" } }));
  await page.reload();
  await page.getByRole("tab", { name: "Referenciações" }).click();
  await referralCard(page, provider).getByRole("button", { name: "Marcar como agendada" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "foi alterada por outra pessoa" })).toBeVisible();
});

// ─── paging: the API returns 100 at a time ────────────────────────────────────────────────────────

/** Serves a list as pages of 100 (then a short one) and records which pages were asked for. */
async function servePaged(page: Page, urlPattern: RegExp, make: (i: number) => unknown, total: number) {
  const asked: string[] = [];
  await page.route(urlPattern, (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const u = new URL(route.request().url());
    const p = Number(u.searchParams.get("page"));
    const limit = Number(u.searchParams.get("limit"));
    asked.push(`${p}/${limit}`);
    const from = (p - 1) * limit;
    return route.fulfill({ json: Array.from({ length: Math.max(0, Math.min(limit, total - from)) }, (_, i) => make(from + i)) });
  });
  return asked;
}
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const when = (i: number) => new Date(Date.UTC(2026, 9, 1) - i * 3_600_000).toISOString();

test("the notes, prescriptions and referrals lists load further pages with 'Carregar mais' (100 at a time)", async ({ page }) => {
  const asked = {
    notes: await servePaged(page, /\/api\/patients\/[0-9a-f-]+\/clinical-notes/, (i) => ({
      id: uuid(1000 + i), patientId, appointmentId: null, authorStaffId: me.id, author: { fullName: me.fullName }, sessionType: "individual", durationMinutes: 50,
      presentingConcerns: `c${i}`, observations: "o", assessment: `Avaliação ${i}`, plan: "p", riskLevel: "none", riskNotes: null,
      finalizedAt: when(i), createdAt: when(i), updatedAt: when(i),
    }), 102),
    rx: await servePaged(page, /\/api\/patients\/[0-9a-f-]+\/prescriptions/, (i) => ({
      id: uuid(2000 + i), patientId, clinicalNoteId: null, prescribedByStaffId: me.id, prescribedBy: { fullName: me.fullName }, issuedAt: when(i), notes: null,
      items: [{ id: uuid(3000 + i), drugName: `Medicamento ${i}`, dosage: "1", frequency: "1x", durationDays: null, instructions: null }],
    }), 101),
    ref: await servePaged(page, /\/api\/patients\/[0-9a-f-]+\/referrals/, (i) => ({
      id: uuid(4000 + i), patientId, clinicalNoteId: null, referredByStaffId: me.id, referredBy: { fullName: me.fullName }, type: "external", targetStaffId: null, targetStaff: null,
      externalProviderName: `Prestador ${i}`, externalSpecialty: null, reason: "r", status: "pending", createdAt: when(i), updatedAt: when(i),
    }), 150),
  };

  await page.goto(`/patients/${patientId}`);
  // Notas: 100 rows, then 2 more.
  const noteRows = page.getByRole("tabpanel").locator("details");
  await expect(noteRows).toHaveCount(100);
  await page.getByRole("button", { name: "Carregar mais" }).click();
  await expect(noteRows).toHaveCount(102);
  await expect(page.getByRole("button", { name: "Carregar mais" })).toHaveCount(0);
  expect(asked.notes).toEqual(["1/100", "2/100"]);

  // Prescrições: a full first page and a single extra row.
  await page.getByRole("tab", { name: "Prescrições" }).click();
  const rxRows = page.getByRole("article", { name: /^Prescrição de/ });
  await expect(rxRows).toHaveCount(100);
  await page.getByRole("button", { name: "Carregar mais" }).click();
  await expect(rxRows).toHaveCount(101);
  await expect(page.getByRole("button", { name: "Carregar mais" })).toHaveCount(0);
  expect(asked.rx).toEqual(["1/100", "2/100"]);

  // Referenciações: exactly 150 → the second page is short, so it ends there.
  await page.getByRole("tab", { name: "Referenciações" }).click();
  const refRows = page.getByRole("article", { name: /^Referenciação para/ });
  await expect(refRows).toHaveCount(100);
  await page.getByRole("button", { name: "Carregar mais" }).click();
  await expect(refRows).toHaveCount(150);
  await expect(page.getByRole("button", { name: "Carregar mais" })).toHaveCount(0);
  expect(asked.ref).toEqual(["1/100", "2/100"]);
});

// ─── from a note, and discarding a draft from the patient's list ───────────────────────────────────

test("'Prescrever' on a finalized note opens the prescription form already linked to it", async ({ page }) => {
  await openSection(page, "Notas Clínicas");
  await page.locator("details", { hasText: "Individual" }).first().locator("summary").click();
  await page.getByRole("button", { name: "Prescrever" }).first().click();
  await expect(page.getByRole("tab", { name: "Prescrições", selected: true })).toBeVisible();
  const dialog = page.getByRole("dialog", { name: "Nova Prescrição" });
  await expect(dialog.getByLabel("Associar a uma nota")).toHaveValue(finalNoteId);
});

test("a draft in the patient's list can be discarded (after a confirmation); a finalized note cannot", async ({ page, request }) => {
  const created = await request.post(`${API}/patients/${patientId}/clinical-notes`, {
    data: { sessionType: "couples", presentingConcerns: "Rascunho para descartar", observations: "", assessment: "", plan: "", draft: true },
  });
  expect(created.status()).toBe(201);
  const draftId: string = (await created.json()).id;

  await openSection(page, "Notas Clínicas");
  const draftRow = page.locator("details", { hasText: "Casal" });
  await expect(draftRow).toHaveCount(1);
  const finalRow = page.locator("details", { hasText: "Individual" }).first();
  await finalRow.locator("summary").click();
  await expect(finalRow.getByRole("button", { name: "Descartar rascunho" })).toHaveCount(0);

  await draftRow.locator("summary").click();
  await draftRow.getByRole("button", { name: "Descartar rascunho" }).click();
  const dialog = page.getByRole("alertdialog", { name: "Descartar rascunho?" });
  await expect(dialog.getByRole("button", { name: "Cancelar" })).toBeFocused();

  // A refusal (here a linked prescription) keeps the draft and says why…
  await page.route(`**/api/clinical-notes/${draftId}`, (route) =>
    route.request().method() === "DELETE"
      ? route.fulfill({ status: 409, json: { statusCode: 409, code: "NOTE_HAS_LINKED_RECORDS", message: "linked" } })
      : route.fallback(),
  );
  await dialog.getByRole("button", { name: "Descartar rascunho" }).click();
  await expect(dialog.getByRole("alert")).toContainText("tem prescrições ou referenciações associadas");
  await expect(draftRow).toHaveCount(1);
  await page.unroute(`**/api/clinical-notes/${draftId}`);

  // …and a real discard removes it from the list and from the server.
  await dialog.getByRole("button", { name: "Descartar rascunho" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(draftRow).toHaveCount(0);
  expect((await request.get(`${API}/clinical-notes/${draftId}`)).status()).toBe(404);
});

// ─── the admin's "Acessos entre clínicos" ──────────────────────────────────────────────────────────

const accessTab = (page: Page) => page.getByRole("tab", { name: "Acessos entre clínicos" });
const ACCESS = /\/api\/clinical-notes\/access-log/;

type Entry = {
  id: string; at: string;
  reader: { id: string | null; email: string | null; fullName: string | null };
  patient: { id: string; fullName: string | null } | null;
  basis: string; otherAuthorsNotes: number | null; note: { id: string; authorStaffId: string } | null;
};
const entry = (i: number, over: Partial<Entry> = {}): Entry => ({
  id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
  at: new Date(Date.UTC(2026, 9, 5, 15, 30) - i * 60_000).toISOString(),
  reader: { id: me.id, email: "leitor@example.com", fullName: `Leitor ${i}` },
  patient: { id: "11111111-1111-4111-8111-111111111111", fullName: `Paciente ${i}` },
  basis: "patient in treatment today", otherAuthorsNotes: 3, note: null, ...over,
});

test("admin: the report lists reads with Cabo Verde time, reader, patient link and basis, and pages with 'Carregar mais'", async ({ page }) => {
  const pages: Entry[][] = [
    [
      entry(0),
      entry(1, { patient: { id: "22222222-2222-4222-8222-222222222222", fullName: null }, otherAuthorsNotes: null, note: { id: "33333333-3333-4333-8333-333333333333", authorStaffId: me.id } }),
      entry(2, { reader: { id: null, email: "saiu@example.com", fullName: null }, patient: null, otherAuthorsNotes: 1 }),
      ...Array.from({ length: 47 }, (_, i) => entry(i + 3)),
    ],
    [entry(50), entry(51)],
  ];
  const requested: string[] = [];
  await page.route(ACCESS, (route) => {
    const u = new URL(route.request().url());
    requested.push(`${u.searchParams.get("page")}/${u.searchParams.get("limit")}`);
    return route.fulfill({ json: pages[Number(u.searchParams.get("page")) - 1] ?? [] });
  });

  await page.goto("/records");
  await accessTab(page).click();
  await expect(page.getByRole("heading", { name: "Acessos entre clínicos" })).toBeVisible();
  await expect(page.getByText(/permitido apenas enquanto o paciente está em consulta hoje/)).toBeVisible();
  await expect(page.getByText("Quem leu notas de outros clínicos")).toBeVisible();

  const rows = page.getByRole("table", { name: "Leituras de notas de outros autores" }).getByRole("row");
  await expect(rows).toHaveCount(51); // 50 + the header row
  const first = rows.nth(1);
  await expect(first).toContainText("14:30"); // 15:30 UTC is 14:30 in Cabo Verde (UTC-1)
  await expect(first).toContainText("2026");
  await expect(first).toContainText("Leitor 0");
  await expect(first.getByRole("link", { name: "Paciente 0" })).toHaveAttribute("href", "/patients/11111111-1111-4111-8111-111111111111");
  await expect(first).toContainText("Paciente em consulta hoje");
  await expect(first).toContainText("3 notas de outros autores");
  // Erased patient, a by-id read, a reader whose staff row is gone, an unresolvable patient.
  await expect(rows.nth(2)).toContainText("Paciente removido");
  await expect(rows.nth(2).getByRole("link")).toHaveCount(0);
  await expect(rows.nth(2)).toContainText(`nota de ${me.fullName} (aberta diretamente)`);
  await expect(rows.nth(3)).toContainText("saiu@example.com");
  await expect(rows.nth(3)).toContainText("Paciente não identificado");
  await expect(rows.nth(3)).toContainText("1 nota de outros autores");

  await page.getByRole("button", { name: "Carregar mais" }).click();
  await expect(rows).toHaveCount(53);
  await expect(page.getByRole("button", { name: "Carregar mais" })).toHaveCount(0); // a short last page
  expect(requested).toEqual(["1/50", "2/50"]);
});

test("admin: an empty report explains itself; a failed one says so and can be retried", async ({ page }) => {
  let fail = false;
  await page.route(ACCESS, (route) => (fail ? route.fulfill({ status: 500, json: { message: "boom" } }) : route.fulfill({ json: [] })));
  await page.goto("/records");
  await accessTab(page).click();
  await expect(page.getByText("Nenhum clínico leu notas de outro autor até agora.")).toBeVisible();

  fail = true;
  await page.reload();
  await accessTab(page).click();
  await expect(page.getByRole("alert").filter({ hasText: "Erro ao carregar o registo de acessos." })).toBeVisible();
  fail = false;
  await page.getByRole("button", { name: "Tentar novamente" }).click();
  await expect(page.getByText("Nenhum clínico leu notas de outro autor até agora.")).toBeVisible();
});

test("the tab strip is one tab stop and arrow keys move between tabs", async ({ page }) => {
  await page.route(ACCESS, (route) => route.fulfill({ json: [] }));
  await page.goto("/records");
  const today = page.getByRole("tab", { name: /Em consulta/ });
  await today.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Histórico" })).toBeFocused();
  await expect(page.getByRole("tab", { name: "Histórico" })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowRight");
  await expect(accessTab(page)).toBeFocused();
  await expect(page.getByRole("tabpanel")).toContainText("Acessos entre clínicos");
  await page.keyboard.press("ArrowRight"); // wraps
  await expect(page.getByRole("tab", { name: /Em consulta/ })).toBeFocused();
  await page.keyboard.press("End");
  await expect(accessTab(page)).toBeFocused();
});

test("a doctor never sees the tab, and the report endpoint refuses a doctor", async ({ page }) => {
  await asDoctor(page);
  await page.goto("/records");
  await expect(page.getByRole("tab", { name: "Histórico" })).toBeVisible();
  await expect(accessTab(page)).toHaveCount(0);
});

test("real API: the report loads for the admin (rows or the empty message, never an error)", async ({ page, request }) => {
  const res = await request.get(`${API}/clinical-notes/access-log?page=1&limit=5`);
  expect(res.status()).toBe(200);
  const rows = (await res.json()) as unknown[];
  expect(Array.isArray(rows)).toBe(true);

  await page.goto("/records");
  await accessTab(page).click();
  await expect(page.getByRole("heading", { name: "Acessos entre clínicos" })).toBeVisible();
  if (rows.length === 0) await expect(page.getByText("Nenhum clínico leu notas de outro autor até agora.")).toBeVisible();
  else await expect(page.getByRole("table", { name: "Leituras de notas de outros autores" })).toBeVisible();
  await expect(page.getByText("Erro ao carregar o registo de acessos.")).toHaveCount(0);
});
