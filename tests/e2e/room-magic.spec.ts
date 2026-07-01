import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import {
  fastForwardTimer,
  listQuestionsInCategory,
  loginAsHost,
  openHostLive,
  resetTestData,
  revealViaApi,
  seedNight,
  startGame,
  type SeededNight,
} from "./helpers/host-laptop";
import { awaitReveal, joinPhone } from "./helpers/player-phone";
import { TID } from "./helpers/selectors";
import { openTV, waitForQuestionOnTV, waitForRevealOnTV } from "./helpers/tv";

test.describe.configure({ mode: "serial" });

type ScoreRow = {
  display_name: string;
  score: number;
  correct_count: number;
  answered_count: number;
};

const PLAYERS = ["Alex", "Brooke"] as const;
const ROOM_MAGIC_CONTROLS = "room-magic-reaction-controls";
const TV_ROOM_MAGIC_OVERLAY = "tv-room-magic-overlay";
const TV_ROOM_MAGIC_WOW_EFFECT =
  '[data-testid="tv-room-magic-default-wow"], [data-testid="tv-room-magic-july-effect-wow"]';

test.describe("room magic — default-off Classic safety and bounded TV reactions", () => {
  test.setTimeout(180_000);

  let host: BrowserContext;
  let tv: BrowserContext;
  let p1: BrowserContext;
  let p2: BrowserContext;

  test.beforeAll(async ({ browser }) => {
    host = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    tv = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    p1 = await browser.newContext({ viewport: { width: 390, height: 844 } });
    p2 = await browser.newContext({ viewport: { width: 390, height: 844 } });

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
      // Already-closed contexts should not fail the suite.
    }
    await Promise.all(
      [host, tv, p1, p2]
        .filter((c): c is BrowserContext => c !== undefined)
        .map((c) => c.close().catch(() => {})),
    );
  });

  test("keeps Classic unchanged by default and renders one post-reveal reaction when enabled", async () => {
    const hostPage = await host.newPage();
    const tvPage = await tv.newPage();
    const phone1 = await p1.newPage();
    const phone2 = await p2.newPage();

    const { hostId } = await loginAsHost(hostPage, `room-magic-${Date.now()}@tr1via.test`);

    const classicSeed = await seedNight(hostPage, hostId);
    const classicScores = await playFirstQuestion({
      hostPage,
      tvPage,
      phone1,
      phone2,
      seed: classicSeed,
    });

    await expect(phone1.getByTestId(ROOM_MAGIC_CONTROLS)).toHaveCount(0);
    await expect(phone2.getByTestId(ROOM_MAGIC_CONTROLS)).toHaveCount(0);
    await expect(tvPage.getByTestId(TV_ROOM_MAGIC_OVERLAY)).toHaveCount(0);

    const magicSeed = await seedNight(hostPage, hostId, {
      roomMagicEnabled: true,
      themeKey: "july",
    });
    const magicQuestionId = firstQuestionId(magicSeed);
    const magicScores = await playFirstQuestion({
      hostPage,
      tvPage,
      phone1,
      phone2,
      seed: magicSeed,
    });

    expect(magicScores).toEqual(classicScores);

    const controls = phone1.getByTestId(ROOM_MAGIC_CONTROLS);
    await expect(controls).toBeVisible({ timeout: 8_000 });
    await controls.getByRole("button", { name: "Wow" }).click();
    await expect(controls.getByText("Sent to the room")).toBeVisible();
    for (const button of await controls.getByRole("button").all()) {
      await expect(button).toBeDisabled();
    }

    await expect(tvPage.getByTestId(TV_ROOM_MAGIC_OVERLAY)).toBeVisible({
      timeout: 8_000,
    });
    await expect(
      tvPage.getByTestId(TV_ROOM_MAGIC_OVERLAY).locator(TV_ROOM_MAGIC_WOW_EFFECT),
    ).toBeVisible();
    await expect(tvPage.getByTestId(TV_ROOM_MAGIC_OVERLAY)).not.toContainText(/wow/i);

    const duplicate = await phone1.request.post("/api/room-magic/reactions", {
      data: { questionId: magicQuestionId, kind: "brutal" },
    });
    expect(duplicate.ok()).toBe(true);
    await expect(duplicate.json()).resolves.toMatchObject({
      accepted: false,
      reason: "already_sent",
    });
  });
});

async function playFirstQuestion({
  hostPage,
  tvPage,
  phone1,
  phone2,
  seed,
}: {
  hostPage: Page;
  tvPage: Page;
  phone1: Page;
  phone2: Page;
  seed: SeededNight;
}): Promise<Record<(typeof PLAYERS)[number], ScoreRow>> {
  const questionId = firstQuestionId(seed);

  await openTV(tvPage, seed.roomCode);
  await joinPhone(phone1, seed.roomCode, PLAYERS[0]);
  await joinPhone(phone2, seed.roomCode, PLAYERS[1]);
  await openHostLive(hostPage, seed.nightId);
  await startGame(hostPage, seed.game1.id);

  await revealViaApi(hostPage, seed.game1.id, questionId);
  await Promise.all([
    waitForQuestionOnTV(tvPage, 10_000),
    expect(phone1.getByTestId(TID.playerQuestion.root)).toBeVisible({ timeout: 10_000 }),
    expect(phone2.getByTestId(TID.playerQuestion.root)).toBeVisible({ timeout: 10_000 }),
  ]);

  await Promise.all([
    tapAnswerByText(phone1, "Alpha"),
    tapAnswerByText(phone2, "Bravo"),
  ]);

  await fastForwardTimer(hostPage, questionId);
  await Promise.all([
    waitForRevealOnTV(tvPage, 10_000),
    awaitReveal(phone1, 10_000),
    awaitReveal(phone2, 10_000),
  ]);

  return scoresByName(tvPage, seed.roomCode, PLAYERS);
}

function firstQuestionId(seed: SeededNight): string {
  const category = seed.categories[0];
  if (!category) throw new Error("seed did not include any categories");
  const questionId = listQuestionsInCategory(seed, category.id)[0];
  if (!questionId) throw new Error("seed did not include a first question");
  return questionId;
}

async function tapAnswerByText(page: Page, answer: string): Promise<void> {
  const button = page.getByRole("button", { name: new RegExp(`\\b${answer}\\b`) });
  await expect(button).toBeVisible({ timeout: 5_000 });
  await button.click();
  await expect(page.getByTestId(TID.playerLocked.root)).toBeVisible({ timeout: 3_000 });
}

async function scoresByName(
  page: Page,
  roomCode: string,
  names: readonly (typeof PLAYERS)[number][],
): Promise<Record<(typeof PLAYERS)[number], ScoreRow>> {
  let result: Record<(typeof PLAYERS)[number], ScoreRow> | null = null;

  await expect(async () => {
    const res = await page.request.get(`/api/tv/${roomCode}/snapshot`);
    expect(res.ok()).toBe(true);
    const body = (await res.json()) as { scores: ScoreRow[] };
    const byName = new Map(body.scores.map((row) => [row.display_name, row]));
    result = Object.fromEntries(
      names.map((name) => {
        const row = byName.get(name);
        expect(row, `missing score row for ${name}`).toBeTruthy();
        return [
          name,
          {
            display_name: row!.display_name,
            score: row!.score,
            correct_count: row!.correct_count,
            answered_count: row!.answered_count,
          },
        ];
      }),
    ) as Record<(typeof PLAYERS)[number], ScoreRow>;
  }).toPass({ timeout: 10_000 });

  if (!result) throw new Error("score snapshot did not settle");
  return result;
}
