import { expect, test, type Locator, type Page } from "@playwright/test";

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

const INTERACTIVE_SELECTOR = [
  "button:visible",
  "a[href]:visible",
  'input:not([type="hidden"]):visible',
  "select:visible",
  "textarea:visible",
  '[role="button"]:visible',
].join(", ");

async function expectNoHorizontalOverflow(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth + 1,
      ),
    )
    .toBe(true);
}

async function expectPickCardGeometry(root: Locator, viewportWidth: number) {
  const cardPickActions = root.locator(
    'button[aria-label="Pick question"], button[aria-label="Unpick question"]',
  );
  expect(await cardPickActions.count()).toBe(10);
  const cardRects = await cardPickActions.evaluateAll((buttons) =>
    buttons.map((button) => {
      const card = button.parentElement?.parentElement;
      if (!card) throw new Error("Question card wrapper is missing");
      const rect = card.getBoundingClientRect();
      return { left: rect.left, right: rect.right, width: rect.width };
    }),
  );
  for (const rect of cardRects) {
    expect(rect.left).toBeGreaterThanOrEqual(0);
    expect(rect.right).toBeLessThanOrEqual(viewportWidth + 0.5);
    expect(rect.width).toBeGreaterThanOrEqual(viewportWidth - 48);
  }
}

async function expectFullyInViewport(page: Page, target: string | Locator) {
  const locator = typeof target === "string" ? page.locator(target) : target;
  const label = typeof target === "string" ? target : await target.getAttribute("data-testid") ?? await target.getAttribute("aria-label") ?? "interactive control";
  await locator.evaluate((element) =>
    element.scrollIntoView({ block: "center", inline: "nearest" }),
  );
  const box = await locator.boundingBox();
  expect(box, `${label} should have a layout box`).not.toBeNull();
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  expect(box!.x, `${label} left edge`).toBeGreaterThanOrEqual(0);
  expect(box!.y, `${label} top edge`).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width, `${label} right edge`).toBeLessThanOrEqual(viewport!.width + 0.5);
  expect(box!.y + box!.height, `${label} bottom edge`).toBeLessThanOrEqual(viewport!.height + 0.5);
}

async function expectAccessibleHitTarget(page: Page, target: string | Locator) {
  const locator = typeof target === "string" ? page.locator(target) : target;
  const label = typeof target === "string" ? target : await target.getAttribute("data-testid") ?? await target.getAttribute("aria-label") ?? "interactive control";
  await expectFullyInViewport(page, locator);
  const box = await locator.boundingBox();
  expect(box!.width, `${label} should be at least 44px wide`).toBeGreaterThanOrEqual(43.5);
  expect(box!.height, `${label} should be at least 44px tall`).toBeGreaterThanOrEqual(43.5);
}

async function expectNoPeerInteractiveOverlap(root: Locator) {
  const overlaps = await root.locator(INTERACTIVE_SELECTOR).evaluateAll((elements) => {
    const label = (element: Element) =>
      element.getAttribute("aria-label") ??
      element.getAttribute("data-testid") ??
      element.textContent?.trim() ??
      element.tagName.toLowerCase();
    const found: Array<{
      first: string;
      second: string;
      overlapWidth: number;
      overlapHeight: number;
    }> = [];

    for (let first = 0; first < elements.length; first += 1) {
      for (let second = first + 1; second < elements.length; second += 1) {
        const a = elements[first]!;
        const b = elements[second]!;
        // Nested semantic controls can intentionally share a wrapper hit area;
        // peer controls may never collide.
        if (a.contains(b) || b.contains(a)) continue;
        const aRect = a.getBoundingClientRect();
        const bRect = b.getBoundingClientRect();
        const overlapWidth =
          Math.min(aRect.right, bRect.right) - Math.max(aRect.left, bRect.left);
        const overlapHeight =
          Math.min(aRect.bottom, bRect.bottom) - Math.max(aRect.top, bRect.top);
        if (overlapWidth > 0.5 && overlapHeight > 0.5) {
          found.push({
            first: label(a),
            second: label(b),
            overlapWidth,
            overlapHeight,
          });
        }
      }
    }
    return found;
  });
  expect(overlaps).toEqual([]);
}

async function expectNoLocatorOverlap(
  targets: Array<{ label: string; locator: Locator }>,
) {
  const boxes = await Promise.all(
    targets.map(async ({ label, locator }) => ({
      label,
      box: await locator.boundingBox(),
    })),
  );
  const overlaps: Array<{
    first: string;
    second: string;
    overlapWidth: number;
    overlapHeight: number;
  }> = [];
  for (let first = 0; first < boxes.length; first += 1) {
    for (let second = first + 1; second < boxes.length; second += 1) {
      const a = boxes[first]!;
      const b = boxes[second]!;
      expect(a.box, `${a.label} should have a layout box`).not.toBeNull();
      expect(b.box, `${b.label} should have a layout box`).not.toBeNull();
      const overlapWidth =
        Math.min(a.box!.x + a.box!.width, b.box!.x + b.box!.width) -
        Math.max(a.box!.x, b.box!.x);
      const overlapHeight =
        Math.min(a.box!.y + a.box!.height, b.box!.y + b.box!.height) -
        Math.max(a.box!.y, b.box!.y);
      if (overlapWidth > 0.5 && overlapHeight > 0.5) {
        overlaps.push({
          first: a.label,
          second: b.label,
          overlapWidth,
          overlapHeight,
        });
      }
    }
  }
  expect(overlaps).toEqual([]);
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
      await page.waitForTimeout(500);

      const surfaceRoot = page.locator("main").filter({
        has: page.getByTestId(testId),
      });
      await expect(surfaceRoot).toHaveCount(1);
      const undersized = await surfaceRoot
        .locator(INTERACTIVE_SELECTOR)
        .evaluateAll((elements) =>
          elements
            .map((element) => {
              const rect = element.getBoundingClientRect();
              return {
                label:
                  element.getAttribute("aria-label") ??
                  element.textContent?.trim(),
                testId: element.getAttribute("data-testid"),
                tag: element.tagName.toLowerCase(),
                width: rect.width,
                height: rect.height,
              };
            })
            .filter(({ width, height }) => width < 43.5 || height < 43.5),
        );
      expect(undersized).toEqual([]);

      const interactive = surfaceRoot.locator(INTERACTIVE_SELECTOR);
      const initialOutOfBounds = await interactive.evaluateAll((elements) =>
        elements
          .map((element) => {
            const rect = element.getBoundingClientRect();
            return {
              label:
                element.getAttribute("aria-label") ??
                element.getAttribute("data-testid") ??
                element.textContent?.trim(),
              left: rect.left,
              right: rect.right,
              viewportWidth: window.innerWidth,
            };
          })
          .filter(
            ({ left, right, viewportWidth }) =>
              left < -0.5 || right > viewportWidth + 0.5,
          ),
      );
      expect(initialOutOfBounds).toEqual([]);
      await expectNoPeerInteractiveOverlap(surfaceRoot);
      if (
        surface === "pick" &&
        (viewport.name === "320x568" || viewport.name === "440x956")
      ) {
        await expectPickCardGeometry(surfaceRoot, viewport.width);
      }

      const discoveredLabels = await interactive.evaluateAll((elements) =>
        elements.map(
          (element) =>
            element.getAttribute("aria-label") ??
            element.getAttribute("data-testid") ??
            element.textContent?.trim() ??
            element.tagName.toLowerCase(),
        ),
      );
      if (surface === "pick") {
        expect.soft(discoveredLabels).toEqual(
          expect.arrayContaining([
            "Rename category",
            "easy",
            "normal",
            "hard",
            "↻ Another 20",
          ]),
        );
      }
      if (surface === "manual") {
        expect.soft(discoveredLabels).toEqual(
          expect.arrayContaining([
            "Question prompt for row 1",
            "Row 1 option 1",
            "Cancel",
          ]),
        );
        expect.soft(
          discoveredLabels.some((label) => label.includes("Lock the category")),
        ).toBe(true);
      }
      for (let index = 0; index < (await interactive.count()); index += 1) {
        await expectAccessibleHitTarget(
          page,
          interactive.nth(index),
        );
      }
      await expectNoPeerInteractiveOverlap(surfaceRoot);
      if (surface === "pick") {
        const selectors = [
          '[data-testid="pick-sidebar-drag-100"]',
          '[data-testid="pick-sidebar-edit-100"]',
          '[data-testid="pick-sidebar-unpick-100"]',
          'button[aria-label="Unpick question"] >> nth=0',
          'button:has-text("Edit") >> nth=0',
          'button:has-text("Image") >> nth=0',
        ];
        for (const selector of selectors) await expectAccessibleHitTarget(page, selector);

        await page.getByTestId("host-category-rename-btn").click();
        for (const selector of [
          '[data-testid="host-category-rename-input"]',
          '[data-testid="host-category-rename-save"]',
          '[data-testid="host-category-rename-cancel"]',
        ]) {
          await expectAccessibleHitTarget(page, selector);
        }
        await page.getByTestId("host-category-rename-cancel").click();

        if (
          viewport.name === "320x568" ||
          viewport.name === "440x956"
        ) {
          await expectPickCardGeometry(surfaceRoot, viewport.width);
        }

        if (viewport.name === "320x568") {
          const metadata = page.getByText(
            "PIXAR MOVIES · 10 PULLED · PHOTOS MATCHED",
            { exact: true },
          );
          const title = page.getByText("Pick your seven.", { exact: true });
          await expectFullyInViewport(page, metadata);
          await expectFullyInViewport(page, title);
          for (const name of [
            "Rename category",
            "Sharper",
            "More obscure",
            "More pop",
            "More local",
            "Fresher",
          ]) {
            await expectAccessibleHitTarget(
              page,
              page.getByRole("button", { name, exact: true }),
            );
          }
          await metadata.evaluate((element) =>
            element.scrollIntoView({ block: "start", inline: "nearest" }),
          );
          await expectNoLocatorOverlap([
            { label: "pick metadata", locator: metadata },
            { label: "pick title", locator: title },
            {
              label: "rename category",
              locator: page.getByRole("button", {
                name: "Rename category",
                exact: true,
              }),
            },
            ...[
              "Sharper",
              "More obscure",
              "More pop",
              "More local",
              "Fresher",
            ].map((name) => ({
              label: name,
              locator: page.getByRole("button", { name, exact: true }),
            })),
          ]);

          const cardActions = surfaceRoot.locator(
            'button[aria-label="Pick question"], button[aria-label="Unpick question"], button:has-text("Edit"), button:has-text("Image")',
          );
          expect(await cardActions.count()).toBe(30);
          for (let index = 0; index < (await cardActions.count()); index += 1) {
            await expectAccessibleHitTarget(page, cardActions.nth(index));
          }

          const boxes = await Promise.all(
            selectors.slice(0, 3).map((selector) => page.locator(selector).boundingBox()),
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
      }

      await expectNoHorizontalOverflow(page);

      if (
        viewport.name === "320x568" ||
        viewport.name === "390x844" ||
        viewport.name === "440x956" ||
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

test("dashboard makes phone hosting the primary complete hit target", async ({
  page,
}) => {
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    await page.goto("/dev/host/mobile?surface=dashboard");
    const dashboard = page.getByTestId("host-dashboard");
    await expect(dashboard).toHaveAttribute("data-host-mobile-surface", "true");
    await expectNoHorizontalOverflow(page);
    const primary = page.getByRole("button", { name: "Control live game" });
    await expect(primary).toBeVisible();
    await expect(
      page.getByTestId("host-private-phone-controls"),
    ).toHaveCount(0);

    const interactive = dashboard.locator(INTERACTIVE_SELECTOR);
    for (let index = 0; index < (await interactive.count()); index += 1) {
      await expectAccessibleHitTarget(page, interactive.nth(index));
    }
    await expectAccessibleHitTarget(page, primary);
  }
});
