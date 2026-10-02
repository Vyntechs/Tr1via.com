// connection-degraded.spec.ts — Phase 2: the game KEEPS WORKING through the
// server route when the direct browser→Supabase line is blocked.
//
// Faithful reproduction of the 2026-06-10 venue incident: the site/Vercel was
// reachable (marketing + TV worked) — ONLY the direct browser→Supabase line was
// blocked, so only the live game (which reads directly) went black. We simulate
// that precisely: Playwright aborts the BROWSER's requests straight to Supabase
// (hosted *.supabase.co or the local stack in .env.local); the dev server's
// admin calls are a Node process, unaffected — so `/api/room/:code/snapshot`
// (browser→Vercel→Supabase) still serves the game. (route() covers HTTP
// requests only; the realtime socket stays up, as it did in the original.)
//
// Asserts: under the block the host console keeps rendering via the route
// (NOT the black placeholder / "switch to a hotspot" screen), shows the calm
// "backup" banner, and recovers on its own when the block lifts. Since #146 a
// player phone reads ONLY through that route (never the direct line), so it has
// no backup tier: under the block it must simply keep following the game.
// Targets data-testids only (e2e-target-testid-not-visible-copy).

import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import {
  loginAsHost,
  seedNight,
  openHostLive,
  startGame,
  revealViaApi,
  resetTestData,
} from "./helpers/host-laptop";
import { joinPhone } from "./helpers/player-phone";
import { isDirectSupabaseRequest } from "./helpers/supabase-line";
import { TID } from "./helpers/selectors";

const HOST_EMAIL = "degraded-host@tr1via.test";

async function blockBrowserSupabase(context: BrowserContext): Promise<void> {
  await context.route(isDirectSupabaseRequest, (route) => route.abort());
}
async function unblockBrowserSupabase(context: BrowserContext): Promise<void> {
  await context.unroute(isDirectSupabaseRequest);
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

  test("player phone keeps following the game via the route when blocked", async () => {
    const hostPage = await host.newPage();
    const { hostId } = await loginAsHost(hostPage, HOST_EMAIL);
    const seed = await seedNight(hostPage, hostId, "happy-path-3-cats-game1");

    const phonePage: Page = await phone.newPage();
    await joinPhone(phonePage, seed.roomCode, "Degraded Dana");
    const unreachableRibbon = phonePage.locator(
      `[data-testid="${TID.connection.ribbon}"][data-status="unreachable"]`,
    );

    await blockBrowserSupabase(phone);
    await phonePage.reload();

    // The lobby still renders via the route (not the spinner / unreachable).
    await expect(phonePage.getByTestId(TID.playerLobby.root)).toBeVisible({ timeout: 30_000 });
    await expect(phonePage.getByTestId(TID.connection.playerUnreachable)).toHaveCount(0);
    await expect(unreachableRibbon).toHaveCount(0);

    // The game keeps moving on the blocked phone: the host starts Game 1 and
    // reveals a question, and the phone gets it through the route. (Before
    // #146 this checked a "backup" ribbon; players no longer have that tier.)
    await startGame(hostPage, seed.game1.id);
    await revealViaApi(hostPage, seed.game1.id, seed.categories[0]!.question_ids[0]!);
    await expect(phonePage.getByTestId(TID.playerQuestion.root)).toBeVisible({ timeout: 10_000 });
    await expect(phonePage.getByTestId(TID.connection.playerUnreachable)).toHaveCount(0);
    await expect(unreachableRibbon).toHaveCount(0);

    // Recovery: lift the block → the phone stays on the live question, no
    // error tier.
    await unblockBrowserSupabase(phone);
    await expect(phonePage.getByTestId(TID.playerQuestion.root)).toBeVisible();
    await expect(unreachableRibbon).toHaveCount(0);

    await phonePage.close();
    await hostPage.close();
  });
});
