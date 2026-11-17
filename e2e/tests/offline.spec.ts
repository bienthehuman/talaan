import { expect, test } from "@playwright/test";
import { signIn, waitForServiceWorkerControl } from "./helpers";

// The PoC claim starts here: the app has to open with no network at all.

test("the app shell opens with the network off after one visit", async ({ page, context }) => {
  await page.goto("/login");
  await waitForServiceWorkerControl(page);

  await context.setOffline(true);
  await page.reload();

  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(page.getByText(/You're offline/)).toBeVisible();
});

test("a deep link opens offline and renders the client's 404", async ({ page, context }) => {
  await page.goto("/login");
  await waitForServiceWorkerControl(page);

  await context.setOffline(true);
  await page.goto("/some/deep/link");
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
});

test("a signed-in worker opens the app offline and stays signed in", async ({ page, context }) => {
  await signIn(page);
  await waitForServiceWorkerControl(page);

  await context.setOffline(true);
  await page.reload();

  await expect(page.getByRole("heading", { name: "Assignments", exact: true })).toBeVisible();
  await expect(page.getByText("worker1")).toBeVisible();
  await expect(page.getByText(/You're offline/)).toBeVisible();
});

test("the offline banner goes away when the connection returns", async ({ page, context }) => {
  await page.goto("/login");
  await waitForServiceWorkerControl(page);

  await context.setOffline(true);
  await expect(page.getByText(/You're offline/)).toBeVisible();
  await context.setOffline(false);
  await expect(page.getByText(/You're offline/)).toBeHidden();
});

test("API calls are never served from the service worker cache", async ({ page, context }) => {
  await page.goto("/login");
  await waitForServiceWorkerControl(page);

  // Online: the health endpoint answers.
  const online = await page.evaluate(() => fetch("/api/health/").then((r) => r.status));
  expect(online).toBe(200);

  // Offline: it must fail, not return a stale cached answer.
  await context.setOffline(true);
  const failed = await page.evaluate(() =>
    fetch("/api/health/").then(
      () => "answered",
      () => "failed",
    ),
  );
  expect(failed).toBe("failed");
});
