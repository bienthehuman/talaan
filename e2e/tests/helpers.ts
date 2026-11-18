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

/** Open the first assignment's "New inspection" and return the new record's id. */
export async function startInspection(page: Page): Promise<string> {
  await page.getByRole("button", { name: "New inspection" }).first().click();
  await expect(page).toHaveURL(/\/submissions\/[0-9a-f-]{36}$/);
  return page.url().split("/").pop()!;
}

/** The number in the header's "N pending" text (the outbox size on this device). */
export async function pendingCount(page: Page): Promise<number> {
  const text = await page.getByText(/^\d+ pending · Last sync/).innerText();
  return Number(text.split(" ")[0]);
}

interface ServerRecord {
  id: string;
  version: number;
  data: Record<string, unknown>;
  status: string;
}

/** What the server holds for this worker, read through the real pull endpoint. */
export async function serverRecords(page: Page): Promise<ServerRecord[]> {
  return page.evaluate(async () => {
    const session = JSON.parse(localStorage.getItem("talaan.session")!);
    const response = await fetch("/api/sync/pull/?cursor=0&limit=500", {
      headers: { Authorization: `Bearer ${session.access}`, "X-Client-Schema": "1" },
    });
    return (await response.json()).records;
  });
}
