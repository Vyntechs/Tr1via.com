import { expect, test, type Locator, type Page } from "@playwright/test";

const SEPTEMBER = "september";

async function chooseSeptember(page: Page) {
  await page.locator("select").first().selectOption(SEPTEMBER);
}

async function expectRecognizableKeepsakes(
  surface: Locator,
  { requireViewport = false }: { requireViewport?: boolean } = {},
) {
  const drift = surface.getByTestId("september-homecoming-drift");
  await expect(drift).toHaveAttribute("data-motion", "falling");

  const footballs = surface.getByTestId("september-homecoming-football");
  const poms = surface.getByTestId("september-homecoming-pom");
  const leaves = surface.getByTestId("september-homecoming-leaf");
  expect(await leaves.count()).toBeLessThanOrEqual((await footballs.count()) + (await poms.count()));

  const football = surface.locator('[data-keepsake-id="ball-1"]');
  const pom = surface.locator('[data-keepsake-id="pom-1"]');
  const footballGlyph = surface.locator('[data-keepsake-id="ball-1"] svg');
  const pomGlyph = surface.locator('[data-keepsake-id="pom-1"] svg');
  await expect(footballGlyph).toBeVisible();
  await expect(pomGlyph).toBeVisible();
  if (requireViewport) {
    await expect(footballGlyph).toBeInViewport();
    await expect(pomGlyph).toBeInViewport();
  }

  const [surfaceBox, footballBox, pomBox] = await Promise.all([
    surface.boundingBox(),
    footballGlyph.boundingBox(),
    pomGlyph.boundingBox(),
  ]);
  expect(surfaceBox).not.toBeNull();
  expect(footballBox).not.toBeNull();
  expect(pomBox).not.toBeNull();
  expect(Math.min(footballBox!.width, footballBox!.height)).toBeGreaterThanOrEqual(40);
  expect(Math.min(pomBox!.width, pomBox!.height)).toBeGreaterThanOrEqual(44);

  for (const glyph of [footballBox!, pomBox!]) {
    expect(glyph.x).toBeGreaterThanOrEqual(surfaceBox!.x - 0.5);
    expect(glyph.y).toBeGreaterThanOrEqual(surfaceBox!.y - 0.5);
    expect(glyph.x + glyph.width).toBeLessThanOrEqual(surfaceBox!.x + surfaceBox!.width + 0.5);
    expect(glyph.y + glyph.height).toBeLessThanOrEqual(surfaceBox!.y + surfaceBox!.height + 0.5);
  }

  const before = await Promise.all([
    football.evaluate((element) => getComputedStyle(element).transform),
    pom.evaluate((element) => getComputedStyle(element).transform),
  ]);
  await surface.page().waitForTimeout(1_000);
  const after = await Promise.all([
    football.evaluate((element) => getComputedStyle(element).transform),
    pom.evaluate((element) => getComputedStyle(element).transform),
  ]);
  expect(after[0]).not.toBe(before[0]);
  expect(after[1]).not.toBe(before[1]);
}

async function expectFloodlightAssemblies(surface: Locator) {
  const front = surface.getByTestId("september-front");
  const lamps = front.getByTestId("september-stadium-lamp-head");
  await expect(lamps).toHaveCount(2);
  const frontBox = await front.boundingBox();
  expect(frontBox).not.toBeNull();

  for (const lamp of [lamps.nth(0), lamps.nth(1)]) {
    await expect(lamp.getByTestId("september-stadium-lamp-bank")).toBeVisible();
    await expect(lamp.getByTestId("september-stadium-lamp-yoke")).toBeVisible();
    const lampBox = await lamp.boundingBox();
    expect(lampBox).not.toBeNull();
    expect(lampBox!.x).toBeGreaterThanOrEqual(frontBox!.x - 0.5);
    expect(lampBox!.x + lampBox!.width).toBeLessThanOrEqual(frontBox!.x + frontBox!.width + 0.5);
  }

  const supports = front.getByTestId("september-stadium-lights");
  const supportBox = await supports.boundingBox();
  expect(supportBox).not.toBeNull();
  expect(supportBox!.height).toBeGreaterThanOrEqual(frontBox!.height * 0.25);
  await expect(front.getByTestId("september-stadium-light-beams")).toBeVisible();
}

test("September is first-read on the production host overview at desktop and compact widths", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/dev/host/gen");
  await chooseSeptember(page);

  const desktop = page.getByTestId("host-gen-overview-layout").locator("xpath=../..");
  await expectRecognizableKeepsakes(desktop);
  await expectFloodlightAssemblies(desktop);

  // The mobile harness uses the calendar theme. Pin its browser clock so the
  // proof remains September-specific when this regression runs later.
  await page.addInitScript({
    content: `
      const NativeDate = Date;
      const septemberNow = new NativeDate("2026-09-02T12:00:00-05:00").valueOf();
      globalThis.Date = class extends NativeDate {
        constructor(...args) { super(...(args.length === 0 ? [septemberNow] : args)); }
        static now() { return septemberNow; }
      };
    `,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dev/host/mobile?surface=overview");
  await expect(page.locator("html")).toHaveAttribute("data-theme", SEPTEMBER);

  await expect(page.getByTestId("host-gen-overview-layout")).toHaveAttribute("data-layout", "mobile");
  const compact = page.getByTestId("host-gen-overview-layout").locator("xpath=../..");
  await expectRecognizableKeepsakes(compact, { requireViewport: true });
  await expectFloodlightAssemblies(compact);
});

test("September keeps TV and player reading states quiet while open surfaces fall", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/dev/tv");
  await chooseSeptember(page);

  const tvLobby = page.getByTestId("tv-lobby").first();
  await expectRecognizableKeepsakes(tvLobby);
  const tvQuestion = page.getByTestId("tv-question").first();
  await expect(tvQuestion.getByTestId("september-homecoming-drift")).toHaveAttribute(
    "data-motion",
    "static",
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dev/player/preview?theme=september&state=lobby");
  await expectRecognizableKeepsakes(page.getByTestId("player-lobby"), { requireViewport: true });

  for (const state of ["question", "locked"] as const) {
    await page.goto(`/dev/player/preview?theme=september&state=${state}`);
    const surface = page.getByTestId(state === "question" ? "player-question" : "player-locked");
    await expect(surface.getByTestId("september-homecoming-drift")).toHaveAttribute(
      "data-motion",
      "static",
    );
    const football = surface.locator('[data-keepsake-id="ball-1"] svg');
    const pom = surface.locator('[data-keepsake-id="pom-1"] svg');
    await expect(football).toBeVisible();
    await expect(pom).toBeVisible();
    await expect(football).toBeInViewport();
    await expect(pom).toBeInViewport();
    const footballBox = await football.boundingBox();
    const pomBox = await pom.boundingBox();
    expect(footballBox).not.toBeNull();
    expect(pomBox).not.toBeNull();
    expect(Math.min(footballBox!.width, footballBox!.height)).toBeGreaterThanOrEqual(40);
    expect(Math.min(pomBox!.width, pomBox!.height)).toBeGreaterThanOrEqual(44);
  }

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/dev/player/preview?theme=september&state=lobby");
  await expect(page.getByTestId("september-homecoming-drift")).toHaveAttribute(
    "data-motion",
    "static",
  );
});
