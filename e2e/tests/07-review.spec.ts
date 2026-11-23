import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser } from "@playwright/test";
import { ADMIN, signIn, startInspection, waitSynced } from "./helpers";

// The review flow end to end: a worker submits offline, the admin finds it in the queue, approves or
// returns it, and the worker's device sees the decision after its next sync.

async function adminPage(browser: Browser, baseURL: string | undefined) {
  const context = await browser.newContext({ baseURL, serviceWorkers: "block" });
  const page = await context.newPage();
  await signIn(page, ADMIN);
  return { context, page };
}

/** A worker page with a complete inspection, submitted while offline, then brought back online. */
async function submittedOffline(
  page: import("@playwright/test").Page,
  context: import("@playwright/test").BrowserContext,
) {
  await signIn(page);
  await expect(page.getByRole("region", { name: "North plant" })).toBeVisible();
  await context.setOffline(true);
  const id = await startInspection(page);
  await page.getByLabel("Oil level (required)").selectOption("low");
  await page.getByLabel("Hours run (required)").fill("77");
  await page
    .getByRole("group", { name: "Coolant level is correct (required)" })
    .getByLabel("Yes")
    .click();
  await page.getByLabel("Notes").fill("reviewed in e2e");
  await page.getByRole("button", { name: "Submit inspection" }).click();
  await expect(page.getByText("Submitted. It can no longer be changed.")).toBeVisible();
  return id;
}

test("the admin approves what a worker submitted offline, and the worker sees it", async ({
  page,
  context,
  browser,
  baseURL,
}) => {
  const id = await submittedOffline(page, context);
  const admin = await adminPage(browser, baseURL);
  const link = admin.page.locator(`a[href="/manage/review/${id}"]`);
  await expect(link).toHaveCount(0); // still only on the worker's device

  await context.setOffline(false);
  await waitSynced(page);

  await admin.page.reload();
  await expect(link).toBeVisible();
  await link.click();
  await expect(
    admin.page.getByRole("heading", { name: /Generator inspection · North plant/ }),
  ).toBeVisible();
  const answers = admin.page.getByRole("region", { name: "Answers" });
  await expect(answers.getByText("low", { exact: true })).toBeVisible();
  await expect(answers.getByText("77")).toBeVisible();
  await expect(answers.getByText("reviewed in e2e")).toBeVisible();
  await expect(admin.page.getByRole("region", { name: "History" })).toContainText("Submitted");

  await admin.page.getByRole("button", { name: "Approve" }).click();
  await expect(admin.page.getByText("Approved.")).toBeVisible();
  await expect(admin.page.getByRole("region", { name: "History" })).toContainText("Approved");
  await expect(admin.page.getByRole("button", { name: "Approve" })).toHaveCount(0);

  await page.getByRole("button", { name: "Send now" }).click();
  await expect(
    page.getByText("Approved. It can no longer be changed.", { exact: true }),
  ).toBeVisible({
    timeout: 20_000,
  });
  await admin.context.close();
});

test("a returned submission is editable again for the worker, with the reason", async ({
  page,
  context,
  browser,
  baseURL,
}) => {
  const id = await submittedOffline(page, context);
  await context.setOffline(false);
  await waitSynced(page);

  const admin = await adminPage(browser, baseURL);
  await admin.page.goto(`/manage/review/${id}`);
  await admin.page.getByRole("button", { name: "Return to worker…" }).click();
  const dialog = admin.page.getByRole("dialog", { name: "Return to the worker" });
  await dialog.getByRole("button", { name: "Return" }).click();
  await expect(dialog.getByText("Enter a reason.")).toBeVisible(); // a reason is required
  await dialog.getByLabel(/Reason/).fill("Hours look wrong");
  await dialog.getByRole("button", { name: "Return" }).click();
  await expect(admin.page.getByText("Sent back to the worker.")).toBeVisible();
  await expect(admin.page.getByRole("region", { name: "History" })).toContainText(
    "Hours look wrong",
  );

  await page.getByRole("button", { name: "Send now" }).click();
  await expect(page.getByLabel("Notes")).toBeEnabled({ timeout: 20_000 });
  await page.getByLabel("Notes").fill("fixed after review");
  await waitSynced(page);
  await admin.context.close();
});

test("a worker cannot open the admin pages", async ({ page }) => {
  await signIn(page);
  await page.goto("/manage/review");
  await expect(page.getByText("You don't have access to this page")).toBeVisible();
});

for (const scheme of ["light", "dark"] as const) {
  test(`the review detail page has no accessibility violations (${scheme})`, async ({
    page,
    context,
    browser,
    baseURL,
  }) => {
    const id = await submittedOffline(page, context);
    await context.setOffline(false);
    await waitSynced(page);
    const admin = await adminPage(browser, baseURL);
    await admin.page.addInitScript((s) => localStorage.setItem("talaan.theme", s), scheme);
    await admin.page.emulateMedia({ colorScheme: scheme });
    await admin.page.goto(`/manage/review/${id}`);
    await expect(admin.page.getByRole("region", { name: "History" })).toBeVisible();
    const results = await new AxeBuilder({ page: admin.page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
      .analyze();
    expect(
      results.violations.map((v) => `${v.id}: ${v.help} ${v.nodes.map((n) => n.target.join(" "))}`),
    ).toEqual([]);
    await admin.context.close();
  });
}
