// November TV question: a long question WITH a photo and long answers.
// Before the fix the timer's "SPEED BONUS < 5s" label was cut off (the top
// row was shorter than the ring + label and hides its overflow). Now the
// answers go compact so the label, the question and every answer show whole.
// Uses the database-free /dev/tv/world preview.

import { test, expect } from "@playwright/test";

for (const [width, height] of [[1920, 1080], [1280, 720]] as const) {
  test(`November long question + photo: nothing clipped at ${width}×${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto("/dev/tv/world?moment=question&s=14&locked=5&players=12&long=1&theme=november");
    await expect(page.getByTestId("tv-question")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("tv-question-image")).toBeVisible();
    await expect(page.getByTestId("november-timer-column")).toContainText("SPEED BONUS");
    await page.waitForTimeout(800); // fonts + auto-fit settle

    const clipped = await page.evaluate(() => {
      const root = document.querySelector('[data-testid="tv-question"]')!;
      const out: string[] = [];
      for (const el of root.querySelectorAll<HTMLElement>("*")) {
        const ownText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim());
        if (!ownText) continue;
        const b = el.getBoundingClientRect();
        if (!b.width || !b.height) continue;
        for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
          if (getComputedStyle(p).overflow === "visible") continue;
          const pb = p.getBoundingClientRect();
          // 3px slack: a line box can sit a hair past its frame with no glyph cut.
          if (b.bottom > pb.bottom + 3 || b.right > pb.right + 3)
            out.push(`${el.textContent!.trim().slice(0, 40)} (${Math.round(b.bottom - pb.bottom)}px)`);
          break;
        }
      }
      return out;
    });
    expect(clipped).toEqual([]);
  });
}
