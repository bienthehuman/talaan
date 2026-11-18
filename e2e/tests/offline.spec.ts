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

test("the self-hosted fonts load offline and nothing is fetched from another origin", async ({
  page,
  context,
  baseURL,
}) => {
  const foreign: string[] = [];
  page.on("request", (req) => {
    const url = new URL(req.url());
    if (url.protocol.startsWith("http") && url.origin !== new URL(baseURL!).origin)
      foreign.push(req.url());
  });
  await page.goto("/login");
  await waitForServiceWorkerControl(page);

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();

  // ADR 0012: Barlow comes from the precache, so headings and body use it with no network.
  const loaded = await page.evaluate(async () => {
    await document.fonts.ready;
    return [...document.fonts]
      .filter((f) => f.status === "loaded")
      .map((f) => `${f.family.replaceAll('"', "")} ${f.weight}`);
  });
  expect(loaded).toEqual(expect.arrayContaining(["Barlow 400", "Barlow Semi Condensed 700"]));
  expect(foreign).toEqual([]);
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
