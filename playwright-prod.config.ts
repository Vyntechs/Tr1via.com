// Playwright config for PROD smokes. Different from playwright.config.ts:
//   - No webServer (we hit https://tr1via.com, not localhost)
//   - Higher per-test timeout (real network latency + real Anthropic)
//   - Only the prod-ui-smoke spec runs from this config

import { defineConfig, devices } from "@playwright/test";

const BASE_URL = process.env.SMOKE_BASE_URL ?? "https://tr1via.com";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: ["prod-ui-smoke.spec.ts"],
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});
