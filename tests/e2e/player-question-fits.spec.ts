// Every answer must be tappable on every phone. No exceptions, no "usually".
//
// Origin: 2026-08-05, mid-show. A player on a small Android was shown a
// question and could tap none of the four answers — they had run off the
// bottom of a screen that deliberately locks scrolling, so they were
// untappable rather than merely below the fold. The host awarded the points
// by hand while the room waited.
//
// This drives the real player route on real viewports and asks the only
// question that matters: can a thumb land on all four cards. "Visible" is not
// enough — a card can have a layout box that sits off-screen, and a card can
// be inside the viewport with something painted over it. So each answer must
// satisfy BOTH: its box is fully inside the viewport, and elementFromPoint at
// its centre returns that card. That is what a thumb does.
//
// The prompt is deliberately long. A short question fits anywhere; the defect
// only appears when the question pushes the cards down, which is exactly what
// the host reported.

import { expect, test, type Page } from "@playwright/test";
import { loginAsHost, seedNight, resetTestData, startGame, revealViaApi } from "./helpers/host-laptop";
import { joinPhone } from "./helpers/player-phone";

/** Real devices, including the two that failed in the room. The "large
 *  display size" rows are Android's accessibility scaling, which shrinks the
 *  CSS viewport — the setting the affected player was running. */
const PHONES = [
  { name: "small Android", width: 360, height: 560 },
  { name: "small Android · large display size", width: 277, height: 431 },
  { name: "iPhone SE", width: 320, height: 568 },
  { name: "Pixel", width: 393, height: 640 },
  { name: "iPhone 14", width: 390, height: 750 },
  { name: "iPhone 15 Pro Max", width: 430, height: 932 },
] as const;

const LONG_PROMPT =
  "In the road trip game 'Cows on My Side,' what happens when you pass a " +
  "cemetery on your side of the car, according to the most commonly played " +
  "version of the rules that families have used on long drives for decades?";

/** Can a thumb actually land on this card? Box fully on screen AND the card
 *  is what hit-testing returns at its centre. */
async function isTappable(page: Page, testId: string): Promise<{ ok: boolean; why: string }> {
  const el = page.getByTestId(testId);
  const box = await el.boundingBox();
  if (!box) return { ok: false, why: "no layout box" };
  const vp = page.viewportSize();
  if (!vp) return { ok: false, why: "no viewport" };

  const bottom = box.y + box.height;
  if (box.y < -0.5 || bottom > vp.height + 0.5) {
    return { ok: false, why: `off-screen: ${Math.round(box.y)}..${Math.round(bottom)} in ${vp.height}px` };
  }

  const hit = await page.evaluate(
    ([x, y, id]) => {
      const el = document.elementFromPoint(x as number, y as number);
      return !!(el && el.closest(`[data-testid="${id}"]`));
    },
    [box.x + box.width / 2, box.y + box.height / 2, testId] as const,
  );
  return hit ? { ok: true, why: "" } : { ok: false, why: "covered by something else" };
}

test.describe("player question — every answer is reachable on every phone", () => {
  test("four tappable answers on a long question, at every real viewport", async ({ browser }, testInfo) => {
    test.setTimeout(240_000);

    const hostCtx = await browser.newContext();
    const host = await hostCtx.newPage();
    const email = `answers-fit-${Date.now()}@tr1via.test`;

    try {
      const { hostId } = await loginAsHost(host, email, "Answers Fit Host");
      const seed = await seedNight(host, hostId, "happy-path-3-cats-game1");
      const questionId = seed.categories[0]!.question_ids[0]!;

      // Force the worst realistic case: the longest question a host would
      // actually read out. The defect is invisible on a short prompt.
      const patched = await host.request.patch(`/api/questions/${questionId}`, {
        data: { prompt: LONG_PROMPT },
      });
      expect(patched.ok(), `could not lengthen the prompt: ${patched.status()}`).toBe(true);

      // Every phone joins the lobby FIRST, exactly as a real room does, then
      // the host starts and reveals once and all six watch the same question
      // arrive. Joining after the reveal would land on a different screen and
      // prove nothing about the moment that actually broke.
      const phones = [];
      for (const phone of PHONES) {
        const ctx = await browser.newContext({
          viewport: { width: phone.width, height: phone.height },
          isMobile: true,
          hasTouch: true,
          deviceScaleFactor: 2,
        });
        const page = await ctx.newPage();
        await joinPhone(page, seed.roomCode, `Fit${phone.width}x${phone.height}`);
        phones.push({ phone, ctx, page });
      }

      try {
        await startGame(host, seed.game1.id);
        await revealViaApi(host, seed.game1.id, questionId);

        const failures: string[] = [];

        for (const { phone, page } of phones) {
          const label = `${phone.name} (${phone.width}x${phone.height})`;
          await expect(page.getByTestId("player-question")).toBeVisible({ timeout: 30_000 });
          await expect(page.getByTestId("player-question-prompt")).toContainText("Cows on My Side");

          for (const slot of [1, 2, 3, 4]) {
            const { ok, why } = await isTappable(page, `player-answer-${slot}`);
            if (!ok) failures.push(`${label} answer ${slot}: ${why}`);
          }

          await page.screenshot({ path: testInfo.outputPath(`${phone.width}x${phone.height}.png`) });

          // The proof that matters: actually tap the LAST card — the one that
          // fell off the bottom — and confirm the phone locks in.
          await page.getByTestId("player-answer-4").click();
          await expect(page.getByTestId("player-locked"), `${label} could not lock in on answer 4`)
            .toBeVisible({ timeout: 5_000 });
        }

        expect(failures, `unreachable answers:\n  ${failures.join("\n  ")}`).toEqual([]);
      } finally {
        for (const { ctx } of phones) await ctx.close().catch(() => {});
      }
    } finally {
      await resetTestData(host).catch(() => {});
      await hostCtx.close();
    }
  });
});
