import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { ADMIN, signIn, smallControls } from "./helpers";

// The form builder screen (slice 6.4) in a real browser: every kind of card on screen, then tap
// targets and the axe gate in light and dark, at phone and desktop widths. Colour contrast is
// only measurable here. The full build-publish-fill scenario is slice 6.5.

const KINDS = ["Short text", "Long text", "Choice", "Yes / No", "Whole number", "Number"];

async function axe(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
    .analyze();
  return results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`);
}

async function builderWithEveryKind(page: Page) {
  await signIn(page, ADMIN);
  await page.getByRole("link", { name: "Forms" }).click();
  await page.getByLabel("Name").fill(`Builder check ${Date.now()}`);
  await page.getByRole("button", { name: "Create form" }).click();
  await expect(page.getByRole("tab", { name: "Builder" })).toHaveAttribute("aria-selected", "true");
  const add = page.getByRole("region", { name: "Add a field" });
  for (const kind of KINDS) {
    await add.getByRole("button", { name: kind, exact: true }).click();
    await page.keyboard.type(`${kind} question`);
  }
  // One card with a problem, and one with its field ID open.
  await add.getByRole("button", { name: "Short text", exact: true }).click();
  await page.locator("summary").first().click();
  await expect(page.getByText("Draft saved.")).toBeVisible({ timeout: 10_000 });
}

for (const width of [390, 1366]) {
  test(`the builder's controls are 44 px and axe-clean in light and dark at ${width} px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await builderWithEveryKind(page);
    expect(await smallControls(page)).toEqual([]);
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(width);

    for (const theme of ["light", "dark"]) {
      await page.evaluate((t) => localStorage.setItem("talaan.theme", t), theme);
      await page.reload();
      await expect(page.getByRole("heading", { level: 3 }).first()).toBeVisible();
      expect(await axe(page), theme).toEqual([]);
    }
  });
}

test("fields reorder with the keyboard alone", async ({ page }) => {
  await builderWithEveryKind(page);
  const titles = page.getByRole("heading", { level: 3 });
  await expect(titles.first()).toHaveText("1. Short text question");
  const down = page.getByRole("button", { name: "Move down Short text question" });
  await down.focus();
  await page.keyboard.press("Enter");
  await expect(titles.nth(1)).toHaveText("2. Short text question");
  await expect(down).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(titles.nth(2)).toHaveText("3. Short text question");
});
