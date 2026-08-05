// Capture the SHIPPED August theme off the real dev galleries.
//
// Unlike scripts/august-screens.mjs (which shot the four /dev/august candidate
// concepts), this points at /dev/tv and /dev/player with the theme picker set
// to "august" — i.e. the actual product components running the actual theme,
// so what lands in the file is what a venue would see.
//
//   node scripts/august-shipped-shots.mjs [baseUrl] [outDir]

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const BASE = process.argv[2] ?? "http://localhost:3012";
const OUT = process.argv[3] ?? "tasks/august-shipped";

mkdirSync(OUT, { recursive: true });

const problems = [];

/** Both galleries wrap each surface in a label + a fixed-size frame, but one
 *  uses <section> and the other a plain <div>. Match on the frame's measured
 *  size instead, which is the thing that actually identifies a surface. */
async function shootGallery(page, path, viewport, prefix, size, selector) {
  await page.setViewportSize(viewport);
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle", timeout: 90_000 });
  await page.selectOption("select", "august");
  // Let the leaves settle into a mid-fall frame and the fonts land.
  await page.waitForTimeout(2500);

  const candidates = page.locator(selector);
  const n = await candidates.count();

  // Measure everything BEFORE shooting anything: element.screenshot() scrolls
  // the target into view, so positions taken mid-loop drift and two different
  // frames start reporting the same coordinates. boundingBox() alone doesn't
  // scroll, so one clean measuring pass is the honest way to pick frames.
  const picked = [];
  const seen = new Set();
  for (let i = 0; i < n; i++) {
    const box = await candidates.nth(i).boundingBox().catch(() => null);
    if (!box) continue;
    if (Math.abs(box.width - size.w) > 3 || Math.abs(box.height - size.h) > 3) continue;
    const at = `${Math.round(box.x)}:${Math.round(box.y)}`;
    if (seen.has(at)) continue;
    seen.add(at);
    picked.push(i);
  }

  let shot = 0;
  for (const i of picked) {
    const frame = candidates.nth(i);
    const label = (
      await frame
        .evaluate((el) => el.parentElement?.querySelector("*")?.textContent ?? "")
        .catch(() => "")
    ).trim();
    const slug = (label || `frame-${i}`)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60);
    const file = join(OUT, `${prefix}-${String(shot).padStart(2, "0")}-${slug}.jpg`);
    await frame.screenshot({ path: file, type: "jpeg", quality: 82 });
    shot++;
  }
  return shot;
}

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });

page.on("console", (m) => {
  if (m.type() === "error") problems.push(`console: ${m.text()}`);
});
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));

const tv = await shootGallery(page, "/dev/tv", { width: 1560, height: 1100 }, "tv", { w: 1280, h: 720 }, "section > div");
console.log(`tv: ${tv} frames`);

const player = await shootGallery(page, "/dev/player", { width: 1560, height: 1100 }, "player", { w: 380, h: 780 }, "div > div");
console.log(`player: ${player} frames`);

await browser.close();

if (problems.length) {
  console.log(`\n${problems.length} page problem(s):`);
  for (const p of problems.slice(0, 20)) console.log("  " + p);
} else {
  console.log("\nno console or page errors");
}
