// may-lightning-ceremony.spec.ts
//
// Exercises the May/Storm theme-specific lock-in ceremony:
//   - host seeds a night with themeKey "may"
//   - player taps an answer → server confirms → phone shows bolt SVG
//   - TV shows the marquee chip for that player, eventually spotlit
//   - aria-live region announces the lock-in
//
// This test targets prod Supabase via the @tr1via.test allowlist — the same
// pattern as full-game.spec.ts. The dev server must be running.

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

  test.beforeAll(async ({ browser }) => {
    host = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    tv   = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    p1   = await browser.newContext({ viewport: { width: 390,  height: 844  } });
    const cleanup = await host.newPage();
    await resetTestData(cleanup);
    await cleanup.close();
  });

  test.afterAll(async () => {
    await Promise.all([host, tv, p1].map((c) => c.close().catch(() => {})));
  });

  test("tap → server confirm → phone bolt + TV marquee strike", async () => {
    const hostPage = await host.newPage();
    const tvPage   = await tv.newPage();
    const phone1   = await p1.newPage();

    // ── Bootstrap ──────────────────────────────────────────────────────────
    const { hostId } = await loginAsHost(hostPage, `may-ceremony-${Date.now()}@tr1via.test`);
    const seed = await seedNight(hostPage, hostId, { themeKey: "may" });

    await openTV(tvPage, seed.roomCode);
    await joinPhone(phone1, seed.roomCode, "TEST-MARK");

    // Open the host live console, then start game 1.
    await hostPage.goto(`/host/live/${seed.nightId}`);
    await expect(hostPage.getByTestId(TID.hostLiveConsole.root)).toBeVisible({ timeout: 30_000 });
    await startGame(hostPage, seed.game1.id);

    // Reveal the first question via API so the question screen appears on all devices.
    const firstQuestionId = seed.categories[0].question_ids[0];
    await revealViaApi(hostPage, seed.game1.id, firstQuestionId);

    // Wait for the question screen on the phone — confirms broadcast + snapshot delivered.
    await expect(phone1.getByTestId(TID.playerQuestion.root)).toBeVisible({ timeout: 8_000 });

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
    // May theme renders the marquee instead of the pile during a live question.
    const chip = tvPage
      .locator("[data-testid='marquee-chip']")
      .filter({ hasText: "TEST-MARK" });
    await expect(chip).toBeVisible({ timeout: 5_000 });
    // Eventually the chip enters the spotlight as the ceremony runs.
    await expect(chip).toHaveAttribute("data-spotlight", "true", { timeout: 3_000 });

    // Aria-live announcement on the TV surface.
    await expect(tvPage.getByRole("status").first()).toContainText("TEST-MARK locked in");
  });
});
