// full-game.spec.ts — the centerpiece end-to-end test.
//
// Drives the full product flow: 1 host laptop + 1 venue TV + 3 phones
// through game 1 (3 categories × 7 questions = 21 reveals), an intermission,
// game 2 (1 category × 7 reveals), and the finale.
//
// Why each design choice:
//   - serial mode + a single test: 5 BrowserContexts share one dev server
//     and one prod Supabase project. Running in parallel would race on the
//     @tr1via.test users that the cleanup reset wipes.
//   - revealViaApi instead of clicking the host grid cells: the host's cells
//     flip between clickable/disabled as the snapshot refreshes; chaining
//     28 UI reveals would be brittle. The production code path is the same
//     route the cell-click would call.
//   - phone 3 deliberately opts out of game 2: exercises the
//     PlayerJoinGame2 branch and proves that non-opted players don't break
//     the game-2 flow for the others.

import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import {
  loginAsHost,
  seedNight,
  startGame,
  openHostLive,
  revealViaApi,
  fastForwardTimer,
  endGame,
  resetTestData,
} from "./helpers/host-laptop";
import { openTV } from "./helpers/tv";
import { joinPhone, tapAnswerSlot } from "./helpers/player-phone";
import { TID } from "./helpers/selectors";

async function expectResolvedTVSnapshot(
  page: Page,
  roomCode: string,
  gameId: string,
  questionId: string,
) {
  await expect.poll(async () => {
    const response = await page.request.get(`/api/tv/${roomCode}/snapshot`);
    if (!response.ok()) return `status:${response.status()}`;
    const body = await response.json() as {
      currentGameId: string | null;
      liveQuestionId: string | null;
      targetQuestionId: string | null;
      questions: Array<{ id: string; finishedAt: string | null }>;
    };
    const question = body.questions.find((candidate) => candidate.id === questionId);
    return {
      currentGameId: body.currentGameId,
      liveQuestionId: body.liveQuestionId,
      targetQuestionId: body.targetQuestionId,
      finished: Boolean(question?.finishedAt),
    };
  }, {
    message: `TV snapshot should target resolved question ${questionId}`,
    timeout: 8_000,
    intervals: [100, 250, 500, 1_000],
  }).toEqual({
    currentGameId: gameId,
    liveQuestionId: null,
    targetQuestionId: questionId,
    finished: true,
  });
}

test.describe.configure({ mode: "serial" });

test.describe("full game — host + TV + 3 phones, game1 → intermission → game2 → finale", () => {
  // 28 reveals × ~3s each (reveal + tap + fast-forward + assert) + intermission +
  // bootstrap (Turbopack cold + Supabase remote) → realistic floor ~120s.
  // Generous ceiling so a slow remote round-trip doesn't fail the suite.
  test.setTimeout(300_000);

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
      [host, tv, p1, p2, p3]
        .filter((c): c is BrowserContext => c !== undefined)
        .map((c) => c.close().catch(() => {})),
    );
  });

  test("21 game-1 reveals + 7 game-2 reveals; phone 3 opts out of game 2", async () => {
    const hostPage = await host.newPage();
    const tvPage = await tv.newPage();
    const phone1 = await p1.newPage();
    const phone2 = await p2.newPage();
    const phone3 = await p3.newPage();
    const hostPhone = await host.newPage();
    await hostPhone.setViewportSize({ width: 430, height: 932 });
    const tvPageErrors: string[] = [];
    tvPage.on("pageerror", (error) => tvPageErrors.push(error.message));

    // ── Bootstrap ──────────────────────────────────────────────────────
    const { hostId } = await loginAsHost(hostPage, `full-${Date.now()}@tr1via.test`);
    const seed = await seedNight(hostPage, hostId, "two-games-ready");
    expect(seed.categories.length).toBe(3);
    expect(seed.game2Categories.length).toBe(1);

    await openTV(tvPage, seed.roomCode);
    await joinPhone(phone1, seed.roomCode, "Alex");
    await joinPhone(phone2, seed.roomCode, "Brooke");
    await joinPhone(phone3, seed.roomCode, "Casey");

    await openHostLive(hostPage, seed.nightId);
    await startGame(hostPage, seed.game1.id);

    // ── Game 1: 21 reveals (3 cats × 7 questions) ──────────────────────
    for (const cat of seed.categories) {
      for (const qid of cat.question_ids) {
        await revealViaApi(hostPage, seed.game1.id, qid);
        // Wait for the question screen on phone 1 — cheap signal that the
        // broadcast + snapshot fan-out has reached the phones.
        await expect(phone1.getByTestId(TID.playerQuestion.root))
          .toBeVisible({ timeout: 8_000 });
        await Promise.all([
          tapAnswerSlot(phone1, 1),
          tapAnswerSlot(phone2, 2),
          tapAnswerSlot(phone3, 3),
        ]);
        await fastForwardTimer(hostPage, qid);
        await expectResolvedTVSnapshot(tvPage, seed.roomCode, seed.game1.id, qid);
        expect(tvPageErrors).toEqual([]);
        // Wait for the resolve view on TV — the next iteration's
        // revealViaApi will supersede this within ~200ms.
        await expect(tvPage.getByTestId(TID.tvReveal.root))
          .toBeVisible({ timeout: 8_000 });
      }
    }

    // ── End game 1 → intermission ─────────────────────────────────────
    await endGame(hostPage, seed.game1.id);
    await expect(tvPage.getByTestId(TID.tvIntermission.root))
      .toBeVisible({ timeout: 15_000 });
    // Phones that played game 1 but haven't opted into game 2 see the
    // PlayerJoinGame2 screen.
    await expect(phone1.getByTestId(TID.playerJoinGame2.root))
      .toBeVisible({ timeout: 15_000 });
    await hostPhone.goto(`/host/live/${seed.nightId}`);
    await expect(hostPhone.getByText("Game 1 complete")).toBeVisible({ timeout: 15_000 });
    await expect(hostPhone.getByRole("heading", { name: "Game 2 is ready" })).toBeVisible();

    // The join recap previews the UPCOMING game's cleaned category name.
    // The seed's raw AI topic ("general trivia") is generation metadata and
    // must never leak into the player-facing intermission.
    await expect(phone1.getByTestId(TID.playerJoinGame2.topics))
      .toBeVisible({ timeout: 15_000 });
    expect(await phone1.getByTestId(TID.playerJoinGame2.topic).count())
      .toBeGreaterThan(0);
    await expect(phone1.getByText("Bonus round", { exact: true })).toBeVisible();
    await expect(phone1.getByText("general trivia", { exact: true })).toHaveCount(0);
    await expect(phone3.getByTestId(TID.playerJoinGame2.topics))
      .toBeVisible({ timeout: 15_000 });

    // Phones 1 and 2 opt in via the UI button (same path a real user takes —
    // this exercises the optimistic-update fix in PlayerJoinGame2Wired).
    // Phone 3 deliberately stays on PlayerJoinGame2.
    await phone1.getByTestId(TID.playerJoinGame2.submit).click();
    await phone2.getByTestId(TID.playerJoinGame2.submit).click();

    // Once opted in, the continuing players move to the "You're in Game 2"
    // waiting screen — which previews the same upcoming game-2 topics.
    await expect(phone1.getByTestId(TID.playerBetweenGames.root))
      .toBeVisible({ timeout: 15_000 });
    await expect(
      phone1.getByText("Game 2 starts when your host is ready."),
    ).toBeVisible();
    await expect(phone1.getByTestId(TID.playerBetweenGames.topics))
      .toBeVisible();
    expect(await phone1.getByTestId(TID.playerBetweenGames.topic).count())
      .toBeGreaterThan(0);

    // A reload during intermission must rebuild the intentional waiting state
    // from durable participation/game data—not revive Game 1's last answer.
    await phone1.reload();
    await expect(phone1.getByTestId(TID.playerBetweenGames.root))
      .toBeVisible({ timeout: 15_000 });
    await expect(phone1.getByTestId(TID.playerRevealCorrect.root)).toHaveCount(0);
    await expect(phone1.getByTestId(TID.playerRevealWrong.root)).toHaveCount(0);
    await expect(phone1.getByText(/The answer was/i)).toHaveCount(0);

    // ── Game 2: 7 reveals (1 category × 7) ────────────────────────────
    await hostPhone.getByRole("button", { name: "Start Game 2" }).click();
    // Starting the game and choosing its first question are separate host
    // actions. Phones keep a clear Round-2 waiting screen in that gap—even
    // after another reload—rather than displaying a historical answer.
    await phone1.reload();
    await expect(phone1.getByTestId(TID.playerBetweenGames.root))
      .toBeVisible({ timeout: 15_000 });
    await expect(
      phone1.getByText("Game 2 starts when your host is ready."),
    ).toBeVisible();
    await expect(
      phone1.getByText("Waiting for your host to choose the first question."),
    ).toBeVisible();
    await expect(phone1.getByTestId(TID.playerRevealCorrect.root)).toHaveCount(0);
    await expect(phone1.getByTestId(TID.playerRevealWrong.root)).toHaveCount(0);
    for (const cat of seed.game2Categories) {
      for (const qid of cat.question_ids) {
        await revealViaApi(hostPage, seed.game2.id, qid);
        await expect(phone1.getByTestId(TID.playerQuestion.root))
          .toBeVisible({ timeout: 8_000 });
        await Promise.all([
          tapAnswerSlot(phone1, 1),
          tapAnswerSlot(phone2, 2),
          // phone 3 does NOT tap — they're not in game 2.
        ]);
        await fastForwardTimer(hostPage, qid);
        await expectResolvedTVSnapshot(tvPage, seed.roomCode, seed.game2.id, qid);
        expect(tvPageErrors).toEqual([]);
        await expect(tvPage.getByTestId(TID.tvReveal.root))
          .toBeVisible({ timeout: 8_000 });
      }
    }

    // While game 2 was running, phone 3 should have stayed on PlayerJoinGame2
    // — they didn't opt in, so the state machine kept them on that screen.
    await expect(phone3.getByTestId(TID.playerJoinGame2.root)).toBeVisible();

    // ── Present winners → finale ──────────────────────────────────────
    await expect(hostPhone.getByRole("button", { name: "Return to board" }))
      .toBeVisible({ timeout: 15_000 });
    await hostPhone.getByRole("button", { name: "Return to board" }).click();
    await expect(
      hostPhone.getByRole("heading", { name: "Final scores are ready" }),
    ).toBeVisible({ timeout: 15_000 });
    await hostPhone.getByRole("button", { name: "Present winners" }).click();
    await expect(tvPage.getByTestId(TID.tvFinaleWinner.root))
      .toBeVisible({ timeout: 15_000 });
    await expect(phone1.getByTestId("player-finale"))
      .toBeVisible({ timeout: 15_000 });

    // Assert the WINNER'S VALUES, not just that the card rendered. The
    // game_scores cross-game double-count passed CI for months precisely
    // because this spec only checked visibility (lesson:
    // e2e-assert-values-not-just-visibility-for-correctness). The per-game
    // arithmetic itself is proven deterministically in
    // tests/integration/game-scores-per-game.test.ts; here we guard the
    // finale's identity end-to-end.
    const finaleName = (await tvPage.getByTestId(TID.tvFinaleWinner.name).innerText()).trim();
    const winnerName = finaleName.replace(/\.\s*$/, ""); // rendered as "Alex."
    // Game 2's winner must be a player who opted INTO game 2 (Alex or Brooke).
    // Casey opted out; "Devon" is the /dev demo default that must never leak.
    expect(["Alex", "Brooke"]).toContain(winnerName);

    const scoreText = await tvPage.getByTestId(TID.tvFinaleWinner.score).innerText();
    const winnerScore = Number(scoreText.replace(/[^\d]/g, ""));
    expect(Number.isInteger(winnerScore)).toBe(true);
    expect(winnerScore).toBeGreaterThanOrEqual(0);

    await expect(
      hostPhone.getByRole("heading", { name: "Winners are being presented" }),
    ).toBeVisible({ timeout: 15_000 });
    await hostPhone.getByRole("button", { name: "End game" }).click();
    await expect(phone1).toHaveURL(
      new RegExp(`/room/${seed.roomCode}/(?:won|recap)$`),
      { timeout: 15_000 },
    );
  });
});
