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
          '[data-host-mobile-surface="true"] button:visible, [data-host-mobile-surface="true"] a[role="button"]:visible',
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
