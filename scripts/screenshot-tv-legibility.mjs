import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import process from "node:process";

const PORT = Number(process.env.TV_LEGIBILITY_PORT ?? 3211);
const BASE_URL = process.env.TV_LEGIBILITY_BASE_URL ?? `http://localhost:${PORT}`;
const OUTPUT_DIR = process.env.TV_LEGIBILITY_OUTPUT ?? "artifacts/tv-legibility";

const sizes = [
  { name: "1280x720", width: 1280, height: 720 },
  { name: "1920x1080", width: 1920, height: 1080 },
];
const themes = ["house", "daylight"];
const themePaper = {
  house: "rgb(27, 19, 12)",
  daylight: "rgb(244, 230, 196)",
};
const screens = ["question", "reveal"];

let server = null;

async function reachable() {
  try {
    const response = await fetch(`${BASE_URL}/dev/tv`);
    return response.ok;
  } catch {
    return false;
  }
}

async function ensureServer() {
  if (await reachable()) return;
  server = spawn("npm", ["run", "dev", "--", "--port", String(PORT)], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`TV legibility dev server exited with ${server.exitCode}`);
    }
    if (await reachable()) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("TV legibility dev server did not become ready within 60s");
}

function stopServer() {
  if (server && server.exitCode === null) server.kill("SIGTERM");
}

await mkdir(OUTPUT_DIR, { recursive: true });
await ensureServer();

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 2200, height: 1400 } });
const failures = [];

try {
  await page.goto(`${BASE_URL}/dev/tv`, { waitUntil: "networkidle" });

  for (const theme of themes) {
    await page.locator("select").selectOption(theme);
    await page.waitForFunction(
      ({ expectedColor }) => {
        const frame = document.querySelector('[data-tv-preview-frame="question"]');
        return frame?.firstElementChild
          ? getComputedStyle(frame.firstElementChild).backgroundColor === expectedColor
          : false;
      },
      { expectedColor: themePaper[theme] },
    );

    for (const key of screens) {
      const frame = page.locator(`[data-tv-preview-frame="${key}"]`);
      await frame.waitFor({ state: "visible" });

      for (const size of sizes) {
        await frame.evaluate((element, viewport) => {
          element.style.width = `${viewport.width}px`;
          element.style.height = `${viewport.height}px`;
          element.style.maxWidth = "none";
          element.style.aspectRatio = "auto";
        }, size);

        const result = await frame.evaluate((element, viewport) => {
          const rect = element.getBoundingClientRect();
          const stage = element.firstElementChild;
          const stageRect = stage?.getBoundingClientRect();
          const critical = Array.from(
            element.querySelectorAll(
              '[data-testid="tv-question-option-text"], [data-testid="tv-question-lock-status"], [data-testid="tv-reveal-header"], [data-testid="tv-reveal-answer-card"], [data-testid="tv-reveal-fact"], [data-testid="tv-reveal-fastest-name"], [data-testid="tv-reveal-fastest-list"], [data-testid="tv-reveal-stats"]',
            ),
          );
          const clipped = critical
            .filter((node) => {
              const child = node.getBoundingClientRect();
              return (
                child.left < rect.left - 1 ||
                child.right > rect.right + 1 ||
                child.top < rect.top - 1 ||
                child.bottom > rect.bottom + 1
              );
            })
            .map((node) => node.getAttribute("data-testid"));

          return {
            actualWidth: Math.round(rect.width),
            actualHeight: Math.round(rect.height),
            expectedWidth: viewport.width,
            expectedHeight: viewport.height,
            stageWidth: stageRect ? Math.round(stageRect.width) : 0,
            stageHeight: stageRect ? Math.round(stageRect.height) : 0,
            horizontalOverflow: element.scrollWidth - element.clientWidth,
            verticalOverflow: element.scrollHeight - element.clientHeight,
            clipped,
          };
        }, size);

        if (
          Math.abs(result.actualWidth - size.width) > 1 ||
          Math.abs(result.actualHeight - size.height) > 1 ||
          // The gallery proof frame contributes a 1px border on every side;
          // the real TV stage correctly fills its inner content box.
          Math.abs(result.stageWidth - (size.width - 2)) > 1 ||
          Math.abs(result.stageHeight - (size.height - 2)) > 1 ||
          result.horizontalOverflow > 1 ||
          result.verticalOverflow > 1 ||
          result.clipped.length > 0
        ) {
          failures.push({ theme, screen: key, size: size.name, ...result });
        }

        await frame.screenshot({
          path: `${OUTPUT_DIR}/${theme}-${key}-${size.name}.png`,
          animations: "disabled",
        });
      }
    }
  }
} finally {
  await browser.close();
  stopServer();
}

if (failures.length > 0) {
  throw new Error(`TV legibility failures:\n${JSON.stringify(failures, null, 2)}`);
}

process.stdout.write(`TV legibility passed: ${OUTPUT_DIR}\n`);
