// reveal-sync.spec.ts — the "one press, three surfaces" Playwright test.
//
// Five browser contexts share one dev server: host laptop, venue TV, and
// three player phones. Each phone has its own cookie jar, so each gets its
// own device session + scramble. The test asserts the central product
// contract: when the host clicks Reveal, every other surface in the room
// shows the question within 500ms; same for resolve.
//
// dev server boots with TEST_AUTH_ENABLED=1 + TEST_SECRET=local-test-secret
// + MOCK_EXTERNAL=1 (see playwright.config.ts → webServer.env). Without
// those, /api/_test/* routes return 404 and this test cannot run.

import { test, expect, type BrowserContext } from "@playwright/test";
import {
  loginAsHost,
  seedNight,
  startGame,
  openHostLive,
  revealQuestion,
  fastForwardTimer,
  listQuestionsInCategory,
  resetTestData,
} from "./helpers/host-laptop";
import { openTV, waitForQuestionOnTV, waitForRevealOnTV } from "./helpers/tv";
import { joinPhone, tapAnswerSlot, awaitReveal } from "./helpers/player-phone";
import { TID } from "./helpers/selectors";

test.describe.configure({ mode: "serial" });

test.describe("reveal sync — one press, three surfaces", () => {
  // Setup involves 5 BrowserContexts hitting remote Supabase concurrently —
  // Turbopack cold-compile + Supabase rate-limits make the first POSTs slow.
  // Generous test timeout; the in-test reveal latency assertion is the only
  // tight one (<500ms), and it only runs after warm-up is done.
  test.setTimeout(180_000);

  let host: BrowserContext;
  let tv: BrowserContext;
  let p1: BrowserContext;
  let p2: BrowserContext;
  let p3: BrowserContext;

  test.beforeAll(async ({ browser }) => {
    host = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    tv = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    p1 = await browser.newContext({ viewport: { width: 390, height: 844 } });
    p2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
    p3 = await browser.newContext({ viewport: { width: 390, height: 844 } });

    // Fresh slate — wipe any test data left from a prior local run.
    const cleanup = await host.newPage();
    await resetTestData(cleanup);
    await cleanup.close();
  });

  test.afterAll(async () => {
    // Cleanup test rows so prod stays clean, then close all 5 contexts.
    // Both halves defend against partial beforeAll — if browser launch
    // failed, the context vars are undefined and we must not throw here.
    try {
      if (host) {
        const cleanup = await host.newPage();
        await resetTestData(cleanup);
        await cleanup.close();
      }
    } catch {
      // Ignore — already-closed context shouldn't fail the suite.
    }
    await Promise.all(
      [host, tv, p1, p2, p3]
        .filter((c): c is BrowserContext => c !== undefined)
        .map((c) => c.close().catch(() => {})),
    );
  });

  test("host reveals -> TV + 3 phones all show question within 500ms", async () => {
    const hostPage = await host.newPage();
    const tvPage = await tv.newPage();
    const phone1 = await p1.newPage();
    const phone2 = await p2.newPage();
    const phone3 = await p3.newPage();

    // Host: log in (test email!) and seed a fully-realized night.
    const { hostId } = await loginAsHost(hostPage, `sync-${Date.now()}@tr1via.test`);
    const seed = await seedNight(hostPage, hostId);

    // Open TV and join 3 phones. Each phone gets its own device cookie.
    await openTV(tvPage, seed.roomCode);
    await joinPhone(phone1, seed.roomCode, "Alex");
    await joinPhone(phone2, seed.roomCode, "Brooke");
    await joinPhone(phone3, seed.roomCode, "Casey");

    // Host opens live console and transitions game 1 to "live" — without this
    // the TV state machine treats game 1 as lobby and never shows TVQuestion.
    await openHostLive(hostPage, seed.nightId);
    await startGame(hostPage, seed.game1.id);

    const questionIds = listQuestionsInCategory(seed, seed.categories[0]!.id);
    const q1 = questionIds[0]!;

    // Race: every surface should show the question within 500ms of the
    // host's click. t0 is RIGHT BEFORE the click; arrivals are measured
    // when the question root testid becomes visible on each surface. The
    // waitFor timeouts are generous so we record actual arrival time even
    // when it overshoots the 500ms budget — that way the failing assertion
    // tells us BY HOW MUCH we missed, not just that we missed.
    const ARRIVAL_TIMEOUT = 10_000;
    const t0 = Date.now();
    await revealQuestion(hostPage, q1);
    const arrivals = await Promise.all([
      waitForQuestionOnTV(tvPage, ARRIVAL_TIMEOUT).then(() => Date.now() - t0),
      phone1.getByTestId(TID.playerQuestion.root).waitFor({ state: "visible", timeout: ARRIVAL_TIMEOUT }).then(() => Date.now() - t0),
      phone2.getByTestId(TID.playerQuestion.root).waitFor({ state: "visible", timeout: ARRIVAL_TIMEOUT }).then(() => Date.now() - t0),
      phone3.getByTestId(TID.playerQuestion.root).waitFor({ state: "visible", timeout: ARRIVAL_TIMEOUT }).then(() => Date.now() - t0),
    ]);
    console.log("reveal arrivals (ms):", arrivals);
    for (const ms of arrivals) {
      expect(ms, `reveal arrival for one surface was ${ms}ms (> 500)`).toBeLessThan(500);
    }

    // Each phone taps a different slot — exercises three distinct write paths
    // concurrently to make sure the lock-in pile doesn't drop any.
    await Promise.all([
      tapAnswerSlot(phone1, 1),
      tapAnswerSlot(phone2, 2),
      tapAnswerSlot(phone3, 3),
    ]);

    // Host fast-forwards the timer. Every surface should resolve within 500ms.
    const t1 = Date.now();
    await fastForwardTimer(hostPage, q1);
    const resolveArrivals = await Promise.all([
      waitForRevealOnTV(tvPage, ARRIVAL_TIMEOUT).then(() => Date.now() - t1),
      awaitReveal(phone1, ARRIVAL_TIMEOUT).then(() => Date.now() - t1),
      awaitReveal(phone2, ARRIVAL_TIMEOUT).then(() => Date.now() - t1),
      awaitReveal(phone3, ARRIVAL_TIMEOUT).then(() => Date.now() - t1),
    ]);
    console.log("resolve arrivals (ms):", resolveArrivals);
    for (const ms of resolveArrivals) {
      expect(ms, `resolve arrival for one surface was ${ms}ms (> 500)`).toBeLessThan(500);
    }
  });
});
