import { expect, test, type Page } from "@playwright/test";
import {
  pendingCount,
  signIn,
  smallControls,
  startInspection,
  waitForFirstSync,
  waitSynced,
} from "./helpers";

// What a worker in the field sees about their own device: the sync status panel, the install prompt,
// storage protection, and controls big enough to hit with a thumb.

declare global {
  interface Window {
    __persistCalls: number;
    __installPrompted: number;
  }
}

test("the sync status panel shows what is waiting and sends it on 'Try again now'", async ({
  page,
  context,
}) => {
  await signIn(page);
  await waitForFirstSync(page);
  await context.setOffline(true);
  await startInspection(page);
  await page.getByLabel("Notes").fill("waiting in the panel");

  await page.getByRole("link", { name: /^\d+ not sent yet · Last sent/ }).click();
  await expect(page.getByRole("heading", { name: "Sending" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Waiting to be sent" })).toContainText(
    "new inspection",
  );
  await expect(
    page.getByText("Changes waiting to be sent").locator("xpath=following-sibling::dd"),
  ).toHaveText("1");

  // Offline, "Try again now" tries and says honestly why it did not work.
  await page.getByRole("button", { name: "Try again now" }).click();
  await expect(page.getByRole("region", { name: "Waiting to be sent" })).toContainText(
    "Couldn't reach the office. Check your signal.",
  );
  await expect(page.getByRole("region", { name: "Waiting to be sent" })).toContainText(
    "tried 1 time",
  );
  await expect(page.getByText(/Couldn't send\. Trying again/)).toBeVisible();

  // Back online it goes out and the panel empties.
  await context.setOffline(false);
  await page.getByRole("button", { name: "Try again now" }).click();
  await expect(page.getByText("Nothing is waiting")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("All your work has been sent.")).toBeVisible();
  expect(await pendingCount(page)).toBe(0);
});

test("the browser is asked to protect local data after the first sync, and the panel reports the answer", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.__persistCalls = 0;
    let granted = false;
    Object.defineProperty(navigator, "storage", {
      value: {
        persisted: async () => granted,
        persist: async () => {
          window.__persistCalls++;
          granted = true;
          return true;
        },
        estimate: async () => ({}),
      },
    });
  });
  await page.goto("/login");
  expect(await page.evaluate(() => window.__persistCalls)).toBe(0); // not before signing in and syncing
  await signIn(page);
  await waitForFirstSync(page);
  await expect.poll(() => page.evaluate(() => window.__persistCalls)).toBe(1);
  await page.getByRole("link", { name: /^\d+ not sent yet · Last sent/ }).click();
  await expect(page.getByText(/^Kept safe\. Your saved work stays/)).toBeVisible();
});

async function offerInstall(page: Page) {
  await page.evaluate(() => {
    window.__installPrompted = 0;
    const event = new Event("beforeinstallprompt", { cancelable: true }) as Event & {
      prompt: () => Promise<void>;
      userChoice: Promise<{ outcome: string }>;
    };
    event.prompt = async () => {
      window.__installPrompted++;
    };
    event.userChoice = Promise.resolve({ outcome: "accepted" });
    window.dispatchEvent(event);
  });
}

test("the install prompt appears when the browser allows it and uses its own dialog", async ({
  page,
}) => {
  await signIn(page);
  await expect(page.getByRole("button", { name: "Install" })).toHaveCount(0);
  await offerInstall(page);
  await page.getByRole("button", { name: "Install" }).click();
  expect(await page.evaluate(() => window.__installPrompted)).toBe(1);
  await expect(page.getByRole("button", { name: "Install" })).toHaveCount(0);
});

test("'Not now' is remembered across visits", async ({ page }) => {
  await signIn(page);
  await offerInstall(page);
  await page.getByRole("button", { name: "Not now" }).click();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Assignments", exact: true })).toBeVisible();
  await offerInstall(page);
  await expect(page.getByRole("button", { name: "Install" })).toHaveCount(0);
});

test("every control a worker taps is at least 44 px each way", async ({ page }) => {
  await signIn(page);
  await expect(page.getByRole("region", { name: "North plant" })).toBeVisible();
  const pages: [string, () => Promise<void>][] = [
    ["assignments", async () => {}],
    [
      "inspection",
      async () => {
        await startInspection(page);
        await page.getByLabel("Notes").fill("size check");
        await page.getByRole("button", { name: "Submit inspection" }).click(); // shows the error state too
      },
    ],
    [
      "sync status",
      async () => {
        await page.getByRole("link", { name: /^\d+ not sent yet · Last sent/ }).click();
        await expect(page.getByRole("heading", { name: "Sending" })).toBeVisible();
      },
    ],
  ];
  const tooSmall: string[] = [];
  for (const [name, go] of pages) {
    await go();
    const found = await smallControls(page);
    tooSmall.push(...found.map((f) => `${name}: ${f}`));
  }
  expect(tooSmall).toEqual([]);
});
