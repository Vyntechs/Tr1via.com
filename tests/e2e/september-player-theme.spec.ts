import { expect, test, type Locator } from "@playwright/test";

const PHONE_VIEWPORTS = [
  { width: 375, height: 667 },
  { width: 390, height: 844 },
] as const;
const QUESTION_VARIANTS = ["short", "long", "image"] as const;

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
      const promptBox = await page.getByTestId("player-question-prompt").boundingBox();
      expect(promptBox).not.toBeNull();

      const lamps = page.getByTestId("september-stadium-lamp-head");
      await expect(lamps).toHaveCount(2);
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
    }
  }
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
