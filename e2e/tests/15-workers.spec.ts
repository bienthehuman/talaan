import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { ADMIN, signIn, smallControls } from "./helpers";

// The workers page (slice 7.2) in a real browser: invite, the link shown once, a new link, revoke;
// tap targets and the axe gate with the link panel open, at phone and desktop widths. Accepting
// the invite is slice 7.3.

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

async function axe(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
    .analyze();
  return results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`);
}

async function inviteSomeone(page: Page): Promise<{ username: string; link: string }> {
  const username = `inv${Date.now()}${Math.floor(Math.random() * 1000)}`;
  await page.getByLabel("Username", { exact: true }).fill(username);
  await page.getByLabel("First name (optional)").fill("Test");
  await page.getByLabel("Last name (optional)").fill("Invitee");
  await page.getByRole("button", { name: "Create invite link" }).click();
  await expect(page.getByRole("heading", { name: "Invite link for Test Invitee" })).toBeFocused();
  const link = await page.getByRole("textbox", { name: "Invite link" }).inputValue();
  expect(link).toMatch(/\/invite#[A-Za-z0-9_-]{43}$/);
  return { username, link };
}

test("an admin invites a worker, copies the link, replaces it and revokes it", async ({ page }) => {
  const urls: string[] = [];
  page.on("request", (r) => urls.push(r.url()));
  await signIn(page, ADMIN);
  await page.getByRole("link", { name: "Workers" }).click();
  await expect(page.getByRole("heading", { name: "Workers", level: 1 })).toBeVisible();

  const { username, link } = await inviteSomeone(page);
  await page.getByRole("button", { name: "Copy link" }).click();
  await expect(page.getByText("Link copied.")).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link);
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("textbox", { name: "Invite link" })).toHaveCount(0);

  const row = page.getByRole("row").filter({ hasText: username });
  await expect(row).toContainText("Waiting");
  await page.getByRole("button", { name: `New link for ${username}` }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Make new link" }).click();
  const second = await page.getByRole("textbox", { name: "Invite link" }).inputValue();
  expect(second).not.toBe(link);
  await page.getByRole("button", { name: "Done" }).click();

  await page.getByRole("button", { name: `Revoke invite for ${username}` }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Revoke invite" }).click();
  await expect(row).toContainText("Revoked");
  await expect(page.getByRole("button", { name: `Revoke invite for ${username}` })).toHaveCount(0);

  // The token is only ever in the fragment, never in a request.
  for (const token of [link, second].map((l) => l.split("#")[1]!)) {
    expect(urls.filter((u) => u.includes(token))).toEqual([]);
  }
});

for (const width of [390, 1366]) {
  test(`the workers page is 44 px and axe-clean in light and dark at ${width} px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await signIn(page, ADMIN);
    for (const theme of ["light", "dark"]) {
      await page.evaluate((t) => localStorage.setItem("talaan.theme", t), theme);
      await page.goto("/manage/workers");
      await expect(
        page.getByRole("table", { name: "Invites" }).or(page.getByText("No invites")),
      ).toBeVisible();
      expect(await axe(page), `${theme}, form`).toEqual([]);
      await inviteSomeone(page);
      expect(await smallControls(page)).toEqual([]);
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(scrollWidth).toBeLessThanOrEqual(width);
      expect(await axe(page), `${theme}, link panel`).toEqual([]);
    }
  });
}
