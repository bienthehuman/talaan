import { expect, test } from "@playwright/test";
import {
  adminAction,
  openInspection,
  pendingCount,
  secondDevice,
  signIn,
  startInspection,
  waitSynced,
} from "./helpers";

// Scenario 10: a worker edits a submission that has meanwhile been approved. The server answers
// `rejected: locked`, the worker gets a clear message, and nothing is retried.

test("an edit to an approved submission is refused clearly and not retried", async ({
  page,
  context,
  request,
  browser,
  baseURL,
}) => {
  // Device A completes and submits an inspection; device B still has it as a draft.
  await signIn(page);
  const id = await startInspection(page);
  await page.getByLabel("Oil level (required)").selectOption("ok");
  await page.getByLabel("Hours run (required)").fill("40");
  await page
    .getByRole("group", { name: "Coolant level is correct (required)" })
    .getByLabel("Yes")
    .click();
  await waitSynced(page);
  const other = await secondDevice(browser, baseURL);
  await openInspection(other.page, id);

  await page.getByRole("button", { name: "Submit inspection" }).click();
  await expect(page.getByText("Submitted. It can no longer be changed.")).toBeVisible();
  await waitSynced(page);
  await adminAction(request, id, "approve");

  // Device B edits offline, still believing it is a draft, then reconnects.
  const pushes: string[] = [];
  other.page.on("request", (r) => {
    if (r.url().includes("/api/sync/push/")) pushes.push(r.url());
  });
  await other.context.setOffline(true);
  await other.page.getByLabel("Notes").fill("added after approval");
  await other.context.setOffline(false);

  await expect(
    other.page.getByText(
      /didn't accept this change: This inspection is approved and can no longer be changed\./,
    ),
  ).toBeVisible({ timeout: 30_000 });
  await expect(other.page.getByText(/^Not accepted/)).toBeVisible();
  await expect(other.page.getByLabel("Notes")).toBeDisabled();
  expect(await pendingCount(other.page)).toBe(1); // kept on the device until the person decides

  // No retry loop: another sync and a wait send nothing more for that record.
  const sent = pushes.length;
  await other.page.getByRole("button", { name: "Send now" }).click();
  await other.page.waitForTimeout(3_000);
  expect(pushes.length).toBe(sent);

  // The way out is to discard, which shows the approved version.
  await other.page.getByRole("button", { name: "Discard my changes" }).click();
  await other.page.getByRole("dialog").getByRole("button", { name: "Discard" }).click();
  await expect(
    other.page.getByText("Approved. It can no longer be changed.", { exact: true }),
  ).toBeVisible();
  expect(await pendingCount(other.page)).toBe(0);
  await other.context.close();
  void context;
});
