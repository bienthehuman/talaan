import { expect, test } from "@playwright/test";
import { collectBrowserErrors } from "./helpers";

test("the sign-in page loads with a title, a main landmark and no browser errors", async ({
  page,
}) => {
  const errors = collectBrowserErrors(page);
  await page.goto("/login");
  await expect(page).toHaveTitle("Sign in · Talaan");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(page.getByRole("main")).toBeVisible();
  expect(errors).toEqual([]);
});

test("an unknown URL gets the shell and the app's own 404 page", async ({ page }) => {
  const response = await page.goto("/definitely/not/a/page");
  expect(response?.status()).toBe(200); // SPA fallback; the client renders the 404
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  await expect(page).toHaveTitle("Page not found · Talaan");
});

test("the style guide route is present in this e2e build", async ({ page }) => {
  const errors = collectBrowserErrors(page);
  await page.goto("/styleguide");
  await expect(page.getByRole("heading", { name: "Style guide" })).toBeVisible();
  // The swatches and buttons must render without CSP complaints (no inline styles).
  expect(errors).toEqual([]);
});

test("the shell and the API both send security headers", async ({ request }) => {
  for (const path of ["/", "/api/health/"]) {
    const response = await request.get(path);
    const headers = response.headers();
    expect(headers["x-content-type-options"], path).toBe("nosniff");
    expect(headers["x-frame-options"], path).toBe("DENY");
    expect(headers["content-security-policy"], path).toContain("default-src 'self'");
    expect(headers["content-security-policy"], path).toContain("frame-ancestors 'none'");
  }
});

test("the shell is never cached but hashed assets are immutable", async ({ request }) => {
  const shell = await request.get("/");
  expect(shell.headers()["cache-control"]).toBe("no-cache");
  const sw = await request.get("/sw.js");
  expect(sw.headers()["cache-control"]).toBe("no-cache");

  const html = await shell.text();
  const asset = html.match(/\/assets\/[^"]+\.js/)?.[0];
  expect(asset).toBeTruthy();
  const assetResponse = await request.get(asset!);
  expect(assetResponse.headers()["cache-control"]).toContain("immutable");
});

test("the web manifest makes the app installable", async ({ request }) => {
  const manifest = await (await request.get("/manifest.webmanifest")).json();
  expect(manifest.name).toBe("Talaan");
  expect(manifest.display).toBe("standalone");
  const sizes = manifest.icons.map((i: { sizes: string }) => i.sizes);
  expect(sizes).toContain("192x192");
  expect(sizes).toContain("512x512");
});
