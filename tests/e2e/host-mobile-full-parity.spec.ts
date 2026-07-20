import { expect, test, type Page } from "@playwright/test";
import {
  loginAsHost,
  resetTestData,
  seedNight,
  type SeededNight,
} from "./helpers/host-laptop";
import { TID } from "./helpers/selectors";

const PHONE_VIEWPORTS = [
  { name: "small", width: 320, height: 568 },
  { name: "tall", width: 360, height: 800 },
  { name: "iphone", width: 390, height: 844 },
  { name: "wide", width: 440, height: 956 },
  { name: "landscape", width: 844, height: 390 },
] as const;
const HOST_EMAIL = `mobile-parity-${Date.now()}@tr1via.test`;
const INTERACTIVE_SELECTOR = [
  "button:visible",
  "a[href]:visible",
  'input:not([type="hidden"]):visible',
  "select:visible",
  "textarea:visible",
  '[role="button"]:visible',
].join(", ");

async function expectPhoneFit(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    )
    .toBe(true);
}

async function expectTouchSafeHostActions(page: Page) {
  const undersized = await page
    .locator(INTERACTIVE_SELECTOR)
    .evaluateAll((elements) =>
      elements
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            label: element.getAttribute("aria-label") ?? element.textContent?.trim(),
            testId: element.getAttribute("data-testid"),
            tag: element.tagName.toLowerCase(),
            width: rect.width,
            height: rect.height,
          };
        })
        .filter(({ width, height }) => width < 43.5 || height < 43.5),
    );
  expect(undersized).toEqual([]);

  const interactive = page.locator(INTERACTIVE_SELECTOR);
  for (let index = 0; index < (await interactive.count()); index += 1) {
    const control = interactive.nth(index);
    await control.evaluate((element) =>
      element.scrollIntoView({ block: "center", inline: "center" }),
    );
    const box = await control.boundingBox();
    const viewport = page.viewportSize();
    expect(box).not.toBeNull();
    expect(viewport).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width + 0.5);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height + 0.5);
  }
}

async function endRound(page: Page, gameNo: 1 | 2) {
  await page.getByRole("button", { name: `End Game ${gameNo}` }).click();
  await expect(
    page.getByRole("button", { name: `Confirm end Game ${gameNo}` }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: `Confirm end Game ${gameNo}` })
    .click();
}

test.describe.serial("phone-first host parity", () => {
  let readyNight: SeededNight | null = null;
  let emptyNight: SeededNight | null = null;

  test.afterAll(async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await resetTestData(page).catch(() => {});
    await context.close();
  });

  test("real email form signs in a known host on a phone", async ({ page }) => {
    // Create the known host through the guarded fixture, clear its session,
    // then enter through the same email form a real host uses.
    await loginAsHost(page, HOST_EMAIL, "Mobile Host");
    await page.context().clearCookies();
    await page.setViewportSize(PHONE_VIEWPORTS[0]);
    await page.goto("/login");
    await page.getByLabel("Email").fill(HOST_EMAIL);
    await page.getByTestId(TID.login.submit).click();
    await expect(page).toHaveURL(/\/host(?:\/|$)/, { timeout: 30_000 });
    await expectPhoneFit(page);
  });

  test("every production prep surface fits the supported phone matrix", async ({
    page,
  }, testInfo) => {
    test.setTimeout(180_000);
    // Keep data sequencing on the established guarded test-login session.
    // The production email door is independently proven above.
    const { hostId } = await loginAsHost(page, HOST_EMAIL, "Mobile Host");

    emptyNight = await seedNight(page, hostId, "empty-night");
    readyNight = await seedNight(page, hostId, "two-games-ready");

    for (const viewport of PHONE_VIEWPORTS) {
      await page.setViewportSize(viewport);

      await page.goto(`/host/setup/${emptyNight.nightId}`);
      await expect(page.getByTestId("host-gen-overview-layout")).toHaveAttribute(
        "data-layout",
        "mobile",
      );
      await expectPhoneFit(page);
      await expectTouchSafeHostActions(page);

      await page.goto(
        `/host/setup/${emptyNight.nightId}/topic?game=${emptyNight.game1.id}&position=1`,
      );
      await expect(page.getByTestId("host-gen-topic-layout")).toHaveAttribute(
        "data-layout",
        "mobile",
      );
      await expectPhoneFit(page);
      await expectTouchSafeHostActions(page);

      await page.goto(
        `/host/setup/${readyNight.nightId}/pick/${readyNight.categories[0]!.id}`,
      );
      await expect(page.getByTestId("host-gen-pick-layout")).toHaveAttribute(
        "data-layout",
        "mobile",
      );
      await expectPhoneFit(page);
      await expectTouchSafeHostActions(page);

      await page.goto(`/host/live/${readyNight.nightId}`);
      await expect(page.getByTestId("host-phone-round-controls")).toBeVisible();
      await expect(page.locator('a[href^="/tv/"]')).toHaveCount(0);
      await expectPhoneFit(page);

      await page.goto(`/host/phone/${readyNight.nightId}`);
      await expect(page).toHaveURL(`/host/live/${readyNight.nightId}`);
      await expect(page.getByTestId("host-phone-round-controls")).toBeVisible();
      await expectPhoneFit(page);

      if (viewport.name === "iphone" || viewport.name === "landscape") {
        await page.screenshot({
          path: testInfo.outputPath(`host-phone-${viewport.name}.png`),
          fullPage: true,
        });
      }
    }
  });

  test("canonical phone controller runs Game 1, recovery, Game 2, and night close", async ({
    page,
  }, testInfo) => {
    test.setTimeout(180_000);
    expect(readyNight).not.toBeNull();
    await loginAsHost(page, HOST_EMAIL, "Mobile Host");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/host/live/${readyNight!.nightId}`);

    await page.getByRole("button", { name: "Start Game 1" }).click();
    await page.goto("/host");
    const liveGameControl = page.getByRole("button", { name: "Control live game" });
    await expect(liveGameControl).toBeVisible();
    const liveGameControlBox = await liveGameControl.boundingBox();
    expect(liveGameControlBox!.width).toBeGreaterThanOrEqual(43.5);
    expect(liveGameControlBox!.height).toBeGreaterThanOrEqual(43.5);
    await expectTouchSafeHostActions(page);
    await liveGameControl.click();
    await expect(page).toHaveURL(`/host/live/${readyNight!.nightId}`);
    await expect(page.getByRole("button", { name: /Reveal to the room/ })).toBeVisible();

    // Reveal, undo inside the guarded window, then reload to prove the
    // recovered snapshot returns the same question to the staging controls.
    await page.getByRole("button", { name: /Reveal to the room/ }).click();
    const undo = page.getByRole("button", { name: /Undo · pull the question back/ });
    await expect(undo).toBeEnabled({ timeout: 8_000 });
    await undo.click();
    await expect(page.getByRole("button", { name: /Reveal to the room/ })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("button", { name: /Reveal to the room/ })).toBeVisible({
      timeout: 15_000,
    });

    // Resolve one question and require a different next question before the
    // round can end. This catches stale local staging pools on mobile.
    const firstPrompt = await page
      .getByText("THE QUESTION · TV ONLY")
      .locator("xpath=following-sibling::div[1]")
      .innerText();
    await page.getByRole("button", { name: /Reveal to the room/ }).click();
    await page.getByRole("button", { name: /End early · reveal now/ }).click();
    const nextPrompt = page
      .getByText("THE QUESTION · TV ONLY")
      .locator("xpath=following-sibling::div[1]");
    await expect(nextPrompt).not.toHaveText(firstPrompt, { timeout: 15_000 });

    await endRound(page, 1);
    await expect(page.getByRole("button", { name: "Start Game 2" })).toBeVisible({
      timeout: 15_000,
    });
    await page.screenshot({
      path: testInfo.outputPath("host-game-2-wait.png"),
      fullPage: true,
    });

    await page.getByRole("button", { name: "Start Game 2" }).click();
    await expect(page.getByRole("button", { name: /Reveal to the room/ })).toBeVisible();
    await endRound(page, 2);
    await expect(page.getByRole("button", { name: "End the night" })).toBeVisible({
      timeout: 15_000,
    });
    await page.getByRole("button", { name: "End the night" }).click();

    const closed = await page.request.get(`/api/tv/${readyNight!.roomCode}/snapshot`);
    expect(closed.status()).toBe(404);
  });
});
