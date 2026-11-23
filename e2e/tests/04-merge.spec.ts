import { expect, test } from "@playwright/test";
import {
  createSyncedInspection,
  openInspection,
  secondDevice,
  serverRecords,
  signIn,
  waitSynced,
} from "./helpers";

// Scenario 4: two devices of one worker edit different fields while offline. Both edits are applied
// and every device, and the server, ends up holding both values.
test("edits to different fields on two devices are both kept", async ({
  page,
  context,
  browser,
  baseURL,
}) => {
  await signIn(page);
  const id = await createSyncedInspection(page, "start");
  const other = await secondDevice(browser, baseURL);
  await openInspection(other.page, id);

  await context.setOffline(true);
  await other.context.setOffline(true);
  await page.getByLabel("Hours run (required)").fill("10");
  await other.page.getByLabel("Notes").fill("leak near the gasket");
  await expect(page.getByText("Saved on this device", { exact: true })).toBeVisible();
  await expect(other.page.getByText("Saved on this device", { exact: true })).toBeVisible();

  await context.setOffline(false);
  await waitSynced(page);
  await other.context.setOffline(false);
  await waitSynced(other.page);

  // The device that synced first picks up the other's change on its next cycle.
  await page.getByRole("button", { name: "Send now" }).click();
  for (const device of [page, other.page]) {
    await expect(device.getByLabel("Hours run (required)")).toHaveValue("10");
    await expect(device.getByLabel("Notes")).toHaveValue("leak near the gasket");
    await expect(device.getByText("Needs your decision")).toHaveCount(0);
  }

  const stored = (await serverRecords(page)).find((r) => r.id === id);
  expect(stored).toMatchObject({
    version: 3, // created, then one edit from each device
    data: { notes: "leak near the gasket", hours_run: 10 },
  });
  await other.context.close();
});
