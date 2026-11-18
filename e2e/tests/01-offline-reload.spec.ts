import { expect, test } from "@playwright/test";
import {
  pendingCount,
  serverRecords,
  signIn,
  startInspection,
  waitForServiceWorkerControl,
} from "./helpers";

// Scenario 1: create and edit offline, reload the browser. Data and outbox survive, and the badge
// says "Saved on this device", never "Synced". Then the connection returns and it all reaches the server.

test("work done offline survives a reload and syncs when the connection returns", async ({
  page,
  context,
}) => {
  await signIn(page);
  await expect(page.getByRole("region", { name: "North plant" })).toBeVisible(); // downloaded
  await waitForServiceWorkerControl(page);
  await expect(page.getByRole("region", { name: "North plant" })).toBeVisible();

  await context.setOffline(true);
  await expect(page.getByText(/You're offline/)).toBeVisible();

  const note = `offline ${Date.now()}`;
  const id = await startInspection(page);
  await page.getByLabel("Oil level (required)").selectOption("low");
  await page.getByLabel("Notes").fill(note);
  await expect(page.getByText("Saved on this device", { exact: true })).toBeVisible();
  expect(await pendingCount(page)).toBe(1);

  // Reload with no network: the app, the data and the outbox all come back from the device.
  await page.reload();
  await expect(page.getByLabel("Notes")).toHaveValue(note);
  await expect(page.getByLabel("Oil level (required)")).toHaveValue("low");
  await expect(page.getByText("Saved on this device", { exact: true })).toBeVisible();
  await expect(page.getByText("Synced", { exact: true })).toHaveCount(0);
  expect(await pendingCount(page)).toBe(1);

  // Back online: the engine sends it without being asked, and the badge changes.
  await context.setOffline(false);
  await expect(page.getByText("Synced", { exact: true })).toBeVisible({ timeout: 20_000 });
  expect(await pendingCount(page)).toBe(0);

  const stored = (await serverRecords(page)).find((r) => r.id === id);
  expect(stored).toMatchObject({ version: 1, data: { oil_level: "low", notes: note } });
});
