import { expect, test, type Locator, type Page } from "@playwright/test";
import { loginAsHost, resetTestData, seedNight } from "./helpers/host-laptop";

const VIEWPORTS = [
  { name: "small phone", width: 320, height: 568, previewAlwaysVisible: false },
  { name: "large phone", width: 430, height: 932, previewAlwaysVisible: false },
  { name: "landscape phone", width: 844, height: 390, previewAlwaysVisible: true },
  { name: "tablet portrait", width: 768, height: 1024, previewAlwaysVisible: false },
] as const;

async function expectInitiallyInViewport(page: Page, locator: Locator) {
  const box = await locator.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(-0.5);
  expect(box!.y).toBeGreaterThanOrEqual(-0.5);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width + 0.5);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height + 0.5);
}

async function expectNoPeerOverlap(
  targets: Array<{ name: string; locator: Locator }>,
) {
  const visible = [] as Array<{
    name: string;
    box: NonNullable<Awaited<ReturnType<Locator["boundingBox"]>>>;
  }>;
  for (const target of targets) {
    if (!(await target.locator.isVisible())) continue;
    const box = await target.locator.boundingBox();
    expect(box, `${target.name} should have a layout box`).not.toBeNull();
    visible.push({ name: target.name, box: box! });
  }
  for (let first = 0; first < visible.length; first += 1) {
    for (let second = first + 1; second < visible.length; second += 1) {
      const a = visible[first]!;
      const b = visible[second]!;
      const overlapWidth = Math.min(a.box.x + a.box.width, b.box.x + b.box.width) -
        Math.max(a.box.x, b.box.x);
      const overlapHeight = Math.min(a.box.y + a.box.height, b.box.y + b.box.height) -
        Math.max(a.box.y, b.box.y);
      expect(
        overlapWidth > 0.5 && overlapHeight > 0.5,
        `${a.name} and ${b.name} must not overlap`,
      ).toBe(false);
    }
  }
}

test("host command center keeps the game action and exact venue picture usable on every approved screen", async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  const email = `command-center-${Date.now()}@tr1via.test`;
  const { hostId } = await loginAsHost(page, email, "Command Center Host");
  const seed = await seedNight(page, hostId, "two-games-ready");

  try {
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport);
      await page.goto(`/host/live/${seed.nightId}`);

      const shell = page.locator("main[data-stage]");
      const nav = page.getByRole("navigation", { name: "Host controls" });
      const primary = page.getByRole("button", { name: "Start Game 1" });
      const preview = page.getByRole("region", { name: "Venue TV preview" });

      await expect(shell).toBeVisible({ timeout: 30_000 });
      await expect(nav).toBeVisible();
      await expect(primary).toBeVisible();
      await expectInitiallyInViewport(page, primary);
      await expectInitiallyInViewport(page, nav);
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
        .toBe(true);

      if (!viewport.previewAlwaysVisible) {
        await expect(preview).not.toBeVisible();
        await page.getByRole("button", { name: "TV preview" }).click();
      }

      await expect(preview).toBeVisible();
      await expectInitiallyInViewport(page, preview);
      await expect(page.getByTestId("venue-tv-preview-canvas")).toBeAttached();
      await expect(page.getByTestId("venue-tv-preview-canvas")).toHaveCSS("width", "1600px");
      await expect(page.getByTestId("venue-tv-preview-canvas")).toHaveCSS("height", "900px");
      await expect(page.locator('a[href^="/tv/"]')).toHaveCount(0);
      await expect(page.getByTestId("tv-lobby")).toBeAttached();
      const frame = page.getByTestId("venue-tv-preview-frame");
      const frameBox = await frame.boundingBox();
      expect(frameBox).not.toBeNull();
      expect(frameBox!.width / frameBox!.height).toBeCloseTo(16 / 9, 1);

      if (viewport.previewAlwaysVisible) {
        await expect(primary).toBeVisible();
        await expectInitiallyInViewport(page, primary);
      }
      await expectNoPeerOverlap([
        { name: "primary game action", locator: primary },
        { name: "venue preview", locator: preview },
        { name: "host navigation", locator: nav },
      ]);

      await page.screenshot({
        path: testInfo.outputPath(`${viewport.width}x${viewport.height}.png`),
      });
    }
  } finally {
    await resetTestData(page).catch(() => {});
  }
});
