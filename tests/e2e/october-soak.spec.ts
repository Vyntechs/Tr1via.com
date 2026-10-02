// October · Sleepy Hollow Night: the long run in a real browser.
//
// Opt-in (it takes as long as you ask): plays whole demo nights on a loop in
// /dev/tv/world?tour=1 (no database, nothing live), keeping ONE page open the
// way the venue TV stays open all night, while it:
//   - changes the window size (1280×720, 1920×1080, 3840×2160),
//   - hides the tab and shows it again (headless browsers never really hide
//     a tab, so it is emulated: the page is told it is hidden and its
//     animation frames are held back, then released in one go when it
//     "comes back"; Chromium is also truly frozen for those seconds),
//   - walks the TV, the host's laptop console and the host phone's still view,
// and counts every crash-guard warning ("[theme] …"), every time the world
// switched itself off, every uncaught error and every console error, plus
// memory at the start and the end. Any guard warning or switch-off fails it.
//
//   OCTOBER_SOAK_MINUTES=20 SOAK_BROWSER=webkit PORT=3311 \
//     npx playwright test tests/e2e/october-soak.spec.ts
//
// SOAK_OUT=<file.json> writes the numbers out.

import { test, expect, chromium, webkit, type Browser, type Page, type CDPSession } from "@playwright/test";
import { execSync } from "node:child_process";
import fs from "node:fs";

const MINUTES = Number(process.env.OCTOBER_SOAK_MINUTES ?? 0);
const BROWSER = process.env.SOAK_BROWSER === "webkit" ? "webkit" : "chromium";
const OUT = process.env.SOAK_OUT;
const SIZES = [
  { width: 1280, height: 720 },
  { width: 1920, height: 1080 },
  { width: 3840, height: 2160 },
];
// Share of the run each surface gets (one page load each, kept open).
const SEGMENTS = [
  { name: "tv", path: "/dev/tv/world?tour=1", share: 0.6 },
  { name: "host-console", path: "/dev/tv/world?tour=1&host=1", share: 0.2 },
  { name: "host-phone-still", path: "/dev/tv/world?tour=1&tier=still", share: 0.2 },
];

test.skip(!MINUTES, "Long run: set OCTOBER_SOAK_MINUTES to run it.");
test.setTimeout((MINUTES + 6) * 60_000);

interface Memory {
  jsHeapMB: number | null;
  domNodes: number;
  listeners: number | null;
  rendererRssMB: number | null;
}

interface Tally {
  guardWarnings: string[];
  worldOff: string[];
  pageErrors: string[];
  consoleErrors: string[];
  demoOnlyFailures: string[];
  moments: Set<string>;
  phases: Set<string>;
  horseman: Set<string>;
  pumpkins: Set<string>;
  sizes: Set<string>;
  hides: number;
  hiddenWorked: boolean | null;
  polls: number;
}

test(`October world holds up for ${MINUTES} min (${BROWSER})`, async () => {
  const browser: Browser = BROWSER === "webkit" ? await webkit.launch() : await chromium.launch();
  const base = `http://localhost:${process.env.PORT ?? 3000}`;
  const tally: Tally = {
    guardWarnings: [],
    worldOff: [],
    pageErrors: [],
    consoleErrors: [],
    demoOnlyFailures: [],
    moments: new Set(),
    phases: new Set(),
    horseman: new Set(),
    pumpkins: new Set(),
    sizes: new Set(),
    hides: 0,
    hiddenWorked: null,
    polls: 0,
  };
  const segments: Array<{ name: string; minutes: number; start: Memory; end: Memory; trend: Memory[] }> = [];

  for (const segment of SEGMENTS) {
    const context = await browser.newContext({ viewport: SIZES[1], baseURL: base });
    const page = await context.newPage();
    page.on("console", (m) => {
      const text = m.text();
      if (text.startsWith("[theme]")) tally.guardWarnings.push(`${segment.name}: ${text.slice(0, 300)}`);
      // (Failed loads are counted from the response itself, below.)
      else if (m.type() === "error" && !text.startsWith("Failed to load resource")) {
        tally.consoleErrors.push(`${segment.name}: ${text.slice(0, 300)}`);
      }
    });
    page.on("pageerror", (e) => tally.pageErrors.push(`${segment.name}: ${String(e).slice(0, 300)}`));
    page.on("response", (r) => {
      if (r.status() < 400) return;
      const line = `${segment.name}: HTTP ${r.status()} ${r.url().slice(0, 200)}`;
      // The demo night has no database: when a demo question's clock hits
      // zero, the TV's own "close the question" backup call fails. Expected.
      if (/\/api\/questions\/[^/]+\/resolve$/.test(r.url())) tally.demoOnlyFailures.push(line);
      else tally.consoleErrors.push(line);
    });
    await page.addInitScript(HIDE_TAB);
    const cdp = BROWSER === "chromium" ? await context.newCDPSession(page) : null;
    if (cdp) await cdp.send("Performance.enable");

    await page.goto(segment.path);
    await page.getByTestId("october-world").first().waitFor({ timeout: 60_000 });
    await page.waitForTimeout(20_000); // settle: art decoded, first nights under way
    const start = await memory(page, cdp);

    const segmentMs = MINUTES * segment.share * 60_000;
    const until = Date.now() + segmentMs - 20_000;
    let nextResize = Date.now() + 20_000;
    let nextHide = Date.now() + 30_000;
    let sizeIndex = 1;
    // Memory every 2 minutes, to see a trend rather than two points.
    const trend: Memory[] = [];
    let nextSample = Date.now() + 120_000;
    while (Date.now() < until) {
      await poll(page, segment.name, tally);
      if (Date.now() >= nextSample) {
        trend.push(await memory(page, cdp));
        nextSample = Date.now() + 120_000;
      }
      if (Date.now() >= nextResize) {
        sizeIndex = (sizeIndex + 1) % SIZES.length;
        await page.setViewportSize(SIZES[sizeIndex]);
        tally.sizes.add(`${SIZES[sizeIndex].width}x${SIZES[sizeIndex].height}`);
        nextResize = Date.now() + 20_000;
      }
      if (Date.now() >= nextHide) {
        await hideAndShow(page, cdp, tally);
        nextHide = Date.now() + 60_000;
      }
      await page.waitForTimeout(500);
    }
    await page.setViewportSize(SIZES[1]);
    await page.waitForTimeout(3000);
    await poll(page, segment.name, tally);
    const end = await memory(page, cdp);
    segments.push({ name: segment.name, minutes: segmentMs / 60_000, start, end, trend });
    await context.close();
  }
  await browser.close();

  const summary = {
    browser: BROWSER,
    minutes: MINUTES,
    guardWarnings: tally.guardWarnings.length,
    worldSwitchedOff: tally.worldOff.length,
    pageErrors: tally.pageErrors.length,
    consoleErrors: tally.consoleErrors.length,
    demoOnlyResolveFailures: tally.demoOnlyFailures.length,
    hides: tally.hides,
    hiddenReallyHidden: tally.hiddenWorked,
    polls: tally.polls,
    moments: [...tally.moments].sort(),
    phases: [...tally.phases].sort(),
    horseman: [...tally.horseman].sort(),
    pumpkinCounts: [...tally.pumpkins].map(Number).sort((a, b) => a - b),
    sizes: [...tally.sizes].sort(),
    segments,
    samples: {
      guardWarnings: tally.guardWarnings.slice(0, 10),
      worldOff: tally.worldOff.slice(0, 10),
      pageErrors: tally.pageErrors.slice(0, 10),
      consoleErrors: tally.consoleErrors.slice(0, 20),
    },
  };
  console.log(JSON.stringify(summary, null, 2));
  if (OUT) fs.writeFileSync(OUT, JSON.stringify(summary, null, 2));

  expect(tally.guardWarnings).toEqual([]);
  expect(tally.worldOff).toEqual([]);
  expect(tally.pageErrors).toEqual([]);
});

async function poll(page: Page, segment: string, tally: Tally) {
  const state = await page.evaluate(() => {
    const world = document.querySelector<HTMLElement>("[data-testid=october-world]");
    return world
      ? {
          moment: world.dataset.worldMoment ?? "",
          phase: world.dataset.worldPhase ?? "",
          horseman: world.dataset.worldHorseman ?? "",
          pumpkins: world.dataset.worldPumpkins ?? "",
          off: world.dataset.worldOff === "true",
        }
      : null;
  });
  tally.polls++;
  if (!state) {
    tally.worldOff.push(`${segment}: world missing`);
    return;
  }
  if (state.off) tally.worldOff.push(`${segment}: switched off`);
  tally.moments.add(state.moment);
  tally.phases.add(state.phase);
  tally.horseman.add(state.horseman);
  if (state.pumpkins) tally.pumpkins.add(state.pumpkins);
}

// What a browser does to a tab in the background: says it's hidden and stops
// handing out animation frames; when the tab returns, the next frame arrives
// with a big time jump. (Installed before the page's own scripts run.)
const HIDE_TAB = `(() => {
  const realRaf = window.requestAnimationFrame.bind(window);
  let held = [];
  let hidden = false;
  window.requestAnimationFrame = (cb) => {
    if (hidden) { held.push(cb); return 0; }
    return realRaf(cb);
  };
  window.__soakSetHidden = (on) => {
    hidden = on;
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (on ? "hidden" : "visible") });
    Object.defineProperty(document, "hidden", { configurable: true, get: () => on });
    document.dispatchEvent(new Event("visibilitychange"));
    if (!on) { const queue = held; held = []; queue.forEach((cb) => realRaf(cb)); }
    return document.visibilityState;
  };
})();`;

// Hide the tab for 5 seconds, then bring it back, the way a host flips to
// another tab and returns.
async function hideAndShow(page: Page, cdp: CDPSession | null, tally: Tally) {
  const state = await page.evaluate(() => (window as unknown as { __soakSetHidden: (on: boolean) => string }).__soakSetHidden(true));
  tally.hiddenWorked = state === "hidden";
  if (cdp) await cdp.send("Page.setWebLifecycleState", { state: "frozen" });
  await new Promise((resolve) => setTimeout(resolve, 5000));
  if (cdp) await cdp.send("Page.setWebLifecycleState", { state: "active" });
  await page.evaluate(() => (window as unknown as { __soakSetHidden: (on: boolean) => string }).__soakSetHidden(false));
  tally.hides++;
}

async function memory(page: Page, cdp: CDPSession | null): Promise<Memory> {
  let jsHeapMB: number | null = null;
  let listeners: number | null = null;
  if (cdp) {
    await cdp.send("HeapProfiler.collectGarbage").catch(() => {});
    const { metrics } = (await cdp.send("Performance.getMetrics")) as { metrics: Array<{ name: string; value: number }> };
    const get = (name: string) => metrics.find((m) => m.name === name)?.value ?? null;
    const heap = get("JSHeapUsedSize");
    jsHeapMB = heap === null ? null : Math.round((heap / 1048576) * 10) / 10;
    listeners = get("JSEventListeners");
  }
  const domNodes = await page.evaluate(() => document.getElementsByTagName("*").length);
  return { jsHeapMB, domNodes, listeners, rendererRssMB: rendererRss() };
}

/** Resident memory of the browser's page processes, MB (approximate). */
function rendererRss(): number | null {
  try {
    const pattern = BROWSER === "webkit" ? "WebContent|WebKitWebProcess" : "type=renderer";
    const out = execSync(`ps -axo rss=,command= | grep -E "ms-playwright" | grep -E "${pattern}" | grep -v grep`, {
      encoding: "utf8",
    });
    const kb = out
      .trim()
      .split("\n")
      .filter(Boolean)
      .reduce((sum, line) => sum + Number(line.trim().split(/\s+/)[0] || 0), 0);
    return Math.round(kb / 1024);
  } catch {
    return null;
  }
}
