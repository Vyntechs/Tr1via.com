import { expect, test, type Locator } from "@playwright/test";

const PHONE_VIEWPORTS = [
  { width: 375, height: 667 },
  { width: 390, height: 844 },
] as const;
const QUESTION_VARIANTS = [
  "short",
  "long",
  "image",
  "long-image",
  "long-category",
] as const;

async function expectLampInClearBand(
  lamp: Locator,
  bannerBottom: number,
  contentTop: number,
) {
  const box = await lamp.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.y).toBeGreaterThanOrEqual(bannerBottom - 0.5);
  expect(box!.y + box!.height).toBeLessThanOrEqual(contentTop + 0.5);
  expect(box!.width / box!.height).toBeCloseTo(104 / 58, 2);
}

test("September phone questions keep both proportional lamp heads in a clear band below the category banner", async ({
  page,
}) => {
  for (const viewport of PHONE_VIEWPORTS) {
    for (const variant of QUESTION_VARIANTS) {
      await page.setViewportSize(viewport);
      await page.goto(`/dev/player/preview?theme=september&variant=${variant}`);

      const question = page.getByTestId("player-question");
      const content = question.locator(":scope > div").last();
      const banner = content.locator(":scope > div").first();
      const bannerBox = await banner.boundingBox();
      expect(bannerBox).not.toBeNull();

      await expect
        .poll(async () =>
          page.getByTestId("player-question-prompt").evaluate((element) => {
            const frame = element.parentElement;
            return element.scrollHeight <= (frame?.clientHeight ?? 0) + 1;
          }),
        )
        .toBe(true);

      const promptBox = await page.getByTestId("player-question-prompt").boundingBox();
      expect(promptBox).not.toBeNull();

      const lamps = page.getByTestId("september-stadium-lamp-head");
      const lampCount = await lamps.count();
      if (lampCount === 2) {
        await expectLampInClearBand(
          lamps.nth(0),
          bannerBox!.y + bannerBox!.height,
          promptBox!.y,
        );
        await expectLampInClearBand(
          lamps.nth(1),
          bannerBox!.y + bannerBox!.height,
          promptBox!.y,
        );
      } else {
        expect(lampCount).toBe(0);
        const decorationLevel = await question.evaluate((element) =>
          Number.parseInt(
            getComputedStyle(element).getPropertyValue("--player-question-decoration-level"),
            10,
          ),
        );
        expect(decorationLevel).toBeGreaterThanOrEqual(2);
      }

      const promptMetrics = await page.getByTestId("player-question-prompt").evaluate((element) => {
        const style = getComputedStyle(element);
        const frame = element.parentElement;
        return {
          frameHeight: frame?.clientHeight ?? 0,
          scrollHeight: element.scrollHeight,
          fontSize: Number.parseFloat(style.fontSize),
        };
      });
      expect(promptMetrics.fontSize).toBeGreaterThanOrEqual(16);
      expect(promptMetrics.scrollHeight).toBeLessThanOrEqual(promptMetrics.frameHeight + 1);

      for (let slot = 1; slot <= 4; slot += 1) {
        await expect(page.getByTestId(`player-answer-${slot}`)).toBeInViewport();
      }
    }
  }
});

test("September positions quiet lamps from the real banner height in question and locked states", async ({
  page,
}) => {
  for (const viewport of PHONE_VIEWPORTS) {
    for (const state of ["question", "locked"] as const) {
      await page.setViewportSize(viewport);
      await page.goto(
        `/dev/player/preview?theme=september&variant=long-category&state=${state}`,
      );

      const surface = page.getByTestId(state === "question" ? "player-question" : "player-locked");
      const content = surface.locator(":scope > div").last();
      const banner = content.locator(":scope > div").first();
      const bannerBox = await banner.boundingBox();
      expect(bannerBox).not.toBeNull();

      const lamps = surface.getByTestId("september-stadium-lamp-head");
      await expect(lamps).toHaveCount(2);
      for (const lamp of [lamps.nth(0), lamps.nth(1)]) {
        const box = await lamp.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.y).toBeGreaterThanOrEqual(bannerBox!.y + bannerBox!.height - 0.5);
        expect(box!.width / box!.height).toBeCloseTo(104 / 58, 2);
      }
    }
  }
});

test("September quiet phone states retain their static identity with reduced motion", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const viewport of PHONE_VIEWPORTS) {
    await page.setViewportSize(viewport);
    await page.goto("/dev/player/preview?theme=september&variant=long-image");
    await expect
      .poll(async () =>
        page.getByTestId("player-question-prompt").evaluate((element) =>
          element.scrollHeight <= (element.parentElement?.clientHeight ?? 0) + 1,
        ),
      )
      .toBe(true);
    await expect(page.getByTestId("september-homecoming-drift")).toHaveAttribute(
      "data-motion",
      "static",
    );
    await expect(page.getByTestId("september-homecoming-leaf").first()).toBeAttached();
    await expect(page.getByTestId("player-question-prompt")).toBeInViewport();
  }
});

test("September restores decorations when the same mounted question gains space", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto("/dev/player/preview?theme=september&variant=long-image");

  const question = page.getByTestId("player-question");
  await expect
    .poll(() => question.getByTestId("september-stadium-lamp-head").count())
    .toBe(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => question.getByTestId("september-stadium-lamp-head").count())
    .toBe(2);
  await expect(question.getByTestId("player-question-image")).toBeVisible();
  await expect
    .poll(() =>
      question.evaluate((element) =>
        Number.parseInt(
          getComputedStyle(element).getPropertyValue("--player-question-decoration-level"),
          10,
        ),
      ),
    )
    .toBe(0);
});

test("September remains quiet after the player locks in", async ({ page }) => {
  await page.goto("/dev/player");
  await page.locator("select").selectOption("september");

  const locked = page.locator('[data-player-preview-frame="locked"]');
  await expect(locked.getByTestId("september-front")).toHaveAttribute(
    "data-atmosphere",
    "quiet",
  );
  await expect(locked.getByTestId("september-stadium-lamp-head")).toHaveCount(2);
  await expect(locked.getByTestId("september-stadium-goal-post")).toHaveCount(0);
  await expect(locked.getByTestId("september-stadium-bleachers")).toHaveCount(0);
  await expect(locked.getByTestId("september-homecoming-pennants")).toHaveCount(0);
});
