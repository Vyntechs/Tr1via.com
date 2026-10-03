// may-lightning-ceremony.spec.ts
//
// Exercises the May/Storm theme-specific lock-in ceremony:
//   - host seeds a night with themeKey "may"
//   - player taps an answer → server confirms → phone shows bolt SVG
//   - TV keeps one stationary "N OF M LOCKED IN" status (no moving name
//     marquee on the question screen since #143)
//   - the TV's lightning ceremony runs for that player and its aria-live
//     region announces the lock-in
//
// Runs against the Supabase in .env.local with throwaway @tr1via.test
// accounts; Playwright starts the dev server (see playwright.config.ts).

import { test, expect, type BrowserContext } from "@playwright/test";
import {
  loginAsHost,
  seedNight,
  startGame,
  revealViaApi,
  resetTestData,
} from "./helpers/host-laptop";
import { openTV } from "./helpers/tv";
import { joinPhone, tapAnswerSlot } from "./helpers/player-phone";
import { TID } from "./helpers/selectors";

test.describe.configure({ mode: "serial" });

test.describe("May/Storm — lightning ceremony", () => {
  // Ceremony animation + remote Supabase round-trips warrant a generous ceiling.
  test.setTimeout(120_000);

  let host: BrowserContext;
  let tv: BrowserContext;
  let p1: BrowserContext;
  let p2: BrowserContext;

  test.beforeAll(async ({ browser }) => {
    host = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    tv   = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    p1   = await browser.newContext({ viewport: { width: 390,  height: 844  } });
    p2   = await browser.newContext({ viewport: { width: 390,  height: 844  } });
    const cleanup = await host.newPage();
    await resetTestData(cleanup);
    await cleanup.close();
  });

  test.afterAll(async () => {
    await Promise.all([host, tv, p1, p2].map((c) => c.close().catch(() => {})));
  });

  test("tap → server confirm → phone bolt + TV lightning announcement", async () => {
    const hostPage = await host.newPage();
    const tvPage   = await tv.newPage();
    const phone1   = await p1.newPage();
    const phone2   = await p2.newPage();

    // ── Bootstrap ──────────────────────────────────────────────────────────
    const { hostId } = await loginAsHost(hostPage, `may-ceremony-${Date.now()}@tr1via.test`);
    const seed = await seedNight(hostPage, hostId, { themeKey: "may" });

    await openTV(tvPage, seed.roomCode);
    await joinPhone(phone1, seed.roomCode, "TEST-MARK");
    // A second player who has not answered yet keeps the question open, like
    // a real room. With only one player, the all-locked auto-reveal (#124,
    // added after this spec) ends the question 1.2s after that one lock-in,
    // so the TV checks below would race the reveal.
    await joinPhone(phone2, seed.roomCode, "TEST-WAIT");

    // Open the host live console, then start game 1.
    await hostPage.goto(`/host/live/${seed.nightId}`);
    await expect(hostPage.getByTestId(TID.hostLiveConsole.root)).toBeVisible({ timeout: 30_000 });
    await startGame(hostPage, seed.game1.id);

    // Reveal the first question via API so the question screen appears on all devices.
    const firstQuestionId = seed.categories[0].question_ids[0];
    await revealViaApi(hostPage, seed.game1.id, firstQuestionId);

    // Wait for the question screen on the phone — confirms broadcast + snapshot delivered.
    await expect(phone1.getByTestId(TID.playerQuestion.root)).toBeVisible({ timeout: 8_000 });

    // The TV's lightning ceremony announces the lock-in only while it holds
    // the spotlight (~1.2s), and the TV now hears about a lock-in within a
    // fraction of a second. Start watching for it before the tap so the
    // phone-side checks below can't use up that window.
    const tvAnnouncedLockIn = expect(
      tvPage.locator('[aria-live="polite"]').filter({ hasText: "TEST-MARK locked in" }),
    ).toHaveCount(1, { timeout: 10_000 });
    // Awaited below; this only stops an early failure from being reported as
    // an unhandled rejection while the phone checks run.
    tvAnnouncedLockIn.catch(() => {});

    // ── Phone-side assertions ───────────────────────────────────────────────
    // tapAnswerSlot clicks slot 2 and asserts TID.playerLocked.root visible —
    // we let the helper do that, then additionally check for the May bolt SVG.
    await tapAnswerSlot(phone1, 2);
    // Phone bolt must appear within 1.5s of the lock-in confirmation round-trip.
    await expect(phone1.locator("[data-testid='phone-bolt']")).toBeVisible({ timeout: 1_500 });
    // playerLocked was already asserted inside tapAnswerSlot, but re-assert for
    // spec clarity.
    await expect(phone1.getByTestId(TID.playerLocked.root)).toBeVisible({ timeout: 3_000 });

    // ── TV-side assertions ──────────────────────────────────────────────────
    // Since #143 ("make venue TV readable") the question screen never shows a
    // moving player-name marquee, in May or any theme: names stay off the
    // question so the room can read it. The lock-in shows up in the one
    // stationary status line instead.
    await expect(tvPage.getByTestId("tv-question-lock-status")).toContainText(
      "1 OF 2 LOCKED IN",
      { timeout: 8_000 },
    );
    await expect(tvPage.getByTestId("tv-scoreboard-marquee")).toHaveCount(0);

    // The May lightning ceremony still runs for that player: while it holds
    // the spotlight, the TV's aria-live region announces the lock-in.
    await tvAnnouncedLockIn;
  });
});
