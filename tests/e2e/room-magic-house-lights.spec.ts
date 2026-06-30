import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
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

const ARTIFACT_DIR = path.join(
  process.cwd(),
  "test-results",
  "room-magic-house-lights",
);
const PLAYERS = ["Alex", "Brooke", "Casey"] as const;
const HOUSE_LIGHTS = "tv-house-lights";
const PLAYER_CONFIRMATION = "player-house-lights-confirmation";

type ScoreRow = {
  display_name: string;
  score: number;
  correct_count: number;
  answered_count: number;
};

type RehearsalResult = {
  label: string;
  scores: Record<string, ScoreRow>;
  screenshots: string[];
};

test.describe("room magic house lights validation", () => {
  test.setTimeout(240_000);

  let host: BrowserContext;
  let tv: BrowserContext;
  let p1: BrowserContext;
  let p2: BrowserContext;
  let p3: BrowserContext;

  test.beforeAll(async ({ browser }) => {
    mkdirSync(ARTIFACT_DIR, { recursive: true });
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
      // Cleanup is best-effort; assertions already failed if the rehearsal broke.
    }

    await Promise.all(
      [host, tv, p1, p2, p3]
        .filter((c): c is BrowserContext => c !== undefined)
        .map((c) => c.close().catch(() => {})),
    );
  });

  test("proves Classic off, Room Magic on, screenshots, console health, and scoring parity", async () => {
    const hostPage = await host.newPage();
    const tvPage = await tv.newPage();
    const phone1 = await p1.newPage();
    const phone2 = await p2.newPage();
    const phone3 = await p3.newPage();

    const consoleErrors = collectConsoleErrors([
      hostPage,
      tvPage,
      phone1,
      phone2,
      phone3,
    ]);

    const { hostId } = await loginAsHost(
      hostPage,
      `house-lights-${Date.now()}@tr1via.test`,
    );

    const classicSeed = await seedNight(hostPage, hostId);
    const classic = await runLockInRehearsal({
      label: "classic-off",
      hostPage,
      tvPage,
      phones: [phone1, phone2, phone3],
      seed: classicSeed,
      expectHouseLights: false,
    });

    const magicSeed = await seedNight(hostPage, hostId, {
      roomMagicEnabled: true,
    });
    const magic = await runLockInRehearsal({
      label: "room-magic-on",
      hostPage,
      tvPage,
      phones: [phone1, phone2, phone3],
      seed: magicSeed,
      expectHouseLights: true,
    });

    expect(magic.scores).toEqual(classic.scores);
    expect(consoleErrors).toEqual([]);

    writeFileSync(
      path.join(ARTIFACT_DIR, "summary.json"),
      JSON.stringify(
        {
          classicDisabledUnchanged: true,
          roomMagicEnabledHouseLightsVisible: true,
          scoresMatched: true,
          consoleErrors,
          screenshots: [...classic.screenshots, ...magic.screenshots],
        },
        null,
        2,
      ),
    );
  });
});

async function runLockInRehearsal({
  label,
  hostPage,
  tvPage,
  phones,
  seed,
  expectHouseLights,
}: {
  label: string;
  hostPage: Page;
  tvPage: Page;
  phones: Page[];
  seed: SeededNight;
  expectHouseLights: boolean;
}): Promise<RehearsalResult> {
  const screenshots: string[] = [];
  const questionId = firstQuestionId(seed);

  await openTV(tvPage, seed.roomCode);
  await Promise.all(
    phones.map((phone, index) => joinPhone(phone, seed.roomCode, PLAYERS[index])),
  );
  await openHostLive(hostPage, seed.nightId);
  await startGame(hostPage, seed.game1.id);
  await revealViaApi(hostPage, seed.game1.id, questionId);

  await Promise.all([
    waitForQuestionOnTV(tvPage, 10_000),
    expect(hostPage.getByTestId(TID.tvQuestion.root)).toBeVisible({
      timeout: 10_000,
    }),
    ...phones.map((phone) =>
      expect(phone.getByTestId(TID.playerQuestion.root)).toBeVisible({
        timeout: 10_000,
      }),
    ),
  ]);

  await Promise.all([
    tapAnswerByText(phones[0], "Alpha"),
    tapAnswerByText(phones[1], "Bravo"),
    tapAnswerByText(phones[2], "Alpha"),
  ]);

  if (expectHouseLights) {
    await expect(tvPage.getByTestId(HOUSE_LIGHTS)).toBeVisible({
      timeout: 10_000,
    });
    await expect(
      hostPage.getByTestId("host-tv-panel").getByTestId(HOUSE_LIGHTS),
    ).toBeVisible({ timeout: 10_000 });
    await Promise.all(
      phones.map((phone) =>
        expect(phone.getByTestId(PLAYER_CONFIRMATION)).toBeVisible(),
      ),
    );
  } else {
    await expect(tvPage.getByTestId(HOUSE_LIGHTS)).toHaveCount(0);
    await expect(
      hostPage.getByTestId("host-tv-panel").getByTestId(HOUSE_LIGHTS),
    ).toHaveCount(0);
    await Promise.all(
      phones.map((phone) =>
        expect(phone.getByTestId(PLAYER_CONFIRMATION)).toHaveCount(0),
      ),
    );
  }

  screenshots.push(await screenshot(tvPage, `${label}-tv-question`));
  screenshots.push(await screenshot(hostPage, `${label}-host-question`));
  screenshots.push(await screenshot(phones[0], `${label}-phone-question`));

  await fastForwardTimer(hostPage, questionId);
  await Promise.all([
    waitForRevealOnTV(tvPage, 10_000),
    ...phones.map((phone) => awaitReveal(phone, 10_000)),
  ]);

  const scores = await scoresByName(tvPage, seed.roomCode, PLAYERS);
  screenshots.push(await screenshot(tvPage, `${label}-tv-reveal`));

  return { label, scores, screenshots };
}

function firstQuestionId(seed: SeededNight): string {
  const category = seed.categories[0];
  if (!category) throw new Error("seed did not include any categories");
  const questionId = listQuestionsInCategory(seed, category.id)[0];
  if (!questionId) throw new Error("seed did not include a first question");
  return questionId;
}

async function tapAnswerByText(page: Page, answer: string): Promise<void> {
  const button = page.getByRole("button", {
    name: new RegExp(`\\b${answer}\\b`),
  });
  await expect(button).toBeVisible({ timeout: 5_000 });
  await button.click();
  await expect(page.getByTestId(TID.playerLocked.root)).toBeVisible({
    timeout: 3_000,
  });
}

async function scoresByName(
  page: Page,
  roomCode: string,
  names: readonly string[],
): Promise<Record<string, ScoreRow>> {
  let result: Record<string, ScoreRow> | null = null;

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
    );
  }).toPass({ timeout: 10_000 });

  if (!result) throw new Error("score snapshot did not settle");
  return result;
}

async function screenshot(page: Page, name: string): Promise<string> {
  const file = path.join(ARTIFACT_DIR, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  return file;
}

function collectConsoleErrors(pages: Page[]): string[] {
  const errors: string[] = [];
  for (const page of pages) {
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    page.on("pageerror", (error) => {
      errors.push(error.message);
    });
  }
  return errors;
}
