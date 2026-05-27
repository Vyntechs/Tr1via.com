// non-may-unchanged.spec.ts
//
// Regression guard: the May/Storm ceremony features (marquee, phone bolt)
// MUST NOT appear on the House (default) theme. Any accidental bleed would
// affect every non-May game night, so this spec runs as a mandatory gate.
//
// Assertions:
//   - TV: marquee is NOT rendered; the existing pile IS rendered
//   - Phone: NO bolt SVG after tapping; PlayerLocked appears as usual

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

test.describe("House theme — unchanged regression guard", () => {
  test.setTimeout(60_000);

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

  test("House theme: no marquee, no phone bolt, existing pile renders", async () => {
    const hostPage = await host.newPage();
    const tvPage   = await tv.newPage();
    const phone1   = await p1.newPage();

    // ── Bootstrap ──────────────────────────────────────────────────────────
    const { hostId } = await loginAsHost(hostPage, `house-regression-${Date.now()}@tr1via.test`);
    // Explicit themeKey "house" — same as the API default, but explicit keeps
    // this test self-documenting.
    const seed = await seedNight(hostPage, hostId, { themeKey: "house" });

    await openTV(tvPage, seed.roomCode);
    await joinPhone(phone1, seed.roomCode, "HOUSE-TEST");

    await hostPage.goto(`/host/live/${seed.nightId}`);
    await expect(hostPage.getByTestId(TID.hostLiveConsole.root)).toBeVisible({ timeout: 30_000 });
    await startGame(hostPage, seed.game1.id);

    const firstQuestionId = seed.categories[0].question_ids[0];
    await revealViaApi(hostPage, seed.game1.id, firstQuestionId);

    // Wait for question screen to confirm broadcast arrived.
    await expect(phone1.getByTestId(TID.playerQuestion.root)).toBeVisible({ timeout: 8_000 });

    // ── TV-side regression ─────────────────────────────────────────────────
    // Marquee must not be present on a House night.
    await expect(tvPage.locator("[data-testid='tv-scoreboard-marquee']")).toHaveCount(0);
    // The existing question pile must still be rendered.
    await expect(tvPage.locator("[data-testid='tv-question-pile']")).toBeVisible();

    // ── Phone-side regression ──────────────────────────────────────────────
    // tapAnswerSlot already asserts playerLocked appears; we also confirm
    // NO bolt SVG materialises within the same window.
    await tapAnswerSlot(phone1, 2);
    await expect(phone1.locator("[data-testid='phone-bolt']")).toHaveCount(0);
    // playerLocked confirmed by tapAnswerSlot; redundant assert kept for spec clarity.
    await expect(phone1.getByTestId(TID.playerLocked.root)).toBeVisible({ timeout: 3_000 });
  });
});
