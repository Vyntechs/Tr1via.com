import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import {
  fastForwardTimer,
  listQuestionsInCategory,
  loginAsHost,
  openHostLive,
  resetTestData,
  revealQuestion,
  seedNight,
  startGame,
  type SeededNight,
} from "./helpers/host-laptop";
import { awaitReveal, joinPhone, tapAnswerSlot } from "./helpers/player-phone";
import { TID } from "./helpers/selectors";
import { openTV, waitForQuestionOnTV, waitForRevealOnTV } from "./helpers/tv";

test.describe.configure({ mode: "serial" });

test.describe("all locked auto-reveal", () => {
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
      // Ignore cleanup failures from already-closed contexts.
    }
    await Promise.all(
      [host, tv, p1, p2, p3]
        .filter((c): c is BrowserContext => c !== undefined)
        .map((c) => c.close().catch(() => {})),
    );
  });

  test("reveals automatically after every eligible player locks", async () => {
    const hostPage = await host.newPage();
    const tvPage = await tv.newPage();
    const phone1 = await p1.newPage();
    const phone2 = await p2.newPage();
    const phone3 = await p3.newPage();

    const { seed, questionId } = await setupLiveQuestion({
      hostPage,
      tvPage,
      phone1,
      phone2,
      phone3,
      emailPrefix: "all-locked",
    });

    await Promise.all([
      tapAnswerSlot(phone1, 1),
      tapAnswerSlot(phone2, 2),
      tapAnswerSlot(phone3, 3),
    ]);

    await Promise.all([
      waitForRevealOnTV(tvPage, 12_000),
      awaitReveal(phone1, 12_000),
      awaitReveal(phone2, 12_000),
      awaitReveal(phone3, 12_000),
    ]);

    const snapshot = await tvPage.request.get(`/api/tv/${seed.roomCode}/snapshot`);
    expect(snapshot.ok()).toBe(true);
    const body = (await snapshot.json()) as { targetQuestionId: string | null };
    expect(body.targetQuestionId).toBe(questionId);

    await closePages(hostPage, tvPage, phone1, phone2, phone3);
  });

  test("keeps the question live while one eligible player has not answered", async () => {
    const hostPage = await host.newPage();
    const tvPage = await tv.newPage();
    const phone1 = await p1.newPage();
    const phone2 = await p2.newPage();
    const phone3 = await p3.newPage();

    const { questionId } = await setupLiveQuestion({
      hostPage,
      tvPage,
      phone1,
      phone2,
      phone3,
      emailPrefix: "not-all-locked",
    });

    await Promise.all([tapAnswerSlot(phone1, 1), tapAnswerSlot(phone2, 2)]);

    await tvPage.waitForTimeout(3_000);
    await expect(tvPage.getByTestId(TID.tvQuestion.root)).toBeVisible();
    await expect(tvPage.getByTestId(TID.tvReveal.root)).toHaveCount(0);
    await expect(phone3.getByTestId(TID.playerQuestion.root)).toBeVisible();

    await fastForwardTimer(hostPage, questionId);
    await Promise.all([
      waitForRevealOnTV(tvPage, 10_000),
      awaitReveal(phone1, 10_000),
      awaitReveal(phone2, 10_000),
      awaitReveal(phone3, 10_000),
    ]);

    await closePages(hostPage, tvPage, phone1, phone2, phone3);
  });
});

async function setupLiveQuestion({
  hostPage,
  tvPage,
  phone1,
  phone2,
  phone3,
  emailPrefix,
}: {
  hostPage: Page;
  tvPage: Page;
  phone1: Page;
  phone2: Page;
  phone3: Page;
  emailPrefix: string;
}): Promise<{ seed: SeededNight; questionId: string }> {
  const { hostId } = await loginAsHost(hostPage, `${emailPrefix}-${Date.now()}@tr1via.test`);
  const seed = await seedNight(hostPage, hostId);

  await openTV(tvPage, seed.roomCode);
  await joinPhone(phone1, seed.roomCode, "Alex");
  await joinPhone(phone2, seed.roomCode, "Brooke");
  await joinPhone(phone3, seed.roomCode, "Casey");
  await openHostLive(hostPage, seed.nightId);
  await startGame(hostPage, seed.game1.id);

  const category = seed.categories[0];
  if (!category) throw new Error("seed did not include categories");
  const questionId = listQuestionsInCategory(seed, category.id)[0];
  if (!questionId) throw new Error("seed did not include question ids");

  await revealQuestion(hostPage, questionId);
  await Promise.all([
    waitForQuestionOnTV(tvPage, 10_000),
    expect(phone1.getByTestId(TID.playerQuestion.root)).toBeVisible({ timeout: 10_000 }),
    expect(phone2.getByTestId(TID.playerQuestion.root)).toBeVisible({ timeout: 10_000 }),
    expect(phone3.getByTestId(TID.playerQuestion.root)).toBeVisible({ timeout: 10_000 }),
  ]);

  return { seed, questionId };
}

async function closePages(...pages: Page[]): Promise<void> {
  await Promise.all(pages.map((page) => page.close().catch(() => {})));
}
