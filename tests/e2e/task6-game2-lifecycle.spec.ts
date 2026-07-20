// Focused Task 6 lifecycle proof.
//
// This intentionally skips Game 1's 21-question play loop. It exercises the
// durable boundary that matters here: intermission -> Game 2 opt-in -> all
// seven Game 2 reveals -> winners -> close. The larger full-game rehearsal
// remains the broad regression suite; this test keeps lifecycle diagnosis
// short enough to identify the exact failing boundary.

import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import {
  endGame,
  fastForwardTimer,
  loginAsHost,
  openHostLive,
  resetTestData,
  revealViaApi,
  seedNight,
  startGame,
} from "./helpers/host-laptop";
import { joinPhone, tapAnswerSlot } from "./helpers/player-phone";
import { TID } from "./helpers/selectors";
import { openTV } from "./helpers/tv";

async function expectResolvedTVSnapshot(
  page: Page,
  gameCode: string,
  gameId: string,
  questionId: string,
) {
  await expect.poll(async () => {
    const response = await page.request.get(`/api/tv/${gameCode}/snapshot`);
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

test.describe("Game 2 lifecycle — intermission to recap", () => {
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
      // Cleanup is best-effort if the browser context already closed.
    }
    await Promise.all(
      [host, tv, p1, p2, p3]
        .filter((context): context is BrowserContext => context !== undefined)
        .map((context) => context.close().catch(() => {})),
    );
  });

  test("two players opt into Game 2 while a third stays out through the finale", async () => {
    const hostPage = await host.newPage();
    const hostPhone = await host.newPage();
    await hostPhone.setViewportSize({ width: 430, height: 932 });
    const tvPage = await tv.newPage();
    const phone1 = await p1.newPage();
    const phone2 = await p2.newPage();
    const phone3 = await p3.newPage();

    const pageErrors: string[] = [];
    for (const page of [hostPage, hostPhone, tvPage, phone1, phone2, phone3]) {
      page.on("pageerror", (error) => pageErrors.push(`${page.url()}: ${error.message}`));
    }

    const { hostId } = await loginAsHost(hostPage, `task6-${Date.now()}@tr1via.test`);
    const seed = await seedNight(hostPage, hostId, "two-games-ready");
    expect(seed.game2Categories).toHaveLength(1);
    expect(seed.game2Categories[0]?.question_ids).toHaveLength(7);

    await openTV(tvPage, seed.roomCode);
    await joinPhone(phone1, seed.roomCode, "Alex");
    await joinPhone(phone2, seed.roomCode, "Brooke");
    await joinPhone(phone3, seed.roomCode, "Casey");
    await openHostLive(hostPage, seed.nightId);

    // The lifecycle under test starts at the durable Game 1 -> Game 2
    // boundary, so Game 1 is intentionally started and ended without play.
    await startGame(hostPage, seed.game1.id);
    await endGame(hostPage, seed.game1.id);

    await expect(tvPage.getByTestId(TID.tvIntermission.root))
      .toBeVisible({ timeout: 15_000 });
    await expect(tvPage.getByText("Casey", { exact: true })).toBeVisible();
    for (const phone of [phone1, phone2, phone3]) {
      await expect(phone.getByTestId(TID.playerJoinGame2.root))
        .toBeVisible({ timeout: 15_000 });
      await expect(phone.getByText("Bonus round", { exact: true })).toBeVisible();
      await expect(phone.getByText("general trivia", { exact: true })).toHaveCount(0);
    }

    await hostPhone.goto(`/host/phone/${seed.nightId}`);
    await expect(hostPhone.getByText("Game 1 complete")).toBeVisible({ timeout: 15_000 });
    await expect(hostPhone.getByRole("heading", { name: "Game 2 is ready" })).toBeVisible();

    await phone1.getByTestId(TID.playerJoinGame2.submit).click();
    await phone2.getByTestId(TID.playerJoinGame2.submit).click();
    await expect(phone1.getByTestId(TID.playerBetweenGames.root))
      .toBeVisible({ timeout: 15_000 });
    await expect(phone2.getByTestId(TID.playerBetweenGames.root))
      .toBeVisible({ timeout: 15_000 });
    await expect(phone3.getByTestId(TID.playerJoinGame2.root)).toBeVisible();

    await hostPhone.getByRole("button", { name: "Start Game 2" }).click();
    await expect(tvPage.getByTestId(TID.tvIntermission.root))
      .toBeVisible({ timeout: 15_000 });
    // Game 2 has only Alex and Brooke. Casey remaining on this podium proves
    // the TV retained Game 1 standings instead of silently switching to the
    // just-started Game 2 score set during the pre-question wait.
    await expect(tvPage.getByText("Casey", { exact: true })).toBeVisible();
    await expect(
      phone1.getByText("Waiting for your host to choose the first question."),
    ).toBeVisible({ timeout: 15_000 });

    for (const category of seed.game2Categories) {
      for (const questionId of category.question_ids) {
        await revealViaApi(hostPage, seed.game2.id, questionId);
        await Promise.all([
          expect(phone1.getByTestId(TID.playerQuestion.root)).toBeVisible({ timeout: 8_000 }),
          expect(phone2.getByTestId(TID.playerQuestion.root)).toBeVisible({ timeout: 8_000 }),
        ]);
        await Promise.all([
          tapAnswerSlot(phone1, 1),
          tapAnswerSlot(phone2, 2),
        ]);
        await fastForwardTimer(hostPage, questionId);
        await expectResolvedTVSnapshot(
          tvPage,
          seed.roomCode,
          seed.game2.id,
          questionId,
        );
        await expect(tvPage.getByTestId(TID.tvReveal.root))
          .toBeVisible({ timeout: 8_000 });
        expect(pageErrors).toEqual([]);
      }
    }

    await expect(phone3.getByTestId(TID.playerJoinGame2.root)).toBeVisible();
    await expect(hostPhone.getByRole("button", { name: "Return to board" }))
      .toBeVisible({ timeout: 15_000 });
    await hostPhone.getByRole("button", { name: "Return to board" }).click();
    await expect(hostPhone.getByRole("heading", { name: "Final scores are ready" }))
      .toBeVisible({ timeout: 15_000 });
    await hostPhone.getByRole("button", { name: "Present winners" }).click();

    await expect(tvPage.getByTestId(TID.tvFinaleWinner.root))
      .toBeVisible({ timeout: 15_000 });
    await expect(phone1.getByTestId("player-finale"))
      .toBeVisible({ timeout: 15_000 });
    await expect(phone2.getByTestId("player-finale"))
      .toBeVisible({ timeout: 15_000 });
    await expect(hostPhone.getByRole("heading", { name: "Winners are being presented" }))
      .toBeVisible({ timeout: 15_000 });

    await hostPhone.getByRole("button", { name: "End game" }).click();
    await expect(phone1).toHaveURL(
      new RegExp(`/room/${seed.roomCode}/(?:won|recap)$`),
      { timeout: 15_000 },
    );
    await expect(phone2).toHaveURL(
      new RegExp(`/room/${seed.roomCode}/(?:won|recap)$`),
      { timeout: 15_000 },
    );
    expect(pageErrors).toEqual([]);
  });
});
