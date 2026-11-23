import { expect, test, type Page } from "@playwright/test";
import { pendingCount, serverRecords, signIn, startInspection, WORKER } from "./helpers";

// Scenario 9: the access token expires in the middle of a sync. The outbox is untouched, and sync
// resumes after a token refresh or a new login, with nothing applied twice.
// Requests are rewritten with page.route, which a service worker would hide: block it here.
test.use({ serviceWorkers: "block" });

/** Make three inspections while offline so they go out in one batch when the connection returns. */
async function threeOffline(page: Page, context: import("@playwright/test").BrowserContext) {
  await signIn(page);
  await expect(page.getByRole("region", { name: "North plant" })).toBeVisible();
  await context.setOffline(true);
  const ids: string[] = [];
  for (let i = 0; i < 3; i++) {
    ids.push(await startInspection(page));
    await page.getByLabel("Notes").fill(`expiry ${Date.now()} #${i}`);
    await page.getByRole("link", { name: "‹ Assignments" }).click();
    await expect(page.getByRole("button", { name: "New inspection" }).first()).toBeVisible();
  }
  expect(await pendingCount(page)).toBe(3);
  return ids;
}

/** Answer 401 "after one mutation was applied" to the first push only. */
async function expireOnFirstPush(page: Page) {
  let first = true;
  await page.route("**/api/sync/push/**", async (route) => {
    const headers = first
      ? { ...route.request().headers(), "x-fault": "expire-token=1" }
      : route.request().headers();
    first = false;
    await route.continue({ headers });
  });
}

test("a token that expires mid-batch is refreshed and every change lands exactly once", async ({
  page,
  context,
}) => {
  const ids = await threeOffline(page, context);
  await expireOnFirstPush(page);
  const refreshes: number[] = [];
  page.on("response", (r) => {
    if (r.url().includes("/api/auth/token/refresh/")) refreshes.push(r.status());
  });

  await context.setOffline(false);
  await expect.poll(() => pendingCount(page), { timeout: 30_000 }).toBe(0);

  expect(refreshes).toEqual([200]);
  const records = await serverRecords(page);
  for (const id of ids) {
    const matching = records.filter((r) => r.id === id);
    expect(matching).toHaveLength(1);
    expect(matching[0]!.version).toBe(1);
  }
});

test("when the session cannot be refreshed the outbox is kept and signing in again resumes", async ({
  page,
  context,
}) => {
  const ids = await threeOffline(page, context);
  await expireOnFirstPush(page);
  await page.route("**/api/auth/token/refresh/**", (route) =>
    route.fulfill({
      status: 401,
      contentType: "application/problem+json",
      body: JSON.stringify({ code: "unauthenticated", detail: "Token is invalid or expired" }),
    }),
  );

  await context.setOffline(false);
  await expect(page.getByText(/For your security, enter your password again/)).toBeVisible({
    timeout: 30_000,
  });
  expect(await pendingCount(page)).toBe(3); // nothing lost, nothing dropped

  await page.unroute("**/api/auth/token/refresh/**");
  await page.getByLabel("Password", { exact: true }).fill(WORKER.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();

  await expect.poll(() => pendingCount(page), { timeout: 30_000 }).toBe(0);
  await expect(page.getByText(/For your security, enter your password again/)).toBeHidden();
  const records = await serverRecords(page);
  for (const id of ids) {
    const matching = records.filter((r) => r.id === id);
    expect(matching).toHaveLength(1);
    expect(matching[0]!.version).toBe(1);
  }
});
