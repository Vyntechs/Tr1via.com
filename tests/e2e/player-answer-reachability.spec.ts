// Regression coverage for issue #171 — "Android player cannot reach the 4th
// answer". At Heather's 2026-07-29 show a player on a short Android phone had
// the bottom answer card sitting below the fold with no way to scroll to it:
// the question screen was `overflow: hidden`, so the content existed but no
// gesture could bring it into view. That player could not answer at all.
//
// The symptom this pins is deliberately the on-screen one: answer 4 must end
// up FULLY inside the viewport after the gesture a real player would make.
// It is not pinned to `overflow-y: auto` — any future layout that keeps all
// four cards reachable is free to pass.
//
// The harness is /dev/player/preview, which renders PlayerQuestion against
// the real browser viewport (no gallery frame), with the worst-case 163-char
// prompt and answer options long enough to wrap to three lines.

import { expect, test, type Page } from "@playwright/test";

const PREVIEW = "/dev/player/preview?variant=long&options=long";

// Short viewports that put the 4th card under the fold. 360×560 is a 360×640
// Android with the browser toolbar + system nav bar taken out; 360×480 is the
// harsher case where the card starts entirely off-screen.
const SHORT_VIEWPORTS = [
  { name: "360x560 android with browser + nav chrome", width: 360, height: 560 },
  { name: "360x480 very short phone", width: 360, height: 480 },
] as const;

async function card4Geometry(page: Page) {
  return page.evaluate(() => {
    const el = document.querySelector('[data-testid="player-answer-4"]');
    if (!el) throw new Error("answer 4 is not in the DOM");
    const r = el.getBoundingClientRect();
    return {
      top: r.top,
      bottom: r.bottom,
      viewportHeight: window.innerHeight,
      fullyVisible: r.top >= -0.5 && r.bottom <= window.innerHeight + 0.5,
    };
  });
}

/** The gesture a player actually makes: swipe/scroll up on the screen. */
async function playerScrollsDown(page: Page) {
  const size = page.viewportSize()!;
  await page.mouse.move(size.width / 2, size.height / 2);
  await page.mouse.wheel(0, 800);
  await page.waitForTimeout(400);
}

test.describe("player question — every answer stays reachable (#171)", () => {
  for (const viewport of SHORT_VIEWPORTS) {
    test(`answer 4 is reachable on ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(PREVIEW);
      await expect(page.getByTestId("player-answer-4")).toBeAttached();
      // Let useAutoFitText settle so geometry is final.
      await page.waitForTimeout(600);

      const before = await card4Geometry(page);
      if (!before.fullyVisible) {
        // This is the #171 shape — the card starts below the fold. The bug
        // was that nothing could bring it back.
        await playerScrollsDown(page);
      }

      const after = await card4Geometry(page);
      expect(
        after.fullyVisible,
        `answer 4 must be fully on screen after a player scroll — got top=${after.top} bottom=${after.bottom} viewport=${after.viewportHeight}`,
      ).toBe(true);

      // Reachable means tappable, not merely painted.
      await expect(page.getByTestId("player-answer-4")).toBeInViewport({ ratio: 1 });
    });
  }

  test("a phone with room to spare still does not scroll", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(PREVIEW);
    await expect(page.getByTestId("player-answer-4")).toBeAttached();
    await page.waitForTimeout(600);

    // All four cards fit, so the deliberate no-scroll feel is preserved:
    // there is simply nothing to scroll.
    const overflow = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="player-question"]')!;
      return { scrollHeight: el.scrollHeight, clientHeight: el.clientHeight };
    });
    expect(overflow.scrollHeight).toBeLessThanOrEqual(overflow.clientHeight + 1);
    await expect(page.getByTestId("player-answer-4")).toBeInViewport({ ratio: 1 });
  });
});
