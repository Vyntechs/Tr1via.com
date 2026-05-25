// start-then-reveal.spec.ts — regression lock for the lobby-→-live flow,
// post P0.32 refactor.
//
// Original session-5 bug (commit 70fcc55): /api/games/[id]/start was never
// called from the host live console. Clicking a board cell only fired
// /reveal, leaving the game in 'draft' / 'ready'. The TV stayed on TVLobby
// while the host played the whole game on her laptop.
//
// Post-session-6 P0.32 refactor: the host laptop IS the venue TV — there is
// no separate board to click during lobby. The first host action is the
// explicit "Start Game 1" button in the control strip. This spec validates
// the new path: Start Game 1 button promotes the game to 'live', the TV
// transitions to TVGrid, the host taps a cell on TVGrid, and the TV
// transitions to TVQuestion. If anyone reverts either the Start button or
// the auto-start branch in handleReveal, the TV assertions below fail.

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

test.describe("lobby → start → cell click → question (P0.32 refactor regression)", () => {
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

  test("Start Game 1 promotes draft → live, then cell tap reveals first question", async () => {
    const hostPage = await host.newPage();
    const tvPage = await tv.newPage();

    // Seed a night. seed-night drives the real /api/nights endpoint, which
    // inserts both games in 'draft' — the prod default a real host sees
    // before tapping Start.
    const { hostId } = await loginAsHost(
      hostPage,
      `autostart-${Date.now()}@tr1via.test`,
    );
    const seed = await seedNight(hostPage, hostId, "happy-path-3-cats-game1");
    expect(seed.game1.state).toBe("draft");

    // Venue TV joins. It should sit on the lobby (game state is 'draft').
    // This proves the precondition is real, not an artifact of seed timing.
    await openTV(tvPage, seed.roomCode);
    await expect(tvPage.getByTestId(TID.tvLobby.root)).toBeVisible({
      timeout: 15_000,
    });

    // Host opens her live console. With the P0.32 refactor the host laptop
    // IS the venue TV, so it renders TVLobby — and the control strip shows
    // a "Start Game 1" button (no draft-state board to click).
    await openHostLive(hostPage, seed.nightId);
    await expect(hostPage.getByTestId("host-start-game-1-btn")).toBeVisible({
      timeout: 15_000,
    });
    await hostPage.getByTestId("host-start-game-1-btn").click();

    // After Start, the game flips 'draft' → 'live' and both surfaces — the
    // standalone /tv/[code] TV (tvPage) and the inline TV on the host's
    // console (hostPage) — move from TVLobby to TVGrid. The host's snapshot
    // is driven by useRoom (postgres_changes on the games table), which can
    // lag the TV's useTVRoom by a few seconds in dev environments, so wait
    // on the slower of the two before tapping a cell.
    await expect(tvPage.getByTestId(TID.tvGrid.root)).toBeVisible({
      timeout: 15_000,
    });
    await expect(tvPage.getByTestId(TID.tvLobby.root)).toBeHidden();
    await expect(hostPage.getByTestId(TID.tvGrid.root)).toBeVisible({
      timeout: 15_000,
    });

    // Now the host taps the first cell on the inline TVGrid. The clickable
    // cell carries data-testid=host-question-{qid} (kept for backwards
    // compatibility with the legacy revealQuestion helper).
    const firstCategory = seed.categories[0];
    if (!firstCategory) throw new Error("seed produced no categories");
    const firstQuestionId = firstCategory.question_ids[0];
    if (!firstQuestionId) throw new Error("first category has no questions");
    await revealQuestion(hostPage, firstQuestionId);

    // TV transitions from TVGrid to TVQuestion — the same end-state the
    // original spec asserted, just reached via the new two-tap path.
    await expect(tvPage.getByTestId(TID.tvQuestion.root)).toBeVisible({
      timeout: 15_000,
    });
    await expect(tvPage.getByTestId(TID.tvGrid.root)).toBeHidden();
  });
});
