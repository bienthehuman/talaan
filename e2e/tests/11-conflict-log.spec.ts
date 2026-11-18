import { expect, test } from "@playwright/test";
import { ADMIN, signIn } from "./helpers";

// The admin sees what the server refused. The conflict is made over the API with two device ids,
// which is what two phones syncing the same record look like to the server.

test("a conflict shows up in the admin's log, and can be filtered out", async ({
  page,
  request,
}) => {
  const login = await request.post("/api/auth/token/", {
    data: { username: "worker1", password: "demo-password-1" },
  });
  const { access } = await login.json();
  const headers = { Authorization: `Bearer ${access}`, "X-Client-Schema": "1" };
  const assignments = await (await request.get("/api/assignments/", { headers })).json();
  const assignmentId = assignments.results.find(
    (a: { site_name: string }) => a.site_name === "North plant",
  ).id;

  const record = crypto.randomUUID();
  const push = async (device: string, mutation: object) => {
    const response = await request.post("/api/sync/push/", {
      headers,
      data: { device_id: device, client_schema: 1, app_version: "e2e", mutations: [mutation] },
    });
    return (await response.json()).results[0];
  };
  const mutation = (op: string, base: number, fields: object, extra: object = {}) => ({
    mutation_id: crypto.randomUUID(),
    record_id: record,
    op,
    base_version: base,
    fields,
    ...extra,
  });
  await push(
    crypto.randomUUID(),
    mutation("create", 0, { notes: "start" }, { assignment_id: assignmentId }),
  );
  await push(crypto.randomUUID(), mutation("update", 1, { notes: "first device" }));
  const second = await push(crypto.randomUUID(), mutation("update", 1, { notes: "second device" }));
  expect(second.status).toBe("conflict");

  await signIn(page, ADMIN);
  await page.getByRole("link", { name: "Conflict log" }).click();
  const link = page.locator(`a[href="/manage/review/${record}"]`);
  await expect(link).toBeVisible();
  const row = page.getByRole("row").filter({ has: link });
  await expect(row).toContainText("worker1");
  await expect(row).toContainText("Conflict: Same field changed on two devices");
  await expect(row).toContainText("notes");
  await expect(row.getByRole("cell").nth(5)).toHaveText("No"); // the worker has not changed it since

  await page.getByLabel("Kind").selectOption("Rejections");
  await expect(link).toHaveCount(0);
  await page.getByLabel("Kind").selectOption("Conflicts");
  await link.click();
  await expect(page.getByRole("region", { name: "History" })).toContainText(
    "Change not applied (conflict)",
  );
});
