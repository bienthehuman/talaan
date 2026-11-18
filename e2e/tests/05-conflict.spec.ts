import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";
import {
  createSyncedInspection,
  openInspection,
  pendingCount,
  secondDevice,
  serverRecords,
  signIn,
  waitSynced,
} from "./helpers";

// Scenario 5: two devices edit the same field while offline. The second to sync gets a conflict,
// nothing is overwritten, and resolving it produces a new applied version.

/** Device A saves "from A" first; device B, offline with "from B" on the same field, then gets the conflict. */
async function sameFieldConflict(
  page: Page,
  context: import("@playwright/test").BrowserContext,
  browser: Browser,
  baseURL: string | undefined,
) {
  await signIn(page);
  const id = await createSyncedInspection(page, "start");
  const other = await secondDevice(browser, baseURL);
  await openInspection(other.page, id);

  await context.setOffline(true);
  await other.context.setOffline(true);
  await page.getByLabel("Notes").fill("from A");
  await other.page.getByLabel("Notes").fill("from B");

  await context.setOffline(false);
  await waitSynced(page);
  await other.context.setOffline(false);
  await expect(other.page.getByRole("region", { name: "Needs your decision" })).toBeVisible({
    timeout: 30_000,
  });
  return { id, other };
}

test("the second device gets a conflict and nothing is overwritten", async ({
  page,
  context,
  browser,
  baseURL,
}) => {
  const { id, other } = await sameFieldConflict(page, context, browser, baseURL);
  const panel = other.page.getByRole("region", { name: "Needs your decision" });

  await expect(panel.getByText("Before either of you: start")).toBeVisible();
  await expect(panel.getByRole("radio", { name: "Keep mine: from B" })).toBeVisible();
  await expect(panel.getByRole("radio", { name: "Use theirs: from A" })).toBeVisible();
  await expect(other.page.getByLabel("Notes")).toHaveValue("from B"); // their own work is still there
  expect(await pendingCount(other.page)).toBe(1); // and still waiting, not dropped

  const stored = (await serverRecords(page)).find((r) => r.id === id);
  expect(stored).toMatchObject({ version: 2, data: { notes: "from A" } }); // A's value stands
  await other.context.close();
});

test("keeping mine applies a new version and the other device sees it", async ({
  page,
  context,
  browser,
  baseURL,
}) => {
  const { id, other } = await sameFieldConflict(page, context, browser, baseURL);
  const panel = other.page.getByRole("region", { name: "Needs your decision" });

  await expect(panel.getByRole("button", { name: "Apply my choices" })).toBeDisabled();
  await panel.getByRole("radio", { name: "Keep mine: from B" }).check();
  await panel.getByRole("button", { name: "Apply my choices" }).click();
  await waitSynced(other.page);
  await expect(other.page.getByRole("region", { name: "Needs your decision" })).toHaveCount(0);

  const stored = (await serverRecords(page)).find((r) => r.id === id);
  expect(stored).toMatchObject({ version: 3, data: { notes: "from B" } });

  await page.getByRole("button", { name: "Sync now" }).click();
  await expect(page.getByLabel("Notes")).toHaveValue("from B");
  await other.context.close();
});

test("using theirs keeps the server's value and sends nothing", async ({
  page,
  context,
  browser,
  baseURL,
}) => {
  const { id, other } = await sameFieldConflict(page, context, browser, baseURL);
  const panel = other.page.getByRole("region", { name: "Needs your decision" });

  await panel.getByRole("radio", { name: "Use theirs: from A" }).check();
  await panel.getByRole("button", { name: "Apply my choices" }).click();
  await waitSynced(other.page);
  await expect(other.page.getByLabel("Notes")).toHaveValue("from A");
  expect(await pendingCount(other.page)).toBe(0);

  const stored = (await serverRecords(page)).find((r) => r.id === id);
  expect(stored).toMatchObject({ version: 2, data: { notes: "from A" } }); // no new version
  await other.context.close();
});

for (const scheme of ["light", "dark"] as const) {
  test(`the conflict panel has no accessibility violations (${scheme})`, async ({
    page,
    context,
    browser,
    baseURL,
  }) => {
    await page.addInitScript((s) => localStorage.setItem("talaan.theme", s), scheme);
    const { other } = await sameFieldConflict(page, context, browser, baseURL);
    await other.page.evaluate((s) => {
      localStorage.setItem("talaan.theme", s);
      document.documentElement.setAttribute("data-theme", s);
    }, scheme);

    const results = await new AxeBuilder({ page: other.page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
      .analyze();
    expect(
      results.violations.map((v) => `${v.id}: ${v.help} ${v.nodes.map((n) => n.target.join(" "))}`),
    ).toEqual([]);
    await other.context.close();
  });
}
