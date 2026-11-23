import { expect, test, type Page } from "@playwright/test";
import { ADMIN, signIn, waitSynced } from "./helpers";

// An admin writes a form, publishes it, assigns it to a worker, and the worker fills it in. Then the
// assignment is cancelled and the worker can no longer start new inspections from it.

const unique = () => `${Date.now()}-${Math.floor(Math.random() * 1000)}`;

function schema(title: string) {
  return JSON.stringify(
    {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      title,
      properties: {
        tank_level: { type: "string", title: "Tank level", enum: ["full", "half", "empty"] },
        pressure: { type: "number", title: "Pressure (bar)", minimum: 0, maximum: 10 },
      },
      required: ["tank_level"],
      additionalProperties: false,
      "x-order": ["tank_level", "pressure"],
    },
    null,
    2,
  );
}

async function replaceSchema(page: Page, text: string) {
  const editor = page.getByLabel("Form schema (JSON)");
  await editor.fill(text);
}

test("publish a form, assign it, the worker fills it in, then cancel the assignment", async ({
  page,
  browser,
  baseURL,
}) => {
  const tag = unique();
  const formName = `Boiler check ${tag}`;
  const site = `Boiler room ${tag}`;
  await signIn(page, ADMIN);

  // A new form opens in the builder; this test writes JSON in the advanced tab.
  await page.getByRole("link", { name: "Forms" }).click();
  await page.getByLabel("Name").fill(formName);
  await page.getByRole("button", { name: "Create form" }).click();
  await expect(page.getByRole("heading", { name: `${formName} · version 1` })).toBeVisible();
  await page.getByRole("tab", { name: "JSON (advanced)" }).click();

  // Text that is not JSON cannot be published, and the page says why.
  await replaceSchema(page, "{ not json");
  await expect(page.getByText(/isn't valid JSON:/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Publish version 1" })).toBeDisabled();

  // A schema the server would refuse is explained in the server's words.
  await replaceSchema(
    page,
    JSON.stringify({ type: "object", properties: { a: { type: "array" } } }),
  );
  await expect(page.getByText("This form can't be published yet:")).toBeVisible();
  await expect(page.getByRole("button", { name: "Publish version 1" })).toBeDisabled();

  // A good one: the preview shows what a worker will see.
  await replaceSchema(page, schema(formName));
  await expect(page.getByText("This form is ready to publish.")).toBeVisible();
  const preview = page.getByRole("region", { name: "Preview" });
  await expect(preview.getByLabel("Tank level (required)")).toBeVisible();
  await expect(preview.getByLabel("Pressure (bar)")).toBeVisible();
  await page.getByRole("button", { name: "Publish version 1" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText(`Published ${formName} version 1.`)).toBeVisible();
  const form = page.getByRole("region", { name: formName });
  await expect(form.getByText(/Version 1 · published/)).toBeVisible();

  // Assign it to worker1.
  await page.getByRole("link", { name: "Assignments" }).click();
  await page.getByRole("button", { name: "Assign" }).click();
  await expect(page.getByText("Choose a form version.")).toBeVisible();
  await page.getByLabel("Form version").selectOption({ label: `${formName} v1` });
  await page.locator("#a-worker").selectOption({ label: "worker1" });
  await page.getByLabel("Site", { exact: true }).fill(site);
  await page.getByRole("button", { name: "Assign" }).click();
  await expect(
    page.getByText(new RegExp(`Assigned ${formName} at ${site} to worker1`)),
  ).toBeVisible();
  const row = page.getByRole("row", { name: new RegExp(site) });
  await expect(row).toContainText("Active");

  // The worker syncs and fills the new form in.
  const worker = await browser.newContext({ baseURL, serviceWorkers: "block" });
  const wp = await worker.newPage();
  await signIn(wp);
  const card = wp.getByRole("region", { name: site });
  await expect(card).toBeVisible({ timeout: 20_000 });
  await card.getByRole("button", { name: "New inspection" }).click();
  await expect(wp.getByRole("heading", { name: formName })).toBeVisible();
  await wp.getByLabel("Tank level (required)").selectOption("half");
  await wp.getByLabel("Pressure (bar)").fill("4.5");
  await waitSynced(wp);

  // Cancel it: the worker keeps the inspection but cannot start another.
  await row.getByRole("button", { name: `Cancel ${site}` }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Cancel assignment" }).click();
  await expect(page.getByText(/Existing inspections stay/)).toBeVisible();
  await expect(page.getByRole("row", { name: new RegExp(site) })).toHaveCount(0); // hidden from "Active"

  await wp.goto("/");
  await expect(wp.getByRole("region", { name: site }).getByText(/cancelled/)).toBeVisible({
    timeout: 20_000,
  });
  await expect(
    wp.getByRole("region", { name: site }).getByRole("button", { name: "New inspection" }),
  ).toHaveCount(0);
  await worker.close();
});
