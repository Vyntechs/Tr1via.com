// phone-instant-lock.spec.ts — a tapped answer locks on the phone at once,
// says "Sending…", then "Locked in" from the send reply itself; a slow or
// failing network keeps the choice on screen and says so plainly.
//
// The tap changes the SAME screen in place: the question text and the four
// cards must not move at any frame from the tap to "Locked in" (measured on
// every animation frame, in the page, at 320 and 390 px wide).
//
// The network is simulated at the browser (page.route on /api/answers); the
// server, its rules and its routes are the real local ones, untouched.
// Screenshots go to PHONELOCK_SHOTS (default: test-results/) so the look can
// be judged on every theme.

import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";
import { loginAsHost, seedNight, startGame, revealViaApi, resetTestData } from "./helpers/host-laptop";
import { joinPhone } from "./helpers/player-phone";
import { TID } from "./helpers/selectors";
import { THEME_KEYS } from "../../lib/theme/tokens";

// Screenshots land under test-results/ unless PHONELOCK_SHOTS points elsewhere.
const SHOTS = process.env.PHONELOCK_SHOTS ?? path.join("test-results", "phonelock-shots");
const HOST_EMAIL = "phonelock-host@tr1via.test";

test.describe.configure({ mode: "serial" });

let host: BrowserContext;
let hostPage: Page;
let hostId: string;

test.beforeAll(async ({ browser }) => {
  fs.mkdirSync(SHOTS, { recursive: true });
  host = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  hostPage = await host.newPage();
  await resetTestData(hostPage);
  ({ hostId } = await loginAsHost(hostPage, HOST_EMAIL));
});

test.afterAll(async () => {
  try {
    await resetTestData(hostPage);
  } catch {
    /* already closed */
  }
  await host.close().catch(() => {});
});

/** A phone on a live question, ready to tap. */
async function phoneOnQuestion(
  browser: import("@playwright/test").Browser,
  themeKey: string,
  opts: { viewport?: { width: number; height: number }; reducedMotion?: "reduce" | "no-preference" } = {},
) {
  const seed = await seedNight(hostPage, hostId, { themeKey });
  const context = await browser.newContext({
    viewport: opts.viewport ?? { width: 390, height: 844 },
    reducedMotion: opts.reducedMotion ?? "no-preference",
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  await joinPhone(page, seed.roomCode, `Lock ${themeKey}`.slice(0, 20));
  await startGame(hostPage, seed.game1.id);
  const questionId = seed.categories[0]!.question_ids[0]!;
  await revealViaApi(hostPage, seed.game1.id, questionId);
  await expect(page.getByTestId(TID.playerQuestion.root)).toBeVisible({ timeout: 15_000 });
  return { page, context, seed, questionId };
}

const status = (page: Page) => page.getByTestId(TID.playerLocked.status);

/** Top/height of the question text, the strip and each answer card. */
async function layoutOf(page: Page) {
  return page.evaluate(() => (window as unknown as { __layout: () => Layout }).__layout());
}

interface Box {
  top: number;
  height: number;
}
interface Layout {
  prompt: Box | null;
  strip: Box;
  cards: Box[];
}

/**
 * Puts a probe in the page (not driven by Playwright, so a busy machine cannot
 * skew it): `__layout()` reads the boxes now; `__startSample()` records, on
 * every animation frame from the next click on, how far anything moved from its
 * place before the tap, how soon after the click the sending state was up, and
 * whether the very same elements are still there.
 */
async function installProbe(page: Page) {
  await page.evaluate(() => {
    type W = Window & Record<string, unknown>;
    const w = window as unknown as W;
    const rect = (el: Element) => {
      const b = el.getBoundingClientRect();
      return { top: Math.round(b.top * 100) / 100, height: Math.round(b.height * 100) / 100 };
    };
    const cardsNow = () =>
      Array.from(document.querySelectorAll<HTMLElement>('[data-testid^="player-answer-"], [data-testid^="player-locked-answer-"]'));
    const promptNow = () => document.querySelector<HTMLElement>('[data-testid="player-question-prompt"]');
    w.__layout = () => {
      const cards = cardsNow();
      const strip = cards[0]?.parentElement?.previousElementSibling;
      return {
        prompt: promptNow() ? rect(promptNow()!) : null,
        strip: strip ? rect(strip) : null,
        cards: cards.map(rect),
      };
    };
    w.__startSample = () => {
      const base = (w.__layout as () => { prompt: { top: number; height: number } | null; strip: { top: number; height: number }; cards: { top: number; height: number }[] })();
      const nodes0 = [promptNow(), ...cardsNow()];
      const state = { frames: 0, maxMove: 0, maxResize: 0, lockedMs: -1 as number, t0: -1 as number, stopped: false };
      const compare = () => {
        const now = (w.__layout as typeof w.__layout & (() => typeof base))();
        const pairs: Array<[{ top: number; height: number } | null, { top: number; height: number } | null]> = [
          [base.prompt, now.prompt],
          [base.strip, now.strip],
          ...base.cards.map((c, i) => [c, now.cards[i] ?? null] as [typeof c, typeof c | null]),
        ];
        for (const [a, b] of pairs) {
          if (!a) continue;
          if (!b) {
            state.maxMove = Infinity; // an element that was there is gone
            continue;
          }
          state.maxMove = Math.max(state.maxMove, Math.abs(a.top - b.top));
          state.maxResize = Math.max(state.maxResize, Math.abs(a.height - b.height));
        }
        if (now.cards.length !== base.cards.length) state.maxMove = Infinity;
      };
      document.addEventListener(
        "click",
        () => {
          if (state.t0 < 0) state.t0 = performance.now();
        },
        { capture: true },
      );
      new MutationObserver(() => {
        if (state.t0 >= 0 && state.lockedMs < 0 && document.querySelector('[data-send-state]')) {
          state.lockedMs = performance.now() - state.t0;
        }
      }).observe(document.body, { subtree: true, childList: true, attributes: true });
      const tick = () => {
        if (state.stopped) return;
        state.frames += 1;
        compare();
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      w.__stopSample = () => {
        state.stopped = true;
        compare();
        const nodes1 = [promptNow(), ...cardsNow()];
        return {
          frames: state.frames,
          maxMove: state.maxMove,
          maxResize: state.maxResize,
          lockedMs: state.lockedMs,
          sameNodes: nodes0.length === nodes1.length && nodes0.every((n, i) => n === nodes1[i] && n!.isConnected),
        };
      };
    };
  });
}

type Sample = { frames: number; maxMove: number; maxResize: number; lockedMs: number; sameNodes: boolean };
const stopSample = (page: Page) => page.evaluate(() => (window as unknown as { __stopSample: () => Sample }).__stopSample());

/** Let the cards' entrance animation finish so the "before" boxes are the real ones. */
const settleEntrance = (page: Page) => page.waitForTimeout(1200);

/**
 * The core promise. Tap with the reply held: the question text, the strip and
 * the four cards stay exactly where they were on every frame (tap -> Sending
 * -> Locked in), they are the same elements, the chosen card is highlighted and
 * the others dimmed, and the page's own click-to-sending time is quick.
 */
async function tapKeepsEverythingInPlace(
  browser: import("@playwright/test").Browser,
  themeKey: string,
  viewport: { width: number; height: number },
  shotPrefix: string,
) {
  const { page, context } = await phoneOnQuestion(browser, themeKey, { viewport });
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/api/answers", async (route) => {
    await held;
    await route.continue();
  });
  await settleEntrance(page);
  await installProbe(page);
  const before = await layoutOf(page);
  expect(before.cards).toHaveLength(4); // never compare empty lists
  expect(before.prompt).not.toBeNull();
  await page.evaluate(() => (window as unknown as { __startSample: () => void }).__startSample());

  await page.getByTestId(TID.playerQuestion.answer(2)).tap();
  // Locked on screen while the reply is still held: this is the logical claim.
  await expect(status(page)).toHaveAttribute("data-send-state", "sending", { timeout: 5000 });
  await expect(status(page)).toContainText("Sending");
  await expect(page.getByTestId(TID.playerLocked.root)).toBeVisible();
  // The question text is still on screen under the finger.
  await expect(page.getByTestId("player-question-prompt")).toBeVisible();
  const justAfter = await layoutOf(page);
  expect(justAfter).toEqual(before);

  await page.waitForTimeout(700); // let the highlight / dimming finish
  await page.screenshot({ path: path.join(SHOTS, `${shotPrefix}-1-sending.png`) });
  // Chosen card clear, the others calmly dimmed.
  const opacities = () =>
    page.evaluate(() =>
      [1, 2, 3, 4].map((n) =>
        Number(getComputedStyle(document.querySelector(`[data-testid="player-locked-answer-${n}"]`)!).opacity),
      ),
    );
  await expect.poll(async () => (await opacities())[1], { timeout: 10_000 }).toBe(1);
  for (const n of [0, 2, 3]) {
    await expect.poll(async () => (await opacities())[n]!, { timeout: 10_000 }).toBeLessThan(0.5);
  }

  release();
  await expect(status(page)).toHaveAttribute("data-send-state", "locked", { timeout: 10_000 });
  await expect(status(page)).toContainText(/locked/i);
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(SHOTS, `${shotPrefix}-2-locked-in.png`) });
  const afterLocked = await layoutOf(page);
  expect(afterLocked).toEqual(before);

  const sample = await stopSample(page);
  expect(sample.frames).toBeGreaterThan(5); // sampled; zero movement on every sampled frame is the claim
  expect(sample.maxMove).toBeLessThanOrEqual(0.5); // no vertical (or any) movement, any frame
  expect(sample.maxResize).toBeLessThanOrEqual(0.5);
  expect(sample.sameNodes).toBe(true);
  // Measured in the page, so a busy machine cannot skew it. Generous bound:
  // the claim is "at once, long before the held reply", not a stopwatch race.
  expect(sample.lockedMs).toBeGreaterThanOrEqual(0);
  expect(sample.lockedMs).toBeLessThan(1000);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
  await context.close();
  return sample;
}

test.describe("phone answer: instant lock, sending, locked in", () => {
  test.setTimeout(120_000);

  // The small phone is where the old jump was worst (cards moved ~116 px).
  for (const themeKey of THEME_KEYS) {
    test(`${themeKey} 320px: the tap changes nothing but the look (no card or text moves), Sending… then Locked in`, async ({ browser }) => {
      await tapKeepsEverythingInPlace(browser, themeKey, { width: 320, height: 568 }, `${themeKey}-320`);
    });
  }
  for (const themeKey of THEME_KEYS) {
    test(`${themeKey} 390px: the tap changes nothing but the look (no card or text moves), Sending… then Locked in`, async ({ browser }) => {
      await tapKeepsEverythingInPlace(browser, themeKey, { width: 390, height: 844 }, `${themeKey}-390`);
    });
  }

  test("house: Locked in comes from the send reply even while the room fetch is held", async ({ browser }) => {
    const { page, context } = await phoneOnQuestion(browser, "house");
    // Hold every room snapshot the phone asks for, from the tap on.
    let releaseRoom!: () => void;
    const roomHeld = new Promise<void>((resolve) => (releaseRoom = resolve));
    await page.route("**/api/room/*/snapshot*", async (route) => {
      await roomHeld;
      await route.continue();
    });
    await page.getByTestId(TID.playerQuestion.answer(2)).tap();
    await expect(status(page)).toHaveAttribute("data-send-state", "locked", { timeout: 5000 });
    await expect(status(page)).toContainText("Locked in");
    await expect(status(page)).not.toContainText("LOCKED AT");
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(SHOTS, "house-2b-locked-in-before-room-fetch.png") });
    releaseRoom();
    await expect(status(page)).toContainText("LOCKED AT", { timeout: 10_000 });
    await context.close();
  });

  test("house: slow >6 s send says retrying, keeps the choice, then locks in when it lands", async ({ browser }) => {
    const { page, context } = await phoneOnQuestion(browser, "house");
    let calls = 0;
    await page.route("**/api/answers", async (route) => {
      calls += 1;
      if (calls === 1) {
        await new Promise((r) => setTimeout(r, 9000)); // first request: very slow
      }
      await route.continue();
    });
    await page.getByTestId(TID.playerQuestion.answer(3)).tap();
    await expect(status(page)).toHaveAttribute("data-send-state", "sending");
    await expect(status(page)).toHaveAttribute("data-send-state", "retrying", { timeout: 8000 });
    await expect(status(page)).toContainText("Didn’t go through — retrying");
    await page.screenshot({ path: path.join(SHOTS, "house-3-slow-retrying.png") });
    await expect(status(page)).toHaveAttribute("data-send-state", "locked", { timeout: 15_000 });
    await context.close();
  });

  test("house: failing network keeps retrying, then locks in once it recovers", async ({ browser }) => {
    const { page, context } = await phoneOnQuestion(browser, "house");
    let calls = 0;
    await page.route("**/api/answers", async (route) => {
      calls += 1;
      if (calls <= 3) return route.abort("connectionfailed");
      return route.continue();
    });
    await page.getByTestId(TID.playerQuestion.answer(1)).tap();
    await expect(status(page)).toHaveAttribute("data-send-state", "retrying", { timeout: 5000 });
    await page.screenshot({ path: path.join(SHOTS, "house-4-failing-retrying.png") });
    await expect(status(page)).toHaveAttribute("data-send-state", "locked", { timeout: 15_000 });
    expect(calls).toBeGreaterThanOrEqual(4);
    await page.screenshot({ path: path.join(SHOTS, "house-5-recovered-locked.png") });
    await context.close();
  });

  test("house: a venue proxy's 408 / 425 is a network hiccup: it retries, never shows Try again", async ({ browser }) => {
    const { page, context } = await phoneOnQuestion(browser, "house");
    const replies = [408, 425];
    let calls = 0;
    await page.route("**/api/answers", async (route) => {
      const code = replies[calls];
      calls += 1;
      if (code) return route.fulfill({ status: code, contentType: "text/plain", body: "" });
      return route.continue();
    });
    await page.getByTestId(TID.playerQuestion.answer(2)).tap();
    await expect(status(page)).toHaveAttribute("data-send-state", "retrying", { timeout: 5000 });
    await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(0);
    await expect(status(page)).toHaveAttribute("data-send-state", "locked", { timeout: 15_000 });
    expect(calls).toBe(3);
    await context.close();
  });

  test("october: failing network, retrying look", async ({ browser }) => {
    const { page, context } = await phoneOnQuestion(browser, "october");
    let calls = 0;
    await page.route("**/api/answers", async (route) => {
      calls += 1;
      if (calls <= 2) return route.abort("connectionfailed");
      return route.continue();
    });
    await page.getByTestId(TID.playerQuestion.answer(4)).tap();
    await expect(status(page)).toHaveAttribute("data-send-state", "retrying", { timeout: 5000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(SHOTS, "october-4-failing-retrying.png") });
    await expect(status(page)).toHaveAttribute("data-send-state", "locked", { timeout: 15_000 });
    await context.close();
  });

  test("house, small phone (320 wide): the longest line (retrying) wraps inside the strip, nothing moves", async ({ browser }) => {
    const { page, context } = await phoneOnQuestion(browser, "house", { viewport: { width: 320, height: 568 } });
    await settleEntrance(page);
    await installProbe(page);
    const before = await layoutOf(page);
    expect(before.cards).toHaveLength(4);
    await page.route("**/api/answers", (route) => route.abort("connectionfailed"));
    await page.getByTestId(TID.playerQuestion.answer(1)).tap();
    await expect(status(page)).toHaveAttribute("data-send-state", "retrying", { timeout: 5000 });
    await page.waitForTimeout(500);
    // The longest line wraps inside the strip: nothing moves (no 11 px growth).
    expect(await layoutOf(page)).toEqual(before);
    await page.screenshot({ path: path.join(SHOTS, "house-320-retrying.png") });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBe(false);
    await context.close();
  });

  for (const [themeKey, width, height] of [
    ["house", 320, 568],
    ["october", 320, 568],
    ["house", 390, 844],
  ] as const) {
    test(`${themeKey} ${width}px: a refused answer shows a 44 px Try again, nothing moves, another answer can be picked`, async ({ browser }) => {
      const { page, context } = await phoneOnQuestion(browser, themeKey, { viewport: { width, height } });
      await settleEntrance(page);
      await installProbe(page);
      const before = await layoutOf(page);
      expect(before.cards).toHaveLength(4);
      let release!: () => void;
      const held = new Promise<void>((resolve) => (release = resolve));
      let calls = 0;
      const bodies: string[] = [];
      await page.route("**/api/answers", async (route) => {
        calls += 1;
        bodies.push(route.request().postData() ?? "");
        if (calls === 1) {
          await held;
          return route.fulfill({
            status: 400,
            contentType: "application/json",
            body: JSON.stringify({ error: "answer deadline passed" }),
          });
        }
        return route.continue();
      });
      await page.getByTestId(TID.playerQuestion.answer(1)).tap();
      await expect(status(page)).toHaveAttribute("data-send-state", "sending");
      await page.waitForTimeout(700);
      const whileSending = await layoutOf(page);
      expect(whileSending).toEqual(before);

      release();
      await expect(status(page)).toHaveAttribute("data-send-state", "rejected", { timeout: 5000 });
      await expect(status(page)).not.toContainText("Locked in");
      await page.waitForTimeout(700);
      await page.screenshot({ path: path.join(SHOTS, `${themeKey}-${width}-rejected.png`) });
      const afterRejected = await layoutOf(page);
      expect(afterRejected).toEqual(before);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      expect(overflow).toBe(false);

      const tryAgain = page.getByRole("button", { name: "Try again" });
      const box = await tryAgain.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);

      // Change of mind: pick a different answer; it is sent and locks in.
      await page.getByTestId("player-locked-answer-3").tap();
      await expect(status(page)).toHaveAttribute("data-send-state", "locked", { timeout: 10_000 });
      expect(bodies).toHaveLength(2);
      expect(JSON.parse(bodies[1]!)).toMatchObject({ slotChosen: 3 });
      await context.close();
    });
  }

  test("house: a 200 reply that is not a real confirm never says Locked in", async ({ browser }) => {
    const { page, context } = await phoneOnQuestion(browser, "house");
    await page.route("**/api/answers", (route) =>
      route.fulfill({ status: 200, contentType: "text/html", body: "<html>venue login</html>" }),
    );
    await page.getByTestId(TID.playerQuestion.answer(2)).tap();
    await expect(status(page)).toHaveAttribute("data-send-state", "retrying", { timeout: 8000 });
    await expect(status(page)).not.toContainText("Locked in");
    await context.close();
  });

  test("house: the chosen answer keeps keyboard focus after the tap", async ({ browser }) => {
    const { page, context } = await phoneOnQuestion(browser, "house");
    await page.getByTestId(TID.playerQuestion.answer(2)).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId(TID.playerLocked.root)).toBeVisible({ timeout: 2000 });
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.getAttribute("data-testid")))
      .toBe("player-locked-answer-2");
    await context.close();
  });

  test("reduced motion: the status dot holds still", async ({ browser }) => {
    const { page, context } = await phoneOnQuestion(browser, "house", { reducedMotion: "reduce" });
    await page.route("**/api/answers", () => new Promise(() => {})); // never answered
    await page.getByTestId(TID.playerQuestion.answer(1)).tap();
    await expect(status(page)).toHaveAttribute("data-send-state", "sending");
    const animation = await page.getByTestId("player-send-dot").evaluate((el) => getComputedStyle(el).animationName);
    expect(animation).toBe("none");
    await page.screenshot({ path: path.join(SHOTS, "house-6-reduced-motion-sending.png") });
    await context.close();
  });

  test("house: network down until the question closes says so plainly (never confirmed)", async ({ browser }) => {
    test.setTimeout(150_000);
    const { page, context } = await phoneOnQuestion(browser, "house");
    await page.route("**/api/answers", (route) => route.abort("connectionfailed"));
    await page.getByTestId(TID.playerQuestion.answer(2)).tap();
    await expect(status(page)).toHaveAttribute("data-send-state", "retrying", { timeout: 5000 });
    // Keep retrying until the phone's own timer ends...
    await expect(status(page)).toHaveAttribute("data-send-state", "unconfirmed", { timeout: 45_000 });
    await expect(status(page)).toContainText("We couldn’t confirm your answer");
    await page.screenshot({ path: path.join(SHOTS, "house-7-closed-unconfirmed.png") });
    await context.close();
  });

  test("house: a double tap sends one answer", async ({ browser }) => {
    const { page, context } = await phoneOnQuestion(browser, "house");
    const posts: string[] = [];
    await page.route("**/api/answers", async (route) => {
      posts.push(route.request().postData() ?? "");
      await route.continue();
    });
    const card = page.getByTestId(TID.playerQuestion.answer(1));
    await card.dblclick({ delay: 0 }).catch(() => {});
    await page.waitForTimeout(1500);
    expect(posts).toHaveLength(1);
    await expect(status(page)).toHaveAttribute("data-send-state", "locked", { timeout: 10_000 });
    await context.close();
  });
});
