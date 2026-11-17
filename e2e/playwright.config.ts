import { defineConfig, devices } from "@playwright/test";

// The stack under test is the compose stack: `bash scripts/e2e.sh` (or `docker compose up -d --wait`).
// 127.0.0.1 rather than localhost: the compose port is bound to IPv4 only.
const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:8080";

export default defineConfig({
  testDir: "./tests",
  // Each test gets a fresh browser context (own storage and service worker), so parallel is safe.
  // Capped so the Postgres, Django and nginx containers are not starved on a laptop or a CI runner.
  workers: 2,
  retries: 0, // a flaky test is a bug to fix, not to retry
  forbidOnly: !!process.env.CI,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    serviceWorkers: "allow",
    trace: "retain-on-failure",
  },
  projects: [
    // The worker app is mobile first, so everything also runs at a phone viewport.
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
});
