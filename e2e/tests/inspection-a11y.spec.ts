import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { signIn, startInspection } from "./helpers";

// The accessibility gate for the form page, which needs a record to exist (see a11y.spec.ts).
for (const scheme of ["light", "dark"] as const) {
  test(`the inspection form has no accessibility violations (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.addInitScript((s) => localStorage.setItem("talaan.theme", s), scheme);
    await signIn(page);
    await expect(page.getByRole("region", { name: "North plant" })).toBeVisible();
    await startInspection(page);
    await page.getByLabel("Notes").fill("a11y check");
    await page.getByRole("button", { name: "Submit inspection" }).click(); // shows the field errors too
    await expect(page.getByRole("alert")).toBeVisible();

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
      .analyze();
    expect(
      results.violations.map((v) => `${v.id}: ${v.help} ${v.nodes.map((n) => n.target.join(" "))}`),
    ).toEqual([]);
  });
}
