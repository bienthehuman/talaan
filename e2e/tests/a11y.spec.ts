import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { ADMIN, signIn } from "./helpers";

// The accessibility gate (docs/DESIGN_SYSTEM.md section 5): no violations in light, dark and
// "system" dark, on every screen. Colour contrast is checked here because it needs a real browser.

const SCREENS: { name: string; path: string; signedIn?: boolean; admin?: boolean }[] = [
  { name: "sign in", path: "/login" },
  { name: "assignments", path: "/", signedIn: true },
  { name: "sync status", path: "/sync", signedIn: true },
  { name: "review queue", path: "/manage/review", signedIn: true, admin: true },
  { name: "forms", path: "/manage/forms", signedIn: true, admin: true },
  { name: "form builder", path: "/manage/forms/1/edit", signedIn: true, admin: true },
  { name: "assignments admin", path: "/manage/assignments", signedIn: true, admin: true },
  { name: "conflict log", path: "/manage/conflicts", signedIn: true, admin: true },
  { name: "page not found", path: "/no-such-page" },
  { name: "style guide", path: "/styleguide" },
];

const THEMES = [
  { name: "light", stored: "light" },
  { name: "dark", stored: "dark" },
  { name: "system, OS dark", stored: null, colorScheme: "dark" as const },
  { name: "system, OS light", stored: null, colorScheme: "light" as const },
];

async function scan(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
    .analyze();
  return results.violations.map(
    (v) =>
      `${v.id} [${v.impact}]: ${v.help}\n` +
      v.nodes
        .slice(0, 4)
        .map((n) => `    ${n.target.join(" ")}  ${n.failureSummary?.split("\n")[1] ?? ""}`)
        .join("\n"),
  );
}

for (const theme of THEMES) {
  for (const screen of SCREENS) {
    test(`${screen.name} has no accessibility violations (${theme.name})`, async ({ page }) => {
      if (theme.colorScheme) await page.emulateMedia({ colorScheme: theme.colorScheme });
      await page.addInitScript((stored) => {
        if (stored) localStorage.setItem("talaan.theme", stored);
      }, theme.stored);

      if (screen.signedIn) {
        await signIn(page, screen.admin ? ADMIN : undefined);
        if (screen.path !== "/") await page.goto(screen.path);
      } else await page.goto(screen.path);
      await page.waitForLoadState("networkidle");

      expect(await scan(page)).toEqual([]);
    });
  }
}

test("the confirm dialog has no violations when open (dark)", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("talaan.theme", "dark"));
  await page.goto("/styleguide");
  await page.getByRole("button", { name: "Delete submission…" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(await scan(page)).toEqual([]);
});
