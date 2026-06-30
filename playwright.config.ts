import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.PORT ?? 3000);
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false, // multi-context sync tests share the same dev server
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // The E2E suite shares one local dev server and mutable test auth/data.
  // Keep it serial everywhere so multi-context game rehearsals cannot race
  // each other's login/reset state.
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
  webServer: {
    command: "npm run dev",
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    // Gate /api/_test/* routes open and mock external services for the test
    // run. These env vars MUST mirror tests/e2e/helpers/env.ts (TEST_SECRET).
    env: {
      TEST_AUTH_ENABLED: "1",
      TEST_SECRET: "local-test-secret",
      MOCK_EXTERNAL: "1",
    },
  },
});
