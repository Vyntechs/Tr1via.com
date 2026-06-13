// connection-degraded.spec.ts — Phase 2: the game KEEPS WORKING through the
// server route when the direct browser→Supabase line is blocked.
//
// Faithful reproduction of the 2026-06-10 venue incident: the site/Vercel was
// reachable (marketing + TV worked) — ONLY the direct browser→Supabase line was
// blocked, so only the live game (which reads directly) went black. We simulate
// that precisely: Playwright aborts the BROWSER's requests to *.supabase.co; the
// dev server's admin calls are a Node process, unaffected — so `/api/room/:code/
// snapshot` (browser→Vercel→Supabase) still serves the game.
//
// Asserts: under the block the host console + player phone keep rendering the
// game via the route (NOT the black placeholder / "switch to a hotspot"
// screen), show the calm "backup" indicator, and recover on their own when the
// block lifts. Targets data-testids only (e2e-target-testid-not-visible-copy).

import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { loginAsHost, seedNight, openHostLive, startGame, resetTestData } from "./helpers/host-laptop";
import { joinPhone } from "./helpers/player-phone";
import { TID } from "./helpers/selectors";

const HOST_EMAIL = "degraded-host@tr1via.test";
const SUPABASE_GLOB = "**/*.supabase.co/**";

async function blockBrowserSupabase(context: BrowserContext): Promise<void> {
  await context.route(SUPABASE_GLOB, (route) => route.abort());
}
async function unblockBrowserSupabase(context: BrowserContext): Promise<void> {
  await context.unroute(SUPABASE_GLOB);
}

test.describe.configure({ mode: "serial" });

test.describe("degraded network — game keeps working via the server route", () => {
  test.setTimeout(120_000);

  let host: BrowserContext;
  let phone: BrowserContext;

  test.beforeAll(async ({ browser }) => {
    host = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    phone = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const cleanup = await host.newPage();
    await resetTestData(cleanup);
    await cleanup.close();
  });

  test.afterAll(async () => {
    try {
      const cleanup = await host.newPage();
      await resetTestData(cleanup);
      await cleanup.close();
    } catch {
      /* already closed */
    }
    await Promise.all(
      [host, phone]
        .filter((c): c is BrowserContext => c !== undefined)
        .map((c) => c.close().catch(() => {})),
    );
  });

  test("host console keeps rendering via the route when the direct line is blocked", async () => {
    const hostPage: Page = await host.newPage();
    const { hostId } = await loginAsHost(hostPage, HOST_EMAIL);
    const seed = await seedNight(hostPage, hostId, "happy-path-3-cats-game1");
    await startGame(hostPage, seed.game1.id);

    await openHostLive(hostPage, seed.nightId);
    await expect(hostPage.getByTestId(TID.connection.hostUnreachable)).toHaveCount(0);

    // Block ONLY the browser's direct Supabase line (site stays up).
    await blockBrowserSupabase(host);
    await hostPage.reload();

    // The live console still renders (not the black placeholder / unreachable),
    // and the calm backup banner shows.
    await expect(hostPage.getByTestId(TID.hostLiveConsole.root)).toBeVisible({ timeout: 30_000 });
    await expect(hostPage.getByTestId(TID.connection.hostBackupBanner)).toBeVisible({ timeout: 20_000 });
    await expect(hostPage.getByTestId(TID.connection.hostUnreachable)).toHaveCount(0);

    // Recovery: lift the block → backup banner clears on its own.
    await unblockBrowserSupabase(host);
    await expect(hostPage.getByTestId(TID.connection.hostBackupBanner)).toHaveCount(0, { timeout: 30_000 });

    await hostPage.close();
  });

  test("player phone keeps rendering the game via the route when blocked", async () => {
    const hostPage = await host.newPage();
    const { hostId } = await loginAsHost(hostPage, HOST_EMAIL);
    const seed = await seedNight(hostPage, hostId, "happy-path-3-cats-game1");
    await hostPage.close();

    const phonePage: Page = await phone.newPage();
    await joinPhone(phonePage, seed.roomCode, "Degraded Dana");

    await blockBrowserSupabase(phone);
    await phonePage.reload();

    // The lobby still renders via the route (not the spinner / unreachable),
    // and the ribbon shows the calm "backup" tier.
    await expect(phonePage.getByTestId(TID.playerLobby.root)).toBeVisible({ timeout: 30_000 });
    await expect(phonePage.getByTestId(TID.connection.playerUnreachable)).toHaveCount(0);
    await expect(
      phonePage.locator(`[data-testid="${TID.connection.ribbon}"][data-status="backup"]`),
    ).toBeVisible({ timeout: 20_000 });

    // Recovery: lift the block → the backup ribbon clears on its own.
    await unblockBrowserSupabase(phone);
    await expect(
      phonePage.locator(`[data-testid="${TID.connection.ribbon}"][data-status="backup"]`),
    ).toHaveCount(0, { timeout: 30_000 });
    await expect(phonePage.getByTestId(TID.playerLobby.root)).toBeVisible();

    await phonePage.close();
  });
});
