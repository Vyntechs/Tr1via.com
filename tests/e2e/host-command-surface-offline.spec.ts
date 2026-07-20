import { expect, test } from "@playwright/test";
import { loginAsHost, resetTestData, seedNight } from "./helpers/host-laptop";

// This deliberately proves only host-command continuity while offline.
// Game Sync receipt retry/convergence is covered deterministically in
// HostGameStatus.test.tsx, where observation acknowledgements can be dropped
// without adding a privileged E2E fixture or weakening the production route.
test("offline mode retains the last safe host command and venue picture", async ({
  context,
  page,
}) => {
  test.setTimeout(120_000);
  const email = `command-offline-${Date.now()}@tr1via.test`;
  const { hostId } = await loginAsHost(page, email, "Recovery Host");
  const seed = await seedNight(page, hostId, "two-games-ready");

  try {
    await page.setViewportSize({ width: 430, height: 932 });
    await page.goto(`/host/phone/${seed.nightId}`);
    const primary = page.getByRole("button", { name: "Start Game 1" });
    await expect(primary).toBeVisible({ timeout: 30_000 });

    await context.setOffline(true);
    await expect(primary).toBeVisible();
    await page.getByRole("button", { name: "TV preview" }).click();
    await expect(page.getByRole("region", { name: "Venue TV preview" })).toBeVisible();
    await expect(page.getByTestId("tv-lobby")).toBeAttached();

    await context.setOffline(false);
    await page.getByRole("button", { name: "Board" }).click();
    await expect(primary).toBeVisible();
  } finally {
    await context.setOffline(false).catch(() => {});
    await resetTestData(page).catch(() => {});
  }
});
