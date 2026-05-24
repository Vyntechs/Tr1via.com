// auto-start-on-reveal.spec.ts — regression for commit 70fcc55.
//
// The original bug: /api/games/[id]/start was defined but never called from
// the host live console. Clicking a board cell only fired /reveal, leaving
// games.state = 'ready' (the seed default). The TV's state machine renders
// TVLobby whenever state is 'draft' or 'ready' — so every player phone and
// the venue TV sat on the QR-code lobby while the host played through the
// whole game on her laptop. Brandon caught this only by driving three real
// page contexts (host + TV + phone). The API smoke + the existing e2e specs
// missed it because they call startGame() explicitly before the reveal loop.
//
// Fix in 70fcc55: handleReveal in HostLiveConsoleClient.tsx now POSTs
// /start before /reveal whenever currentGame.state is 'draft' or 'ready'.
// /start is idempotent so this is safe to call belt-and-suspenders.
//
// This spec deliberately does NOT call startGame() — the whole point is to
// prove that a UI cell click alone promotes the game to 'live' so all
// surfaces leave the lobby. If anyone reverts the auto-start branch in
// handleReveal, the TV assertion below fails and CI catches it.

import { test, expect, type BrowserContext } from "@playwright/test";
import {
  loginAsHost,
  seedNight,
  openHostLive,
  revealQuestion,
  resetTestData,
} from "./helpers/host-laptop";
import { openTV } from "./helpers/tv";
import { TID } from "./helpers/selectors";

test.describe.configure({ mode: "serial" });

test.describe("auto-start on first reveal (regression 70fcc55)", () => {
  // Two contexts + one remote-Supabase round trip per page. The first nav
  // pays Turbopack cold-compile, so the budget is generous.
  test.setTimeout(120_000);

  let host: BrowserContext;
  let tv: BrowserContext;

  test.beforeAll(async ({ browser }) => {
    host = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    tv = await browser.newContext({ viewport: { width: 1920, height: 1080 } });

    const cleanup = await host.newPage();
    await resetTestData(cleanup);
    await cleanup.close();
  });

  test.afterAll(async () => {
    try {
      if (host) {
        const cleanup = await host.newPage();
        await resetTestData(cleanup);
        await cleanup.close();
      }
    } catch {
      // Already-closed context shouldn't fail the suite.
    }
    await Promise.all(
      [host, tv]
        .filter((c): c is BrowserContext => c !== undefined)
        .map((c) => c.close().catch(() => {})),
    );
  });

  test("clicking a board cell on a 'ready' game promotes it to 'live' so TV leaves lobby", async () => {
    const hostPage = await host.newPage();
    const tvPage = await tv.newPage();

    // Seed a night. The default scenario leaves game1.state === 'ready' —
    // exactly the bug-trigger condition. If seed-night ever changes that
    // default, this test must be revisited (the assertion below would still
    // catch the regression, but the precondition would no longer mirror the
    // production code path on session-1 night-1).
    const { hostId } = await loginAsHost(
      hostPage,
      `autostart-${Date.now()}@tr1via.test`,
    );
    const seed = await seedNight(hostPage, hostId, "happy-path-3-cats-game1");
    expect(seed.game1.state).toBe("ready");

    // TV joins the room. It should sit on the lobby since the game is still
    // 'ready' — this assertion proves the bug's preconditions are real, not
    // an artifact of seed timing.
    await openTV(tvPage, seed.roomCode);
    await expect(tvPage.getByTestId(TID.tvLobby.root)).toBeVisible({
      timeout: 15_000,
    });

    // Host opens her live console and clicks the first cell. Crucially we
    // never call startGame() — the bug was that this click was the ONLY
    // start signal in the product, and it wasn't wired.
    await openHostLive(hostPage, seed.nightId);
    const firstCategory = seed.categories[0];
    if (!firstCategory) throw new Error("seed produced no categories");
    const firstQuestionId = firstCategory.question_ids[0];
    if (!firstQuestionId) throw new Error("first category has no questions");
    await revealQuestion(hostPage, firstQuestionId);

    // Source-of-truth assertion: the TV transitions from lobby to question.
    // This only happens when games.state === 'live' AND a question's
    // played_at is set — i.e. both /start AND /reveal ran. Pre-fix, neither
    // ran (only /reveal was called and it doesn't transition state).
    await expect(tvPage.getByTestId(TID.tvQuestion.root)).toBeVisible({
      timeout: 15_000,
    });
    await expect(tvPage.getByTestId(TID.tvLobby.root)).toBeHidden();
  });
});
