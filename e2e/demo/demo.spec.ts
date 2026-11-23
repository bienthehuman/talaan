import { expect, test, type Page } from "@playwright/test";
import {
  createSyncedInspection,
  openInspection,
  secondDevice,
  serverRecords,
  signIn,
  startInspection,
  waitForServiceWorkerControl,
  waitSynced,
} from "../tests/helpers";

// Two short films, each a real run of the app, not a mock-up:
//   1. work offline, reload, reconnect while the server drops its first answer: no duplicate
//   2. two phones edit the same field offline: a conflict, nothing overwritten, then a resolution
const record = process.env.DEMO_VIDEO !== "0";

/** A caption bar at the foot of the page. It is redrawn after every navigation. */
async function say(page: Page, text: string, seconds = 2.5) {
  await page.evaluate((t) => {
    let bar = document.getElementById("demo-caption");
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "demo-caption";
      Object.assign(bar.style, {
        position: "fixed",
        left: "0",
        right: "0",
        bottom: "0",
        padding: "14px 20px",
        background: "rgba(22, 24, 29, 0.94)", // the band colour (DESIGN_SYSTEM.md section 2)
        borderTop: "3px solid #4fc3cc",
        color: "#fff",
        font: "600 20px Barlow, system-ui, sans-serif",
        textAlign: "center",
        zIndex: "99999",
      });
      document.body.appendChild(bar);
    }
    bar.textContent = t;
  }, text);
  if (record) await page.waitForTimeout(seconds * 1000);
}

test("offline work survives a reload and a dropped response, and lands exactly once", async ({
  page,
  context,
}) => {
  await signIn(page);
  await expect(page.getByRole("region", { name: "North plant" })).toBeVisible();
  await waitForServiceWorkerControl(page);
  await say(page, "Signed in once, with a connection. The app is now on this phone.");

  await context.setOffline(true);
  await say(page, "The network goes away. The worker carries on.");
  const id = await startInspection(page);
  await page.getByLabel("Oil level (required)").selectOption("low");
  await page
    .getByLabel("Hours run (required)")
    .pressSequentially("120", { delay: record ? 120 : 0 });
  await page
    .getByLabel("Notes")
    .pressSequentially("Oil is low, topping up", { delay: record ? 60 : 0 });
  await say(page, "Every edit is saved on the device as it is typed: 'Saved on this device'.");

  await page.waitForTimeout(800); // let the last keystrokes reach IndexedDB before the page goes away
  await page.reload();
  await expect(page.getByLabel("Notes")).toHaveValue("Oil is low, topping up");
  await say(
    page,
    "Reloaded with no network at all. Nothing was lost, and it is still waiting to sync.",
  );

  // The first push will reach the server and commit, but its answer is thrown away.
  let dropped = false;
  await context.route("**/api/sync/push/**", async (route) => {
    const headers = { ...route.request().headers() };
    if (!dropped) {
      dropped = true;
      headers["x-fault"] = "drop-after-commit";
    }
    await route.continue({ headers });
  });
  await say(page, "Back online. We make the server commit the first sync, then drop its answer.");
  await context.setOffline(false);

  await waitSynced(page);
  const stored = (await serverRecords(page)).filter((r) => r.id === id);
  await say(
    page,
    `The app retried the same change. The server holds ${stored.length} record with this id, at version ${stored[0]?.version}.`,
    3.5,
  );
  expect(stored).toHaveLength(1);
  expect(dropped).toBe(true);
});

test("two phones change the same field: a conflict, nothing overwritten, then a decision", async ({
  page,
  browser,
  baseURL,
}) => {
  // Phone A is not filmed: it only does what a second phone would do.
  const a = await secondDevice(browser, baseURL);
  const id = await createSyncedInspection(a.page, "start");

  await signIn(page);
  await openInspection(page, id);
  await say(page, "Phone B. It has the same inspection as phone A, notes: 'start'.");

  await a.context.setOffline(true);
  await context(page).setOffline(true);
  await say(page, "Both phones lose their connection and both change the Notes field.");
  await a.page.getByLabel("Notes").fill("from phone A");
  await page.getByLabel("Notes").fill("");
  await page.getByLabel("Notes").pressSequentially("from phone B", { delay: record ? 60 : 0 });

  await a.context.setOffline(false);
  await waitSynced(a.page);
  await say(page, "Phone A reconnects first. Its change reaches the server.");

  await context(page).setOffline(false);
  const panel = page.getByRole("region", { name: "Needs your decision" });
  await expect(panel).toBeVisible({ timeout: 30_000 });
  await say(
    page,
    "Phone B's change is NOT applied over it. The app stops and shows both values.",
    3.5,
  );

  await panel.getByRole("radio", { name: "Keep mine: from phone B" }).check();
  await say(page, "The worker chooses. Their own value is kept as a new version.");
  await panel.getByRole("button", { name: "Apply my choices" }).click();
  await waitSynced(page);
  const stored = (await serverRecords(page)).find((r) => r.id === id);
  await say(
    page,
    `Resolved. The server now holds version ${stored?.version}: "${stored?.data.notes}".`,
    3.5,
  );
  expect(stored?.data.notes).toBe("from phone B");

  await a.page.getByRole("button", { name: "Send now" }).click();
  await expect(a.page.getByLabel("Notes")).toHaveValue("from phone B", { timeout: 20_000 });
  await a.context.close();
});

const context = (page: Page) => page.context();
