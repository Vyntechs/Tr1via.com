// prod-ui-smoke.spec.ts — drives tr1via.com through the host's actual
// browser path. NOT a mocked test. NOT against localhost. This is the
// "when Brandon logs in for real, does the UI he sees actually work"
// validation.
//
// What this proves (and the API-only smoke doesn't):
//   1. /login renders its device-neutral promise and the email input accepts text
//   2. Clicking "Sign in" fires the submit handler → /api/auth/host-access
//      (via the page's wired-in fetch) and, on 200, the client navigates to
//      /host
//   3. /host renders without crashing — either the returning-host dashboard
//      (host-dashboard) or the first-time onboarding (host-onboarding-first)
//      mounts, and no console errors fire on the page
//
// The sign-in button is targeted by data-testid (login-submit), never by
// its visible copy — that label has been renamed before (it once said
// "Send sign-in link"), and a copy change must never break CI again.
//
// What this still doesn't prove:
//   - The setup → topic → generate UI flow (multi-step, slow)
//   - Player + TV surfaces
//   - Reveal sync
//
// Cleans up after itself if it creates any nights (currently does not).

import { test, expect } from "@playwright/test";
import { TID } from "./helpers/selectors";

const FOUNDER_EMAIL = process.env.SMOKE_FOUNDER_EMAIL ?? "brandon@vyntechs.com";

test.describe("prod UI smoke — login → dashboard", () => {
  test.setTimeout(60_000);

  test("founder lands on /host after submitting email", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(`console.error: ${msg.text()}`);
    });

    // 1. /login renders
    await page.goto("/login");
    await expect(
      page.getByRole("heading", { name: "Your game. Your control." }),
    ).toBeVisible();
    const emailInput = page.getByLabel("Email", { exact: true });
    await expect(emailInput).toBeVisible();

    // 2. Submit the form
    await emailInput.fill(FOUNDER_EMAIL);
    await page.getByTestId(TID.login.submit).click();

    // 3. Bypass should route us to /host
    await page.waitForURL(/\/host\b/, { timeout: 30_000 });

    // 4. Either dashboard variant must render. First-time hosts (no completed
    //    night yet) get the OnboardingFirstDashboard; returning hosts get the
    //    regular HostDashboard. Both prove the host page actually mounted
    //    without crashing.
    const dashboard = page.getByTestId("host-dashboard");
    const onboarding = page.getByTestId("host-onboarding-first");
    await expect(dashboard.or(onboarding)).toBeVisible({ timeout: 15_000 });
    if (errors.length > 0) {
      throw new Error(
        `Console errors on /host: ${errors.slice(0, 5).join(" | ")}`,
      );
    }
  });
});
