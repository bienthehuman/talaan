import { expect, test } from "@playwright/test";
import { signIn, WORKER } from "./helpers";

test("a worker signs in, sees their name and signs out", async ({ page }) => {
  await signIn(page);
  await expect(page).toHaveTitle("Assignments · Talaan");
  await expect(page.getByText(WORKER.username)).toBeVisible();
  await expect(page.getByText(/^0 pending · Last sync: /)).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("talaan.session"))).toBeNull();
});

test("a wrong password is explained and nothing is stored", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Username").fill(WORKER.username);
  await page.getByLabel("Password", { exact: true }).fill("not-the-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();

  await expect(page.getByRole("alert")).toHaveText("Wrong username or password.");
  expect(await page.evaluate(() => localStorage.getItem("talaan.session"))).toBeNull();
});

test("a visitor who is not signed in is sent to sign-in", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
});

test("an admin signs in and is reported as admin by the API", async ({ page }) => {
  await signIn(page, { username: "admin", password: "demo-password-1" });
  const session = await page.evaluate(() => JSON.parse(localStorage.getItem("talaan.session")!));
  expect(session.user.role).toBe("admin");
});

test("the password can be shown and hidden", async ({ page }) => {
  await page.goto("/login");
  const password = page.getByLabel("Password", { exact: true });
  await password.fill("secret");
  await expect(password).toHaveAttribute("type", "password");
  await page.getByRole("button", { name: "Show password" }).click();
  await expect(password).toHaveAttribute("type", "text");
  await page.getByRole("button", { name: "Hide password" }).click();
  await expect(password).toHaveAttribute("type", "password");
});
