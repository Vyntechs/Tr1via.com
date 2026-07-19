import { expect, test, type Page } from "@playwright/test";

const VIEWPORTS = [
  { name: "320x568", width: 320, height: 568 },
  { name: "360x800", width: 360, height: 800 },
  { name: "390x844", width: 390, height: 844 },
  { name: "440x956", width: 440, height: 956 },
  { name: "844x390-landscape", width: 844, height: 390 },
] as const;

const SURFACES = [
  ["overview", "host-gen-overview-layout"],
  ["topic", "host-gen-topic-layout"],
  ["loading", "host-gen-loading-layout"],
  ["pick", "host-gen-pick-layout"],
  ["edit", "host-gen-edit-layout"],
  ["image-swap", "host-gen-image-swap-layout"],
  ["image-upload", "host-gen-image-upload-layout"],
  ["manual", "host-gen-manual-layout"],
] as const;

async function expectNoHorizontalOverflow(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    )
    .toBe(true);
}

async function expectFullyInViewport(page: Page, selector: string) {
  const locator = page.locator(selector);
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  expect(box, `${selector} should have a layout box`).not.toBeNull();
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width + 0.5);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height + 0.5);
}

test("all production prep components fit every approved phone viewport", async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    for (const [surface, testId] of SURFACES) {
      await page.goto(`/dev/host/mobile?surface=${surface}`);
      await expect(page.getByTestId(testId)).toHaveAttribute(
        "data-layout",
        "mobile",
      );
      await expectNoHorizontalOverflow(page);

      const undersized = await page
        .locator(
          '[data-mobile-touch-target="true"]:visible',
        )
        .evaluateAll((elements) =>
          elements
            .map((element) => {
              const rect = element.getBoundingClientRect();
              return {
                label:
                  element.getAttribute("aria-label") ??
                  element.textContent?.trim(),
                width: rect.width,
                height: rect.height,
              };
            })
            .filter(({ width, height }) => width < 43.5 || height < 43.5),
        );
      expect(undersized).toEqual([]);

      const essential = page.locator('[data-mobile-touch-target="true"]:visible');
      for (let index = 0; index < (await essential.count()); index += 1) {
        await expectFullyInViewport(
          page,
          `[data-mobile-touch-target="true"]:visible >> nth=${index}`,
        );
      }

      if (surface === "pick" && viewport.name === "320x568") {
        const selectors = [
          '[data-testid="pick-sidebar-drag-100"]',
          '[data-testid="pick-sidebar-edit-100"]',
          '[data-testid="pick-sidebar-unpick-100"]',
        ];
        for (const selector of selectors) await expectFullyInViewport(page, selector);
        const boxes = await Promise.all(
          selectors.map((selector) => page.locator(selector).boundingBox()),
        );
        for (let left = 0; left < boxes.length; left += 1) {
          for (let right = left + 1; right < boxes.length; right += 1) {
            const a = boxes[left]!;
            const b = boxes[right]!;
            const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
            const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
            expect(overlapX <= 0 || overlapY <= 0).toBe(true);
          }
        }
      }

      if (
        viewport.name === "390x844" ||
        viewport.name === "844x390-landscape"
      ) {
        // Let the production staggered entrance finish so the proof image
        // captures every row rather than an in-between animation frame.
        await page.waitForTimeout(500);
        await page.screenshot({
          path: testInfo.outputPath(`${surface}-${viewport.name}.png`),
          fullPage: true,
        });
      }
    }
  }
});
