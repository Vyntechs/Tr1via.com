// reveal-followup-read-failure.spec.ts — reproduces the "host stuck on the
// previous screen" incident: the host taps Reveal, the broadcast arrives
// fine (the WebSocket line is healthy), but the FOLLOW-UP direct read that
// fetches the new question's row (lib/hooks/useRoom.ts refreshLiveState)
// fails. Today that failure is silently swallowed — no error is checked, no
// timeout bounds it, and no "reconnecting" signal fires — so the host (and
// any player hitting the same blip) is left staring at the old screen with
// zero indication anything is wrong.
//
// We block ONLY the browser's GET to `rest/v1/questions` (the exact request
// refreshLiveState's follow-up read makes) — NOT the realtime WebSocket, so
// the broadcast still lands, and NOT `rest/v1/games`, so the rest of the
// bootstrap/broadcast machinery behaves normally. This isolates the one
// broken code path from the rest of the (already well-tested) resilience
// system.
//
// Desired behavior: the host should recover and show the live question
// within a few seconds — via the same server-route fallback the codebase
// already uses for a fully-blocked connection (tryRouteFallback) — instead
// of silently sitting on the picking board until the 15s heartbeat happens
// to heal it.

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
import { TID } from "./helpers/selectors";

const HOST_EMAIL = "reveal-readfail-host@tr1via.test";
const QUESTIONS_READ_GLOB = "**/rest/v1/questions?**";

async function blockQuestionsRead(context: BrowserContext): Promise<void> {
  await context.route(QUESTIONS_READ_GLOB, (route) => route.abort());
}
async function unblockQuestionsRead(context: BrowserContext): Promise<void> {
  await context.unroute(QUESTIONS_READ_GLOB);
}

test.describe("reveal broadcast arrives but the follow-up question read fails", () => {
  test.setTimeout(60_000);

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

  test("host recovers and shows the live question instead of silently sticking on the previous screen", async () => {
    const hostPage: Page = await host.newPage();
    const { hostId } = await loginAsHost(hostPage, HOST_EMAIL);
    const seed = await seedNight(hostPage, hostId, "happy-path-3-cats-game1");
    await startGame(hostPage, seed.game1.id);

    await openHostLive(hostPage, seed.nightId);

    const questionId = seed.categories[0].question_ids[0];

    // Block ONLY the follow-up question read — the broadcast (WebSocket)
    // and every other REST table stay healthy, isolating this one path.
    await blockQuestionsRead(host);

    // Server-side write + broadcast succeed (this is a Node-side API call,
    // not a browser request, so it's unaffected by the page-level block).
    await revealViaApi(hostPage, seed.game1.id, questionId);

    // Desired behavior: the host console shows the live question within a
    // few seconds (via the resilient server-route fallback), NOT the 15s
    // heartbeat, and NOT an indefinite silent stall on the picking board.
    await expect(hostPage.getByTestId(TID.tvQuestion.root)).toBeVisible({
      timeout: 8_000,
    });

    await unblockQuestionsRead(host);
    await hostPage.close();
  });

  test("player recovers and shows the live question instead of silently sticking on the lobby/previous screen", async () => {
    const hostPage = await host.newPage();
    const { hostId } = await loginAsHost(hostPage, `game2-${HOST_EMAIL}`);
    const seed = await seedNight(hostPage, hostId, "happy-path-3-cats-game1");

    const phonePage: Page = await phone.newPage();
    await joinPhone(phonePage, seed.roomCode, "ReadFail Dana");

    await startGame(hostPage, seed.game1.id);

    const questionId = seed.categories[0].question_ids[0];

    // Block ONLY the follow-up question read on the PLAYER's own context.
    // Per the code comment in lib/hooks/useRoom.ts (the `reveal` broadcast
    // handler), Postgres Changes don't reliably reach phones because the
    // device-cookie header isn't forwarded over the Realtime WebSocket — so
    // for a player, this HTTP fallback is the primary path, not a backup.
    await blockQuestionsRead(phone);

    await revealViaApi(hostPage, seed.game1.id, questionId);

    await expect(phonePage.getByTestId(TID.playerQuestion.root)).toBeVisible({
      timeout: 8_000,
    });

    await unblockQuestionsRead(phone);
    await hostPage.close();
    await phonePage.close();
  });
});
