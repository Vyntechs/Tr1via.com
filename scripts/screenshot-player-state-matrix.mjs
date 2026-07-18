import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import process from "node:process";

const PORT = Number(process.env.PLAYER_MATRIX_PORT ?? 3210);
const BASE_URL = process.env.PLAYER_MATRIX_BASE_URL ?? `http://127.0.0.1:${PORT}`;
const OUTPUT_DIR = process.env.PLAYER_MATRIX_OUTPUT ?? "artifacts/player-state-matrix";

const sizes = [
  { name: "280x653", width: 280, height: 653 },
  { name: "320x568", width: 320, height: 568 },
  { name: "360x640", width: 360, height: 640 },
  { name: "390x844", width: 390, height: 844 },
  { name: "430x932", width: 430, height: 932 },
  { name: "480x1040", width: 480, height: 1040 },
  { name: "667x375-landscape", width: 667, height: 375 },
  { name: "844x390-landscape", width: 844, height: 390 },
];

let server = null;

async function reachable() {
  try {
    const response = await fetch(`${BASE_URL}/dev/player`);
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
      throw new Error(`player matrix dev server exited with ${server.exitCode}`);
    }
    if (await reachable()) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("player matrix dev server did not become ready within 60s");
}

function stopServer() {
  if (server && server.exitCode === null) server.kill("SIGTERM");
}

await mkdir(OUTPUT_DIR, { recursive: true });
await ensureServer();

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1200, height: 1200 } });
const failures = [];

try {
  await page.goto(`${BASE_URL}/dev/player`, { waitUntil: "networkidle" });
  const frames = page.locator("[data-player-preview-frame]");
  const frameCount = await frames.count();
  if (frameCount === 0) throw new Error("no player preview frames found");

  for (let index = 0; index < frameCount; index += 1) {
    const frame = frames.nth(index);
    const key = await frame.getAttribute("data-player-preview-frame");
    if (!key) continue;

    for (const size of sizes) {
      await frame.evaluate((element, viewport) => {
        const frameElement = element;
        // The preview device contributes 10px padding + 1px border per side.
        frameElement.style.width = `${viewport.width + 22}px`;
        frameElement.style.height = `${viewport.height + 22}px`;
      }, size);

      const screen = frame.locator(":scope > div").last().locator(":scope > *").first();
      await screen.waitFor({ state: "visible" });

      const result = await screen.evaluate(async (element, viewport) => {
        const tolerance = 1.5;
        const horizontalOverflow = element.scrollWidth - element.clientWidth;
        const locked = getComputedStyle(element).overflowY === "hidden";
        const controls = Array.from(
          element.querySelectorAll("button, input, select, textarea, a[href]"),
        );
        const clipped = [];

        for (const control of controls) {
          if (!(control instanceof HTMLElement)) continue;
          control.scrollIntoView({ block: "nearest", inline: "nearest" });
          await new Promise((resolve) => requestAnimationFrame(resolve));
          const rect = element.getBoundingClientRect();
          const controlRect = control.getBoundingClientRect();
          if (
            controlRect.left < rect.left - tolerance ||
            controlRect.right > rect.right + tolerance ||
            (locked &&
              (controlRect.top < rect.top - tolerance ||
                controlRect.bottom > rect.bottom + tolerance))
          ) {
            clipped.push((control.textContent || control.getAttribute("aria-label") || control.tagName).trim());
          }
        }
        element.scrollTop = 0;
        const rect = element.getBoundingClientRect();

        return {
          horizontalOverflow,
          clipped,
          actualWidth: Math.round(rect.width),
          actualHeight: Math.round(rect.height),
          expectedWidth: viewport.width,
          expectedHeight: viewport.height,
        };
      }, size);

      if (
        result.horizontalOverflow > 1 ||
        result.clipped.length > 0 ||
        Math.abs(result.actualWidth - result.expectedWidth) > 1 ||
        Math.abs(result.actualHeight - result.expectedHeight) > 1
      ) {
        failures.push({ screen: key, size: size.name, ...result });
      }

      await screen.screenshot({
        path: `${OUTPUT_DIR}/${key}-${size.name}.png`,
        animations: "disabled",
      });
    }
  }
} finally {
  await browser.close();
  stopServer();
}

if (failures.length > 0) {
  throw new Error(`player state matrix failures:\n${JSON.stringify(failures, null, 2)}`);
}

process.stdout.write(`Player state matrix passed: ${OUTPUT_DIR}\n`);
