// November · Harvest Field: one whole night on real screens.
//
// Host laptop 1440×900, venue TV 1920×1080, 8 phones in Chromium and 2 in
// WebKit (iPhone sizes), two games: lobby → questions → lock-ins → reveal →
// between games → game 2 → winner. A second TV in the same room has one
// turkey picture blocked (a missing strip), to prove the row falls back to
// the standing turkey and the night goes on.
//
// The rest of the suite seeds the "house" look; this spec seeds November.
// NIGHT_THEME=<key> replays the same night in another look (used to compare
// console errors against main); the November-only checks then switch off.
// NIGHT_SHOTS=<dir> saves screenshots of every surface; NIGHT_OUT=<file>
// writes the console errors and reveal counts as JSON.

import { test, expect, webkit, devices, type Browser, type BrowserContext, type Page } from "@playwright/test";
import fs from "node:fs";
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
import { joinPhone } from "./helpers/player-phone";
import { TID } from "./helpers/selectors";

const THEME = process.env.NIGHT_THEME ?? "november";
const NOV = THEME === "november";
const SHOTS = process.env.NIGHT_SHOTS;
const OUT = process.env.NIGHT_OUT;
// The settled lock-in pose: the picture a locked-in turkey shows longest.
const BLOCKED_STRIP = "**/themes/november/turkey/*/fanned-idle-256.webp";

const NAMES = ["Alex", "Brooke", "Casey", "Dana", "Eli", "Fern", "Gus", "Hana", "Ivy", "Jude"];
// Phones 9 and 10 (Ivy, Jude) are WebKit iPhones. Gus (chromium) and Jude
// (webkit) never answer game 1's first question → "no answer" at the reveal.
const SILENT_Q1 = new Set(["Gus", "Jude"]);
// Ivy sits game 2 out.
const SITS_OUT = "Ivy";

test.describe.configure({ mode: "serial" });

test.describe(`November night — host + 2 TVs + 10 phones, two games (${THEME})`, () => {
  test.setTimeout(420_000);

  let wk: Browser;
  const contexts: BrowserContext[] = [];
  const errors: Record<string, string[]> = {};

  function watch(name: string, page: Page) {
    errors[name] = [];
    page.on("pageerror", (e) => errors[name].push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() === "error") errors[name].push(m.text());
      if (m.type() === "warning" && m.text().startsWith("[theme]")) errors[name].push(`guard: ${m.text()}`);
    });
  }
  async function shot(page: Page, file: string) {
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/${file}.png` });
  }

  test.afterAll(async () => {
    try {
      const page = await contexts[0]?.newPage();
      if (page) await resetTestData(page);
    } catch {}
    await Promise.all(contexts.map((c) => c.close().catch(() => {})));
    await wk?.close().catch(() => {});
  });

  test("lobby → game 1 → between games → game 2 → winner", async ({ browser }) => {
    if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
    wk = await webkit.launch();
    const ctx = async (b: Browser, opts: Parameters<Browser["newContext"]>[0]) => {
      const c = await b.newContext(opts);
      contexts.push(c);
      return c;
    };
    const host = await ctx(browser, { viewport: { width: 1440, height: 900 } });
    const tvCtx = await ctx(browser, { viewport: { width: 1920, height: 1080 } });
    const tv2Ctx = await ctx(browser, { viewport: { width: 1920, height: 1080 } });
    let blockedHits = 0;
    await tv2Ctx.route(BLOCKED_STRIP, (route) => {
      blockedHits += 1;
      return route.abort();
    });

    const cleanup = await host.newPage();
    await resetTestData(cleanup);
    await cleanup.close();

    const hostPage = await host.newPage();
    const tv = await tvCtx.newPage();
    const tv2 = await tv2Ctx.newPage();
    watch("host", hostPage);
    watch("tv", tv);
    watch("tv-missing-strip", tv2);

    const { hostId } = await loginAsHost(hostPage, `november-${Date.now()}@tr1via.test`);
    const seed = await seedNight(hostPage, hostId, { scenario: "two-games-ready", themeKey: THEME });

    await openTV(tv, seed.roomCode);
    await openTV(tv2, seed.roomCode);
    if (NOV) {
      await expect(tv.getByTestId("november-world")).toBeVisible({ timeout: 15_000 });
      await expect(tv.getByTestId("november-world")).toHaveAttribute("data-world-pack", "november");
    }

    // ── Ten phones join ────────────────────────────────────────────────
    const phones: { name: string; page: Page }[] = [];
    for (const [i, name] of NAMES.entries()) {
      const c = i < 8
        ? await ctx(browser, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
        : await ctx(wk, i === 8 ? devices["iPhone 13"] : devices["iPhone 15 Pro Max"]);
      const page = await c.newPage();
      watch(`phone-${name}${i >= 8 ? "-webkit" : ""}`, page);
      await joinPhone(page, seed.roomCode, name);
      phones.push({ name, page });
    }
    const phone = (name: string) => phones.find((p) => p.name === name)!.page;
    if (NOV) {
      await expect(tv.getByTestId("november-world")).toHaveAttribute("data-world-turkeys", "10", { timeout: 15_000 });
      await expect(phone("Alex").getByTestId("your-turkey")).toBeVisible({ timeout: 15_000 });
    }
    await shot(tv, "tv-01-lobby");
    await shot(phone("Alex"), "phone-01-lobby-alex");
    await shot(phone("Jude"), "phone-01-lobby-jude-webkit");

    await openHostLive(hostPage, seed.nightId);
    await shot(hostPage, "host-01-console");
    await startGame(hostPage, seed.game1.id);

    const counts: Array<{ game: number; q: number; right: number; wrong: number; none: number }> = [];

    async function playQuestion(game: 1 | 2, gameId: string, qid: string, q: number, players: string[], silent: Set<string>) {
      await revealViaApi(hostPage, gameId, qid);
      await expect(phone(players[0]).getByTestId(TID.playerQuestion.root)).toBeVisible({ timeout: 10_000 });
      await expect(tv.getByTestId(TID.tvQuestion.root)).toBeVisible({ timeout: 10_000 });
      const first = game === 1 && q === 1;
      if (first) {
        await shot(tv, "tv-02-question");
        await shot(phone("Alex"), "phone-02-question-alex");
        await shot(phone("Jude"), "phone-02-question-jude-webkit");
      }
      // Spread the taps over all four slots so the reveal has right AND wrong.
      await Promise.all(
        players.filter((n) => !silent.has(n)).map(async (n, i) => {
          const p = phone(n);
          await p.getByTestId(TID.playerQuestion.answer(((i + q) % 4 + 1) as 1 | 2 | 3 | 4)).click();
          await expect(p.getByTestId(TID.playerLocked.root)).toBeVisible({ timeout: 5_000 });
        }),
      );
      if (first) {
        // Lock-ins land on the TV row: the turkeys fan (fanned-idle settles in
        // ~1 s). TV 2 has fanned-idle blocked, so its turkeys stand instead.
        await tv.waitForTimeout(2_500);
        await shot(tv, "tv-03-lockins-fanned");
        await shot(tv2, "tv2-03-lockins-blocked-strip");
        await shot(phone("Alex"), "phone-03-locked-alex");
      }
      await fastForwardTimer(hostPage, qid);
      await expect(tv.getByTestId(TID.tvReveal.root)).toBeVisible({ timeout: 10_000 });
      await expect(tv2.getByTestId(TID.tvReveal.root)).toBeVisible({ timeout: 10_000 });

      // Every phone shows the right screen for what it did.
      const snap = await (await tv.request.get(`/api/tv/${seed.roomCode}/snapshot`)).json() as {
        liveAnswers: Array<{ player_name: string; question_id: string; is_correct: boolean | null }>;
      };
      const tally = { game, q, right: 0, wrong: 0, none: 0 };
      for (const n of players) {
        const a = snap.liveAnswers.find((x) => x.player_name === n && x.question_id === qid);
        const want = a?.is_correct ? TID.playerRevealCorrect.root : TID.playerRevealWrong.root;
        if (!a) tally.none += 1;
        else if (a.is_correct) tally.right += 1;
        else tally.wrong += 1;
        await expect(phone(n).getByTestId(want), `${n} after g${game}q${q}`).toBeVisible({ timeout: 10_000 });
      }
      counts.push(tally);
      if (first) {
        await tv.waitForTimeout(2_500); // right / wrong / hide animations play out
        await shot(tv, "tv-04-reveal-moods");
        await shot(tv2, "tv2-04-reveal-blocked-strip");
        const right = snap.liveAnswers.find((x) => x.question_id === qid && x.is_correct)?.player_name;
        const wrong = snap.liveAnswers.find((x) => x.question_id === qid && x.is_correct === false)?.player_name;
        if (right) await shot(phone(right), `phone-04-reveal-right-${right}`);
        if (wrong) await shot(phone(wrong), `phone-04-reveal-wrong-${wrong}`);
        await shot(phone("Jude"), "phone-04-reveal-noanswer-jude-webkit");
      }
    }

    // ── Game 1: the first category, then the host ends it early ────────
    const g1 = seed.categories[0].question_ids;
    for (const [i, qid] of g1.entries()) {
      await playQuestion(1, seed.game1.id, qid, i + 1, NAMES, i === 0 ? SILENT_Q1 : new Set());
    }
    const q1 = counts[0];
    expect(q1.none, "two phones stayed silent on Q1").toBe(2);
    expect(q1.right + q1.wrong).toBe(8);
    expect(counts.some((c) => c.right > 0) && counts.some((c) => c.wrong > 0)).toBe(true);
    await shot(tv, "tv-05-board-after-game1");

    await endGame(hostPage, seed.game1.id);
    await expect(tv.getByTestId(TID.tvIntermission.root)).toBeVisible({ timeout: 15_000 });
    await expect(tv2.getByTestId(TID.tvIntermission.root)).toBeVisible({ timeout: 15_000 });
    for (const { page } of phones) {
      await expect(page.getByTestId(TID.playerJoinGame2.root)).toBeVisible({ timeout: 15_000 });
    }
    await shot(tv, "tv-06-between-games");
    await shot(phone("Alex"), "phone-06-join-game2-alex");

    const g2Players = NAMES.filter((n) => n !== SITS_OUT);
    for (const n of g2Players) await phone(n).getByTestId(TID.playerJoinGame2.submit).click();
    for (const n of g2Players) {
      await expect(phone(n).getByTestId(TID.playerBetweenGames.root)).toBeVisible({ timeout: 15_000 });
    }
    if (NOV) await expect(phone("Alex").getByTestId("november-halftime-pie")).toBeVisible();
    await shot(phone("Alex"), "phone-07-between-games-alex");
    await shot(phone("Jude"), "phone-07-between-games-jude-webkit");

    // ── Game 2: four questions, then present winners ───────────────────
    await startGame(hostPage, seed.game2.id);
    const g2 = seed.game2Categories[0].question_ids.slice(0, 4);
    for (const [i, qid] of g2.entries()) {
      await playQuestion(2, seed.game2.id, qid, i + 1, g2Players, new Set());
    }
    await expect(phone(SITS_OUT).getByTestId(TID.playerJoinGame2.root)).toBeVisible();

    await endGame(hostPage, seed.game2.id);
    await expect(tv.getByTestId(TID.tvFinaleWinner.root)).toBeVisible({ timeout: 15_000 });
    await expect(tv2.getByTestId(TID.tvFinaleWinner.root)).toBeVisible({ timeout: 15_000 });
    for (const n of g2Players) {
      await expect(phone(n).getByTestId("player-finale")).toBeVisible({ timeout: 15_000 });
    }
    await tv.waitForTimeout(2_000);
    await shot(tv, "tv-08-winner");
    await shot(phone("Alex"), "phone-08-finale-alex");
    await shot(phone("Jude"), "phone-08-finale-jude-webkit");
    await shot(hostPage, "host-08-finale");

    // The TV with the blocked strip never switched its world off.
    if (NOV) {
      expect(blockedHits, "the blocked strip was really requested").toBeGreaterThan(0);
      await expect(tv2.getByTestId("november-world")).not.toHaveAttribute("data-world-off", "true");
    }
    if (OUT) fs.writeFileSync(OUT, JSON.stringify({ theme: THEME, blockedHits, counts, errors }, null, 2));
    const guards = Object.entries(errors).flatMap(([k, v]) => v.filter((e) => e.startsWith("guard") || e.startsWith("pageerror")).map((e) => `${k}: ${e}`));
    expect(guards).toEqual([]);
  });
});
