import { expect, test } from "@playwright/test";

// Keyboard pass (docs/DESIGN_SYSTEM.md section 5): everything reachable and usable without a mouse,
// with a visible focus indicator at each stop.

test("the skip link is the first stop and jumps to the main content", async ({ page }) => {
  await page.goto("/login");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to content" });
  await expect(skip).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#main$/);
});

test("a worker can sign in using only the keyboard", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Username").focus();
  await page.keyboard.type("worker1");
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Password", { exact: true })).toBeFocused();
  await page.keyboard.type("demo-password-1");
  await page.keyboard.press("Enter"); // submits the form
  await expect(page.getByRole("heading", { name: "Assignments", exact: true })).toBeVisible();
});

test("every interactive element shows a visible focus ring", async ({ page }) => {
  await page.goto("/login");
  const stops = [
    "Skip to content",
    "Talaan",
    "Display settings",
    "Username",
    "Show password",
    "Sign in",
  ];
  for (let i = 0; i < stops.length; i++) {
    await page.keyboard.press("Tab");
    const outline = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement;
      const cs = getComputedStyle(el);
      // Buttons and links get a 3 px outline; text fields a highlighted 2 px border instead.
      return {
        width: parseFloat(cs.outlineWidth),
        style: cs.outlineStyle,
        field: el.matches(".input") && parseFloat(cs.borderTopWidth) >= 2,
      };
    });
    if (!outline.field) {
      expect(outline.style, `stop ${i + 1}`).not.toBe("none");
      expect(outline.width, `stop ${i + 1}`).toBeGreaterThanOrEqual(2);
    }
  }
});

test("the confirm dialog keeps focus out of the page behind it, and Escape restores focus", async ({
  page,
}) => {
  await page.goto("/styleguide");
  const trigger = page.getByRole("button", { name: "Delete submission…" });
  await trigger.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  // A native modal dialog makes the page behind it inert. Focus may pass through the browser's own
  // UI (activeElement is then <body>), but it must never land on content outside the dialog.
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press("Tab");
    const where = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return "browser";
      return el.closest("dialog")
        ? "dialog"
        : `page: ${el.tagName} ${el.textContent?.slice(0, 20)}`;
    });
    expect(["dialog", "browser"], `Tab ${i + 1} landed on ${where}`).toContain(where);
  }

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});
