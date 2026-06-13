// connection-unreachable.spec.ts — the LAST-RESORT "switch to a hotspot" path.
//
// Since Phase 2, a plain Supabase block no longer strands the user: the game
// keeps working through the server route (see connection-degraded.spec.ts). The
// "switch to a hotspot" tier now means a TRUE TOTAL OUTAGE — even the same-origin
// room route (browser→Vercel→Supabase) is unreachable. We simulate that by
// aborting BOTH the direct Supabase line AND the room snapshot route, so the
// fallback also fails and useRoom flips reachability to "unreachable".
//
// Targets data-testids only (per the e2e-target-testid-not-visible-copy lesson).

import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { loginAsHost, seedNight, openHostLive, resetTestData } from "./helpers/host-laptop";
import { joinPhone } from "./helpers/player-phone";
import { TID } from "./helpers/selectors";

const HOST_EMAIL = "unreachable-host@tr1via.test";
const SUPABASE_GLOB = "**/*.supabase.co/**";
const ROOM_ROUTE_GLOB = "**/api/room/**"; // the resilient fallback route

/** Abort the direct Supabase line AND the server-route fallback → total outage. */
async function blockSupabase(context: BrowserContext): Promise<void> {
  await context.route(SUPABASE_GLOB, (route) => route.abort());
  await context.route(ROOM_ROUTE_GLOB, (route) => route.abort());
}
/** Lift the block (network restored / switched to hotspot). */
async function unblockSupabase(context: BrowserContext): Promise<void> {
  await context.unroute(SUPABASE_GLOB);
  await context.unroute(ROOM_ROUTE_GLOB);
}

test.describe.configure({ mode: "serial" });

test.describe("unreachable server — host + player surface the hotspot message and self-heal", () => {
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

  test("host console: blocked reads → hotspot message → recovers on its own", async () => {
    const hostPage: Page = await host.newPage();
    const { hostId } = await loginAsHost(hostPage, HOST_EMAIL);
    const seed = await seedNight(hostPage, hostId, "happy-path-3-cats-game1");

    // Healthy first: the live console renders with a TV snapshot, no error tier.
    await openHostLive(hostPage, seed.nightId);
    await expect(hostPage.getByTestId(TID.connection.hostUnreachable)).toHaveCount(0);

    // Venue WiFi starts blocking Supabase; a re-bootstrap now fails the reads.
    await blockSupabase(host);
    await hostPage.reload();

    // The black DevPlaceholder must NOT appear; instead the actionable message,
    // within ~5s of the blocked reads timing out (generous ceiling for CI).
    await expect(hostPage.getByTestId(TID.connection.hostUnreachable)).toBeVisible({
      timeout: 15_000,
    });

    // Switch to a hotspot → the self-healing retry re-bootstraps with NO reload
    // and the console comes back on its own.
    await unblockSupabase(host);
    await expect(hostPage.getByTestId(TID.connection.hostUnreachable)).toHaveCount(0, {
      timeout: 20_000,
    });
    await expect(hostPage.getByTestId(TID.hostLiveConsole.root)).toBeVisible();

    await hostPage.close();
  });

  test("player phone: blocked reads → hotspot message → recovers on its own", async () => {
    // Reseed a fresh night (afterAll reset only runs at the end; reuse the
    // existing one by re-deriving from a host page).
    const hostPage = await host.newPage();
    const { hostId } = await loginAsHost(hostPage, HOST_EMAIL);
    const seed = await seedNight(hostPage, hostId, "happy-path-3-cats-game1");
    await hostPage.close();

    const phonePage: Page = await phone.newPage();
    // Join healthy → lands on the lobby.
    await joinPhone(phonePage, seed.roomCode, "Blocked Bea");

    // Now the venue blocks Supabase; a reload re-bootstraps and the reads fail.
    await blockSupabase(phone);
    await phonePage.reload();

    // Not the endless "Catching up…" spinner, not "isn't open" — the hotspot
    // guidance instead.
    await expect(phonePage.getByTestId(TID.connection.playerUnreachable)).toBeVisible({
      timeout: 15_000,
    });

    // Recovery without a manual refresh: lift the block and let the retry heal.
    await unblockSupabase(phone);
    await expect(phonePage.getByTestId(TID.connection.playerUnreachable)).toHaveCount(0, {
      timeout: 20_000,
    });
    await expect(phonePage.getByTestId(TID.playerLobby.root)).toBeVisible();

    await phonePage.close();
  });
});
