#!/usr/bin/env node
// Capture before/after screenshots of the player-phone Question screen at
// multiple device widths. Drives the local dev server at /dev/player and
// scrolls each PhoneFrame into view to grab a clean shot.
//
// Run: PORT=3030 node scripts/screenshot-player-question.mjs
//
// Devices covered:
//   iPhone SE   375 × 667  — smallest in-market iPhone (worst-case height)
//   iPhone 14   390 × 844  — modal iPhone
//   iPhone 15 Pro Max  430 × 932 — largest iPhone
//   Pixel 5     393 × 851  — Android reference
//
// Output: validate-question-<device>-<key>.png in the repo root.

import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const PORT = process.env.PORT || 3030;
const BASE = `http://localhost:${PORT}`;

const DEVICES = [
  { name: "iphone-se", width: 375, height: 667, deviceScaleFactor: 2 },
  { name: "iphone-14", width: 390, height: 844, deviceScaleFactor: 3 },
  { name: "iphone-15-pro-max", width: 430, height: 932, deviceScaleFactor: 3 },
  { name: "pixel-5", width: 393, height: 851, deviceScaleFactor: 2.75 },
];

// Each entry corresponds to a PlayerQuestion variant in /dev/player. We use
// data-testid="player-question" to find the right phone frame for each.
// The dev gallery renders all variants in a grid; we scroll to the matching
// frame to capture only it.
const VARIANTS = [
  { key: "short",  title: "03 · Question · live (text)" },
  { key: "image",  title: "03b · Question · live (w/ image)" },
  { key: "long",   title: "03c · Question · live (long, 163ch)" },
];

const OUT_DIR = "validate-screenshots";

// Variant query strings the /dev/player/preview route understands.
const PREVIEW_VARIANTS = ["short", "image", "long"];

async function captureFullViewport() {
  const browser = await chromium.launch();
  try {
    await mkdir(OUT_DIR, { recursive: true });
    for (const device of DEVICES) {
      for (const variant of PREVIEW_VARIANTS) {
        const context = await browser.newContext({
          viewport: { width: device.width, height: device.height },
          deviceScaleFactor: device.deviceScaleFactor,
          isMobile: true,
          hasTouch: true,
        });
        const page = await context.newPage();
        await page.goto(`${BASE}/dev/player/preview?variant=${variant}`, {
          waitUntil: "networkidle",
        });
        // Let useAutoFitText settle (ResizeObserver fires async after the
        // first layout pass; we wait one animation frame + a small buffer).
        await page.waitForTimeout(450);
        // Also capture the auto-fit font size for the report by reading it
        // back from the rendered DOM. Useful when verifying the policy
        // produced a sensible value per device.
        const fontSize = await page
          .getByTestId("player-question-prompt")
          .evaluate((el) => window.getComputedStyle(el).fontSize)
          .catch(() => "unknown");
        const out = `${OUT_DIR}/question-${device.name}-${variant}.png`;
        await page.screenshot({ path: out, fullPage: false });
        console.log(`captured ${out}  fontSize=${fontSize}`);
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
}

// We use the full-viewport preview route (not the gallery's 380×780 phone
// frame) so the screenshots reflect what the player actually sees on the
// device — the gallery frame would clip on iPhone SE.

(async () => {
  try {
    await captureFullViewport();
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
