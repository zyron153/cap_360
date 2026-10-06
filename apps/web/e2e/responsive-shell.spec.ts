/**
 * E2E: the app is usable below desktop width.
 *
 * Guard 1 — on every main route, and on every tab of it, at phone and portrait-tablet width, nothing is
 * cut off, squeezed or scrolling sideways:
 *   CLIPPED   content that starts inside an `overflow: hidden/clip` container but runs past it. (An
 *             earlier version of this check treated `hidden` as safe — it clips, it does not scroll — and
 *             missed every data table cut off inside a card, 100–800px of it.)
 *   SQUEEZED  a growing pane in a side-by-side layout narrower than 140px (a fixed 192px nav next to the
 *             content left it ~130px wide on a phone).
 *   SCROLLS   `<main>` itself scrolls sideways.
 * Guard 2 — the sidebar is an off-canvas drawer below `lg` and a plain column from `lg`.
 *
 * Read-only: it only loads pages and clicks tabs, so it needs no setup/teardown. It asserts against whatever
 * data the API holds (a very long name in a non-wrapping row would trip it, which is the point).
 */
import { test, expect, type Page } from "@playwright/test";

type Step = string | { tab: string } | { attr: string };

/** Route → the tabs/views to click through after the page loads. */
const VIEWS: Record<string, Step[]> = {
  "/dashboard": [],
  "/appointments": ["Lista", "Lista de Espera"],
  "/appointments/new": [],
  "/patients": [],
  "/patients/new": [],
  "/billing": ["Entradas", "Despesas", "Faturas", "Saldos em Aberto"],
  "/records": [{ tab: "Histórico" }],
  "/health-plans": ["Planos"],
  "/staff": ["Calendário de Disponibilidade", "Turnos"],
  "/settings": [{ attr: "[data-settings-tab]" }],
  "/parametrizacoes": ["Gestão de Serviços"],
  "/whatsapp": [],
  "/analytics": [],
  "/access": ["Perfis", "Utilizadores"],
};

/** Runs in the page. Returns human-readable problems; empty = fine. */
function findProblems(): string[] {
  const main = document.querySelector("main")!;
  const problems: string[] = [];
  const describe = (el: Element) =>
    `${el.tagName.toLowerCase()}.${String(el.className).split(" ").filter(Boolean).slice(0, 3).join(".")} "${(el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 30)}"`;

  for (const el of main.querySelectorAll("*")) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (el.closest(".fc-event")) continue; // FullCalendar clips a long event title to its box, by design
    let p = el.parentElement;
    let anc: { el: Element; o: string } | null = null;
    while (p && p !== main) {
      const o = getComputedStyle(p).overflowX;
      if (o === "hidden" || o === "clip" || o === "auto" || o === "scroll") { anc = { el: p, o }; break; }
      p = p.parentElement;
    }
    if (!anc || anc.o === "auto" || anc.o === "scroll") continue; // not clipped, or it scrolls
    const ar = anc.el.getBoundingClientRect();
    if (r.left < ar.right - 1 && r.right > ar.right + 1) {
      const pr = el.parentElement!.getBoundingClientRect();
      if (el.parentElement !== anc.el && pr.right > ar.right + 1) continue; // report the outermost offender only
      problems.push(`CLIPPED +${Math.round(r.right - ar.right)}px ${describe(el)}`);
    }
  }
  for (const el of main.querySelectorAll("*")) {
    const cs = getComputedStyle(el);
    if (cs.display !== "flex" || cs.flexDirection !== "row" || el.children.length < 2) continue;
    for (const k of el.children) {
      const w = k.getBoundingClientRect().width;
      const text = (k.textContent || "").trim();
      if (k.matches("div,section,aside,main") && getComputedStyle(k).flexGrow !== "0" && w > 0 && w < 140 && text.length > 20 && k.querySelector("table, h2, h3, input, button")) {
        problems.push(`SQUEEZED ${Math.round(w)}px ${describe(k)}`);
      }
    }
  }
  if (main.scrollWidth - main.clientWidth > 1) problems.push(`SCROLLS sideways by ${main.scrollWidth - main.clientWidth}px`);
  return problems.slice(0, 6);
}

async function expectFits(page: Page, where: string) {
  expect(await page.evaluate(findProblems), where).toEqual([]);
}

for (const width of [390, 820]) {
  test.describe(`${width}px wide`, () => {
    test.use({ viewport: { width, height: 900 } });
    test.setTimeout(240_000); // a route plus all its tabs, against a dev server

    for (const [route, steps] of Object.entries(VIEWS)) {
      test(`${route} fits (every tab)`, async ({ page }) => {
        await page.goto(route, { waitUntil: "networkidle" });
        await page.waitForTimeout(400);
        await expectFits(page, `${route} (load)`);

        for (const step of steps) {
          if (typeof step === "string") {
            await page.getByRole("button", { name: step }).first().click();
            await page.waitForTimeout(500);
            await expectFits(page, `${route} › ${step}`);
          } else if ("tab" in step) {
            await page.getByRole("tab", { name: step.tab }).click();
            await page.waitForTimeout(500);
            await expectFits(page, `${route} › ${step.tab}`);
          } else {
            const tabs = page.locator(step.attr);
            for (let i = 0; i < (await tabs.count()); i++) {
              await tabs.nth(i).click();
              await page.waitForTimeout(500);
              await expectFits(page, `${route} › ${await tabs.nth(i).getAttribute("data-settings-tab")}`);
            }
          }
        }
      });
    }
  });
}

// /exams and /visits are mock-only modules: middleware redirects them to /dashboard (HIDDEN_PATHS) and they are out
// of the nav, so nobody can reach their non-responsive grids and tables. This is the tripwire for un-hiding them:
// when it fails, add the routes to VIEWS above (and fix what that finds) in the same change, then delete this test.
for (const route of ["/exams", "/visits"]) {
  test(`${route} is still hidden — un-hide it only together with an entry in VIEWS above`, async ({ page }) => {
    await page.goto(route);
    await expect(page).toHaveURL(/\/dashboard$/);
  });
}

test.describe("sidebar drawer", () => {
  test.describe("on a phone", () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test("is closed until the menu button opens it, then closes after navigating", async ({ page }) => {
      await page.goto("/dashboard");
      const nav = page.locator("#app-sidebar");
      await expect(nav).toBeHidden(); // `invisible` when closed: out of the tab order and the a11y tree

      await page.getByRole("button", { name: "Abrir menu" }).click();
      await expect(nav).toBeVisible();

      await nav.getByRole("link", { name: "Registos Clínicos" }).click();
      await expect(page).toHaveURL(/\/records$/);
      await expect(nav).toBeHidden();
    });

    test("Escape closes it", async ({ page }) => {
      await page.goto("/dashboard");
      await page.getByRole("button", { name: "Abrir menu" }).click();
      await expect(page.locator("#app-sidebar")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.locator("#app-sidebar")).toBeHidden();
    });
  });

  test.describe("on a desktop", () => {
    test.use({ viewport: { width: 1280, height: 800 } });

    test("is always visible and there is no menu button", async ({ page }) => {
      await page.goto("/dashboard");
      await expect(page.locator("#app-sidebar")).toBeVisible();
      await expect(page.getByRole("button", { name: "Abrir menu" })).toBeHidden();
    });
  });
});
