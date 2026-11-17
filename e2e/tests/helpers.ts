import { expect, type Page } from "@playwright/test";

/** Seeded by `python manage.py seed_demo` (scripts/e2e.sh does this). */
export const WORKER = { username: "worker1", password: "demo-password-1" };

export async function signIn(page: Page, who = WORKER) {
  await page.goto("/login");
  await page.getByLabel("Username").fill(who.username);
  // exact: the show/hide button's label also contains the word "password"
  await page.getByLabel("Password", { exact: true }).fill(who.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Assignments", exact: true })).toBeVisible();
}

/** Wait until a service worker is installed and controlling this page, so offline reloads work. */
export async function waitForServiceWorkerControl(page: Page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  // The first load is not controlled; a reload after activation is.
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
}

/** Collect anything that would show up as an error in the browser console, including CSP violations. */
export function collectBrowserErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`console.error: ${msg.text()}`);
  });
  return errors;
}
