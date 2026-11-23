import { expect, test } from "@playwright/test";
import {
  adminAction,
  createSyncedInspection,
  pendingCount,
  serverRecords,
  signIn,
  waitSynced,
} from "./helpers";

// Scenario 6: an admin deletes a submission while a worker is editing it offline. The worker is told,
// their edits are kept until they decide, and nothing is applied to a deleted record.

async function deletedWhileEditing(
  page: import("@playwright/test").Page,
  context: import("@playwright/test").BrowserContext,
  request: import("@playwright/test").APIRequestContext,
) {
  await signIn(page);
  const id = await createSyncedInspection(page, "start");
  await context.setOffline(true);
  await page.getByLabel("Notes").fill("edited offline");
  await expect(page.getByText("Saved on this device", { exact: true })).toBeVisible();

  await adminAction(request, id, "delete");

  await context.setOffline(false);
  const panel = page.getByRole("region", { name: "Needs your decision" });
  await expect(panel.getByText(/An admin deleted this inspection/)).toBeVisible({
    timeout: 30_000,
  });
  return { id, panel };
}

test("the worker is told, keeps their edits, and can discard them", async ({
  page,
  context,
  request,
}) => {
  const { id, panel } = await deletedWhileEditing(page, context, request);

  await expect(page.getByLabel("Notes")).toHaveValue("edited offline"); // kept
  expect(await pendingCount(page)).toBe(1);
  const stored = (await serverRecords(page)).find((r) => r.id === id);
  expect(stored).toMatchObject({ deleted: true, version: 2, data: { notes: "start" } }); // not applied

  await panel.getByRole("button", { name: "Discard my changes" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Discard" }).click();
  await expect(page.getByRole("heading", { name: "Inspection not found" })).toBeVisible();
  expect(await pendingCount(page)).toBe(0);
});

test("when an admin restores it, the kept edits are sent again and applied", async ({
  page,
  context,
  request,
}) => {
  const { id } = await deletedWhileEditing(page, context, request);

  await adminAction(request, id, "restore");
  await page.getByRole("button", { name: "Send now" }).click();

  await waitSynced(page);
  await expect(page.getByRole("region", { name: "Needs your decision" })).toHaveCount(0);
  expect(await pendingCount(page)).toBe(0);
  const stored = (await serverRecords(page)).find((r) => r.id === id);
  expect(stored).toMatchObject({
    deleted: false,
    version: 4, // created, deleted, restored, then the worker's edit
    data: { notes: "edited offline" },
  });
});
