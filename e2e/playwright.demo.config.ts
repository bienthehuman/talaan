import { defineConfig, devices } from "@playwright/test";

// The scripted demo walkthrough (scripts/demo.sh). It drives the real app against the compose stack and
// records what it does. With DEMO_VIDEO=0 it runs fast and records nothing: CI does that, so the demo
// cannot rot unnoticed.
const record = process.env.DEMO_VIDEO !== "0";

export default defineConfig({
  testDir: "./demo",
  outputDir: "./demo-output",
  workers: 1,
  retries: 0,
  timeout: 240_000,
  reporter: [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:8080",
    viewport: { width: 1000, height: 640 },
    serviceWorkers: "allow",
    bypassCSP: true, // only so the demo can draw its captions on the page
    video: record ? { mode: "on", size: { width: 1000, height: 640 } } : "off",
    launchOptions: { slowMo: record ? 120 : 0 },
  },
});
