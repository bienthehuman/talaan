import { expect, test, type Locator, type Page } from "@playwright/test";
import { ADMIN, pendingCount, serverRecords, signIn, waitSynced } from "./helpers";

// Phase 6 exit scenario (FORM_BUILDER_PLAN.md section 4.8): an admin builds a form with the
// keyboard and no JSON, publishes it and assigns it; a worker fills it in offline, and the fields
// appear in the order they were built, which is not the order Postgres jsonb would keep.
//
// Set BUILDER_SCREENSHOT=<path> to also save the builder as a README screenshot (on a fresh stack:
// the form is then named plainly, and form names are unique).

/** Keyboard only: move focus to the control (as Tab would) and press a key. */
async function press(target: Locator, key = "Enter") {
  await target.focus();
  await target.press(key);
}

async function retype(target: Locator, text: string) {
  await target.focus();
  await target.press("ControlOrMeta+a");
  await target.page().keyboard.type(text);
}

const cardFor = (page: Page, label: string) =>
  page.getByRole("region", { name: new RegExp(`^\\d+\\. ${label}$`) });

async function addField(page: Page, kind: string, label: string) {
  const add = page.getByRole("region", { name: "Add a field" });
  await press(add.getByRole("button", { name: kind, exact: true }));
  // The new card's label has focus.
  await page.keyboard.type(label);
  return cardFor(page, label);
}

test("an admin builds a form without JSON, and a worker fills it offline in the built order", async ({
  page,
  browser,
  baseURL,
}) => {
  test.setTimeout(120_000);
  const tag = `${Date.now()}`.slice(-6);
  const shot = process.env.BUILDER_SCREENSHOT;
  const formName = shot ? "Tank check" : `Tank check ${tag}`;
  const site = `Tank farm ${tag}`;

  await signIn(page, ADMIN);
  await page.getByRole("link", { name: "Forms" }).click();
  await page.getByLabel("Name").fill(formName);
  await press(page.getByRole("button", { name: "Create form" }));
  await expect(page.getByRole("heading", { name: `${formName} · version 1` })).toBeVisible();

  const hours = await addField(page, "Whole number", "Hours run");
  await hours.getByLabel("Smallest value (optional)").pressSequentially("0");
  await press(hours.getByLabel(/^Required/), "Space");

  const tank = await addField(page, "Choice", "Tank level");
  await retype(tank.getByLabel("Choice 1"), "Full");
  await retype(tank.getByLabel("Choice 2"), "Half");
  await press(tank.getByRole("button", { name: "Add a choice" }));
  await page.keyboard.type("Empty");
  await press(tank.getByLabel(/^Required/), "Space");

  await addField(page, "Yes / No", "Leaks found");
  await addField(page, "Long text", "Remarks");

  // Move Remarks from fourth to second, with the keyboard; focus stays on the button.
  const up = cardFor(page, "Remarks").getByRole("button", { name: "Move up Remarks" });
  await press(up);
  await up.press("Enter");
  await expect(up).toBeFocused();
  const built = ["Hours run", "Remarks", "Tank level", "Leaks found"];
  await expect(page.getByRole("heading", { level: 3 })).toHaveText(
    built.map((label, i) => `${i + 1}. ${label}`),
  );

  await expect(page.getByText("This form is ready to publish.")).toBeVisible();
  await expect(page.getByText("Draft saved.")).toBeVisible({ timeout: 10_000 });
  if (shot) {
    await page.setViewportSize({ width: 1280, height: 1040 });
    // The choice card, beside Publish and the preview (they stay in view on a wide screen).
    await cardFor(page, "Tank level").evaluate((h) => {
      h.scrollIntoView({ block: "start" });
      window.scrollBy(0, -24);
    });
    await page.screenshot({ path: shot });
  }

  await press(page.getByRole("button", { name: "Publish version 1" }));
  await press(page.getByRole("dialog").getByRole("button", { name: "Publish" }));
  await expect(page.getByText(`Published ${formName} version 1.`)).toBeVisible();

  // Assign it to worker1.
  await page.getByRole("link", { name: "Assignments" }).click();
  await page.getByLabel("Form version").selectOption({ label: `${formName} v1` });
  await page.locator("#a-worker").selectOption({ label: "worker1" });
  await page.getByLabel("Site", { exact: true }).fill(site);
  await page.getByRole("button", { name: "Assign" }).click();
  await expect(
    page.getByText(new RegExp(`Assigned ${formName} at ${site} to worker1`)),
  ).toBeVisible();

  // The worker syncs the assignment, then loses the signal and fills it in.
  const worker = await browser.newContext({ baseURL, serviceWorkers: "block" });
  const wp = await worker.newPage();
  await signIn(wp);
  const card = wp.getByRole("region", { name: site });
  await expect(card).toBeVisible({ timeout: 20_000 });
  await worker.setOffline(true);
  await expect(wp.getByText(/You're offline/)).toBeVisible();

  await card.getByRole("button", { name: "New inspection" }).click();
  await expect(wp).toHaveURL(/\/submissions\/[0-9a-f-]{36}$/);
  const id = wp.url().split("/").pop()!;
  await expect(wp.getByRole("heading", { name: formName })).toBeVisible();
  const shown = await wp
    .locator("main")
    .locator(".field > label, .field--choice > legend")
    .allInnerTexts();
  expect(shown.map((t) => t.replace(" (required)", "").trim())).toEqual(built);

  await wp.getByLabel("Hours run (required)").fill("1200");
  await wp.getByLabel("Remarks").fill("Small weep at the drain valve");
  await wp.getByLabel("Tank level (required)").selectOption("Half");
  // The answer is saved to IndexedDB first, so the radio shows as chosen a moment later.
  const no = wp.getByRole("group", { name: "Leaks found" }).getByLabel("No");
  await no.click();
  await expect(no).toBeChecked();
  await expect(wp.getByText("Saved on this device", { exact: true })).toBeVisible();
  expect(await pendingCount(wp)).toBeGreaterThan(0);

  await worker.setOffline(false);
  await waitSynced(wp);
  const stored = (await serverRecords(wp)).find((r) => r.id === id);
  expect(stored?.data).toEqual({
    hours_run: 1200,
    remarks: "Small weep at the drain valve",
    tank_level: "Half",
    leaks_found: false,
  });
  await worker.close();
});
