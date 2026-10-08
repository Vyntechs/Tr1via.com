// phone-instant-lock.spec.ts — a tapped answer locks on the phone at once,
// says "Sending…", then "Locked in" from the send reply itself; a slow or
// failing network keeps the choice on screen and says so plainly.
//
// The network is simulated at the browser (page.route on /api/answers); the
// server, its rules and its routes are the real local ones, untouched.
// Screenshots go to PHONELOCK_SHOTS (default: the research folder) so the look
// can be judged on every theme.

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

/** Top/height of each answer card and of the status strip, to prove nothing moves. */
async function layoutOf(page: Page) {
  return page.evaluate(() => {
    const root = document.querySelector('[data-testid="player-locked"]')!;
    const cards = Array.from(root.querySelectorAll<HTMLElement>("div")).filter(
      (el) => el.style.minHeight === "64px",
    );
    const strip = document.querySelector('[data-testid="player-send-status"]')!.parentElement!;
    const r = (el: Element) => {
      const b = el.getBoundingClientRect();
      return { top: Math.round(b.top * 10) / 10, height: Math.round(b.height * 10) / 10 };
    };
    return { strip: r(strip), cards: cards.map(r) };
  });
}

test.describe("phone answer: instant lock, sending, locked in", () => {
  test.setTimeout(120_000);

  for (const themeKey of THEME_KEYS) {
    test(`${themeKey}: locks at once, Sending… then Locked in, nothing moves`, async ({ browser }) => {
      const { page, context } = await phoneOnQuestion(browser, themeKey);

      // The send reply is held for 2.5 s (a slow venue connection).
      let release!: () => void;
      const held = new Promise<void>((resolve) => (release = resolve));
      await page.route("**/api/answers", async (route) => {
        await held;
        await route.continue();
      });

      await page.evaluate(() => {
        (window as unknown as { __shifts: number }).__shifts = 0;
        new PerformanceObserver((list) => {
          for (const e of list.getEntries() as unknown as Array<{ value: number; hadRecentInput: boolean }>) {
            if (!e.hadRecentInput) (window as unknown as { __shifts: number }).__shifts += e.value;
          }
        }).observe({ type: "layout-shift", buffered: true });
      });

      const tapAt = Date.now();
      await page.getByTestId(TID.playerQuestion.answer(2)).tap();
      // Locked screen up almost immediately, long before the (held) reply.
      await expect(page.getByTestId(TID.playerLocked.root)).toBeVisible({ timeout: 800 });
      const lockedAfter = Date.now() - tapAt;
      expect(lockedAfter).toBeLessThan(800);
      await expect(status(page)).toHaveAttribute("data-send-state", "sending");
      await expect(status(page)).toContainText("Sending");
      await page.waitForTimeout(700); // let any transition finish
      await page.screenshot({ path: path.join(SHOTS, `${themeKey}-1-sending.png`) });
      const whileSending = await layoutOf(page);
      const lockedNode = await page.getByTestId(TID.playerLocked.root).elementHandle();

      release();
      await expect(status(page)).toHaveAttribute("data-send-state", "locked", { timeout: 10_000 });
      await expect(status(page)).toContainText(/locked/i);
      await page.waitForTimeout(900);
      await page.screenshot({ path: path.join(SHOTS, `${themeKey}-2-locked-in.png`) });
      const afterLocked = await layoutOf(page);

      // Same screen element all the way through, and the cards/strip did not move.
      expect(await lockedNode!.evaluate((el) => el.isConnected)).toBe(true);
      expect(afterLocked.strip.top).toBeCloseTo(whileSending.strip.top, 0);
      expect(afterLocked.cards).toEqual(whileSending.cards);
      // Strip height may differ by at most the reserved second line (none expected).
      expect(Math.abs(afterLocked.strip.height - whileSending.strip.height)).toBeLessThanOrEqual(1);
      const shifts = await page.evaluate(() => (window as unknown as { __shifts: number }).__shifts);
      expect(shifts).toBeLessThan(0.1);
      await context.close();
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

  test("house, small phone (320 wide): the longest line wraps inside the strip", async ({ browser }) => {
    const { page, context } = await phoneOnQuestion(browser, "house", { viewport: { width: 320, height: 568 } });
    await page.route("**/api/answers", (route) => route.abort("connectionfailed"));
    await page.getByTestId(TID.playerQuestion.answer(1)).tap();
    await expect(status(page)).toHaveAttribute("data-send-state", "retrying", { timeout: 5000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(SHOTS, "house-320-retrying.png") });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBe(false);
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
