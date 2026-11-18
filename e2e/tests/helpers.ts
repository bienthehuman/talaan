import { expect, type APIRequestContext, type Browser, type Page } from "@playwright/test";

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
  deleted: boolean;
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

/** The header shows a time (not "never") once a sync cycle has completed on this device. */
export async function waitForFirstSync(page: Page) {
  await expect(page.getByText(/^\d+ pending · Last sync: \d/)).toBeVisible({ timeout: 20_000 });
}

export async function waitSynced(page: Page) {
  await expect(page.getByText("Synced", { exact: true })).toBeVisible({ timeout: 30_000 });
}

/** Open an inspection by its id and wait for its form. The device must already have it. */
export async function openInspection(page: Page, id: string) {
  await page.goto(`/submissions/${id}`);
  await expect(page.getByRole("heading", { name: "Generator inspection" })).toBeVisible();
}

/** A second browser profile for the same worker: its own storage, its own device id. */
export async function secondDevice(browser: Browser, baseURL: string | undefined) {
  const context = await browser.newContext({ baseURL, serviceWorkers: "block" });
  const page = await context.newPage();
  await signIn(page);
  await waitForFirstSync(page);
  return { context, page };
}

/** Act as an admin over the API (there is no admin screen yet). */
export async function adminAction(
  request: APIRequestContext,
  recordId: string,
  action: "delete" | "restore" | "approve" | "return" | "edit",
  body: Record<string, unknown> = {},
) {
  const login = await request.post("/api/auth/token/", {
    data: { username: "admin", password: "demo-password-1" },
  });
  const { access } = await login.json();
  const response = await request.post(`/api/admin/submissions/${recordId}/actions/`, {
    headers: { Authorization: `Bearer ${access}` },
    data: { action, ...body },
  });
  const result = await response.json();
  expect(result.status, JSON.stringify(result)).toBe("applied");
  return result;
}

/** Worker1 starts an inspection on this page, saves it with these notes and waits until synced. */
export async function createSyncedInspection(page: Page, notes: string): Promise<string> {
  const id = await startInspection(page);
  await page.getByLabel("Notes").fill(notes);
  await waitSynced(page);
  return id;
}
