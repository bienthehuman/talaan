import { expect, test } from "@playwright/test";
import { pendingCount, serverRecords, signIn, startInspection } from "./helpers";

// Scenario 2, client half: the server applies a push but the response is lost. The app retries the
// same mutation and ends up synced, with exactly one record on the server.
// Requests are rewritten with page.route, which a service worker would hide: block it here.
test.use({ serviceWorkers: "block" });

test("a lost response after commit is retried and applied exactly once", async ({ page }) => {
  await signIn(page);
  await expect(page.getByRole("region", { name: "North plant" })).toBeVisible();

  const pushes: { mutationIds: string[]; status: number }[] = [];
  await page.route("**/api/sync/push/**", async (route) => {
    const first = pushes.length === 0;
    const body = route.request().postDataJSON() as { mutations: { mutation_id: string }[] };
    const headers = first
      ? { ...route.request().headers(), "x-fault": "drop-after-commit" }
      : route.request().headers();
    const response = await route.fetch({ headers });
    pushes.push({
      mutationIds: body.mutations.map((m) => m.mutation_id),
      status: response.status(),
    });
    await route.fulfill({ response });
  });

  const note = `lost response ${Date.now()}`;
  const id = await startInspection(page);
  await page.getByLabel("Notes").fill(note);

  await expect(page.getByText("Sent", { exact: true })).toBeVisible({ timeout: 30_000 });
  expect(await pendingCount(page)).toBe(0);

  // The first answer was the injected 503 (the server had already committed); the retry carried the
  // very same mutation id and got the stored answer.
  expect(pushes.length).toBeGreaterThanOrEqual(2);
  expect(pushes[0]!.status).toBe(503);
  expect(pushes[1]!.status).toBe(200);
  expect(pushes[1]!.mutationIds).toEqual(pushes[0]!.mutationIds);

  const matching = (await serverRecords(page)).filter((r) => r.id === id);
  expect(matching).toHaveLength(1);
  expect(matching[0]).toMatchObject({ version: 1, data: { notes: note } });
});
