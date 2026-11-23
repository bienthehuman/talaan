import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { ADMIN, pendingCount, serverRecords, signIn, smallControls, waitSynced } from "./helpers";

// Phase 7 exit scenario (ADR 0014): an admin invites a worker; the invitee opens the link in their
// own browser, sets a password and is signed in; the admin assigns them a form; they fill it in
// offline and it reaches the server. The invite token never appears in a request URL, and an
// already used link says so.

test("an invited worker sets a password, gets an assignment and fills it in offline", async ({
  page,
  browser,
  baseURL,
}) => {
  test.setTimeout(120_000);
  const tag = `${Date.now()}`.slice(-7);
  const username = `field${tag}`;
  const site = `Pump house ${tag}`;
  const password = `lantern-orchard-${tag}`;

  // The admin invites.
  await signIn(page, ADMIN);
  await page.getByRole("link", { name: "Workers" }).click();
  await page.getByLabel("Username", { exact: true }).fill(username);
  await page.getByLabel("First name (optional)").fill("Rosa");
  await page.getByLabel("Last name (optional)").fill("Lim");
  await page.getByRole("button", { name: "Create invite link" }).click();
  const link = await page.getByRole("textbox", { name: "Invite link" }).inputValue();
  const token = link.split("#")[1]!;
  await page.getByRole("button", { name: "Done" }).click();

  // The invitee opens it in their own browser.
  const invitee = await browser.newContext({ baseURL, serviceWorkers: "block" });
  const wp = await invitee.newPage();
  const urls: string[] = [];
  wp.on("request", (r) => urls.push(r.url()));
  await wp.goto(link);
  await expect(wp.getByRole("heading", { name: "Welcome, Rosa" })).toBeVisible();
  await expect(wp).toHaveURL(/\/invite$/); // the token has left the address bar
  await wp.getByLabel("New password", { exact: true }).fill(password);
  await wp.getByLabel("Repeat the password", { exact: true }).fill(password);
  await wp.getByRole("button", { name: "Set password and sign in" }).click();
  await expect(wp).toHaveURL(/\/$/);
  await expect(wp.getByText(username)).toBeVisible();

  // The admin sees them joined and assigns them a form.
  await page.reload();
  await expect(page.getByRole("row").filter({ hasText: username }).first()).toBeVisible();
  await expect(
    page.getByRole("table", { name: "Invites" }).getByRole("row").filter({ hasText: username }),
  ).toContainText("Joined");
  await page.getByRole("link", { name: "Assignments" }).click();
  await page.getByLabel("Form version").selectOption({ label: "Generator inspection v1" });
  await page.locator("#a-worker").selectOption({ label: username });
  await page.getByLabel("Site", { exact: true }).fill(site);
  await page.getByRole("button", { name: "Assign" }).click();
  await expect(page.getByText(new RegExp(`at ${site} to ${username}`))).toBeVisible();

  // The new worker picks it up, loses the signal, and fills it in.
  await wp.reload();
  const card = wp.getByRole("region", { name: site });
  await expect(card).toBeVisible({ timeout: 20_000 });
  await invitee.setOffline(true);
  await expect(wp.getByText(/You're offline/)).toBeVisible();
  await card.getByRole("button", { name: "New inspection" }).click();
  await expect(wp).toHaveURL(/\/submissions\/[0-9a-f-]{36}$/);
  const id = wp.url().split("/").pop()!;
  await wp.getByLabel("Notes").fill("Seal replaced, no leaks");
  await expect(wp.getByText("Saved on this device", { exact: true })).toBeVisible();
  expect(await pendingCount(wp)).toBeGreaterThan(0);

  await invitee.setOffline(false);
  await waitSynced(wp);
  const stored = (await serverRecords(wp)).find((r) => r.id === id);
  expect(stored?.data).toMatchObject({ notes: "Seal replaced, no leaks" });
  expect(urls.filter((u) => u.includes(token))).toEqual([]);

  // The link is spent: opening it again (signed out, in a fresh browser) says so.
  const later = await browser.newContext({ baseURL, serviceWorkers: "block" });
  const lp = await later.newPage();
  await lp.goto(link);
  await expect(lp.getByRole("alert")).toContainText("already been used");
  await expect(lp.getByRole("link", { name: "Sign in" })).toBeVisible();
  await later.close();
  await invitee.close();
});

test("the password page is 44 px and axe-clean in light and dark on a phone", async ({
  page,
  browser,
  baseURL,
}) => {
  await signIn(page, ADMIN);
  await page.goto("/manage/workers");
  await page.getByLabel("Username", { exact: true }).fill(`look${Date.now()}`);
  await page.getByRole("button", { name: "Create invite link" }).click();
  const link = await page.getByRole("textbox", { name: "Invite link" }).inputValue();

  for (const theme of ["light", "dark"]) {
    const context = await browser.newContext({
      baseURL,
      serviceWorkers: "block",
      viewport: { width: 390, height: 844 },
    });
    await context.addInitScript((t) => localStorage.setItem("talaan.theme", t), theme);
    const invitee = await context.newPage();
    await invitee.goto(link);
    await expect(invitee.getByRole("heading", { name: "Welcome" })).toBeVisible();
    // Show the problems too, so their colours are checked.
    await invitee.getByLabel("New password", { exact: true }).fill("a");
    await invitee.getByRole("button", { name: "Set password and sign in" }).click();
    await expect(invitee.getByText("The two passwords are not the same.")).toBeVisible();
    expect(await smallControls(invitee)).toEqual([]);
    expect(await invitee.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
    const results = await new AxeBuilder({ page: invitee })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
      .analyze();
    expect(
      results.violations.map((v) => `${v.id}: ${v.help}`),
      theme,
    ).toEqual([]);
    await context.close();
  }
});
