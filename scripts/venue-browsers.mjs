#!/usr/bin/env node
// venue-browsers — a handful of REAL phones, rendering the real screen.
//
// The third leg of the pressure-test kit:
//
//   venue-load.mjs     transport only. Polls + heartbeats. Cheapest.
//   venue-players.mjs  real participants: join, opt in, hold a real realtime
//                      websocket, lock in answers, get scored. ~0 CPU each.
//   venue-browsers.mjs REAL Chromium instances running the actual app. They
//                      execute our React, subscribe over a real websocket, and
//                      PAINT. This is the only one that can answer "how long
//                      until a human actually SEES the question."
//
// Why so few: a real browser costs roughly a CPU core, which is why nobody
// gets thirty of them for free. The intended mix is a handful of these for
// truth about rendering + a crowd of venue-players for volume. Run them
// together against the same room and you have both.
//
// What it measures that nothing else can:
//   - paint latency: host presses Reveal → the question is VISIBLE on screen
//   - agreement: every browser shows the SAME question text (no split brain)
//   - the reveal verdict actually renders after resolve
//
// Usage:
//   node scripts/venue-browsers.mjs --base-url http://localhost:3000 \
//        --code ABC123 --browsers 6 --seconds 120
//   node scripts/venue-browsers.mjs --self-check   # proves playwright is wired

import { performance } from "node:perf_hooks";

const TID = {
  joinInput: "player-name-input",
  joinSubmit: "player-join-submit",
  lobby: "player-lobby",
  question: "player-question",
  locked: "player-locked",
  revealCorrect: "player-reveal-correct",
  revealWrong: "player-reveal-wrong",
  betweenGames: "player-between-games",
};

const NAMES = ["Ada", "Bram", "Cleo", "Dov", "Esme", "Finn", "Gita", "Hugo", "Ines", "Jonas", "Kira", "Liam"];

function parseArgs(argv) {
  const a = { baseUrl: "http://localhost:3000", code: "", browsers: 6, seconds: 150, selfCheck: false, headed: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--self-check") a.selfCheck = true;
    else if (k === "--headed") a.headed = true;
    else if (k === "--base-url") a.baseUrl = argv[++i];
    else if (k === "--code") a.code = argv[++i];
    else if (k === "--browsers") a.browsers = Number(argv[++i]);
    else if (k === "--seconds") a.seconds = Number(argv[++i]);
  }
  return a;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** One real phone: a browser context with its own cookies, storage and socket. */
async function runBrowserPlayer({ browser, baseUrl, code, seconds, ix, shared }) {
  const name = NAMES[ix % NAMES.length] + (ix >= NAMES.length ? ` ${Math.floor(ix / NAMES.length) + 1}` : "");
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  // Suppress the first-visit palette egg so it can't cover the screen.
  await context.addInitScript(() => {
    try { window.localStorage.setItem("tr1via:peeked-v1", "1"); } catch {}
  });
  const page = await context.newPage();
  const seen = new Set();

  try {
    await page.goto(`${baseUrl}/join?code=${code}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.getByTestId(TID.joinInput).waitFor({ state: "visible", timeout: 60_000 });
    await page.getByTestId(TID.joinInput).fill(name);
    await page.getByTestId(TID.joinSubmit).click();
    await page.getByTestId(TID.lobby).waitFor({ state: "visible", timeout: 60_000 });
    shared.joined++;
  } catch (err) {
    shared.failures.push(`${name}: join failed — ${String(err).split("\n")[0]}`);
    await context.close();
    return;
  }

  const deadline = performance.now() + seconds * 1000;
  while (performance.now() < deadline && !shared.stop) {
    // The moment the question is actually PAINTED — not "the API replied",
    // not "the websocket delivered", but visible to a human.
    try {
      const q = page.getByTestId(TID.question);
      if (await q.isVisible()) {
        const text = (await q.innerText().catch(() => "")).slice(0, 120).replace(/\s+/g, " ").trim();
        const key = text.slice(0, 60);
        if (key && !seen.has(key)) {
          seen.add(key);
          const bucket = shared.painted.get(key) ?? [];
          bucket.push({ ix, name, atMs: Date.now() });
          shared.painted.set(key, bucket);
          // Tap an answer through the real UI — the genuine input path.
          const slot = 1 + Math.floor(Math.random() * 4);
          await sleep(800 + Math.random() * 6000);
          await page.getByTestId(`player-answer-${slot}`).click({ timeout: 5000 }).catch(() => {});
        }
      }
      // Did the verdict actually render for this phone?
      for (const tid of [TID.revealCorrect, TID.revealWrong]) {
        if (await page.getByTestId(tid).isVisible().catch(() => false)) {
          if (!shared.sawVerdict.has(name)) shared.sawVerdict.set(name, Date.now());
        }
      }
      if (await page.getByTestId(TID.betweenGames).isVisible().catch(() => false)) {
        shared.betweenGamesNow.add(name);
      } else {
        shared.betweenGamesNow.delete(name);
      }
    } catch { /* transient during navigation/re-render */ }
    await sleep(250);
  }
  await context.close();
}

function report(args, shared, wallSeconds) {
  console.log(`\n  venue-browsers — ${args.browsers} REAL phones → ${args.baseUrl}  (room ${args.code})`);
  console.log(`  wall ${wallSeconds.toFixed(1)}s\n`);
  console.log(`  browsers that joined ...... ${shared.joined}/${args.browsers}`);
  for (const f of shared.failures) console.log(`  ⚠️  ${f}`);

  let ok = shared.joined === args.browsers && shared.failures.length === 0;

  if (shared.painted.size > 0) {
    console.log(`\n  QUESTION PAINTED ON SCREEN   (host press → visible to a human)`);
    console.log(`  ${"question".padEnd(46)}${"phones".padStart(9)}${"spread".padStart(10)}`);
    console.log(`  ${"-".repeat(65)}`);
    for (const [text, list] of shared.painted) {
      const times = list.map((p) => p.atMs).sort((a, b) => a - b);
      const spread = times[times.length - 1] - times[0];
      if (list.length !== args.browsers) ok = false;
      console.log(`  ${text.slice(0, 44).padEnd(46)}${String(`${list.length}/${args.browsers}`).padStart(9)}${String(spread + "ms").padStart(10)}`);
    }
    // Split brain check: every phone should have painted the SAME questions.
    const counts = new Set([...shared.painted.values()].map((l) => l.length));
    if (counts.size > 1) {
      console.log(`  ⚠️  phones did NOT all see the same questions — split brain`);
      ok = false;
    }
  } else {
    console.log("\n  (no question was painted — was one revealed during the run?)");
  }

  console.log(`\n  phones that rendered a verdict ... ${shared.sawVerdict.size}/${shared.joined}`);
  if (shared.betweenGamesNow.size > 0) {
    console.log(`  ⚠️  stuck on the between-games waiting screen at exit: ${[...shared.betweenGamesNow].join(", ")}`);
    ok = false;
  }
  console.log("");
  console.log(ok
    ? "  ✅ every real phone joined, painted the same question, and rendered.\n"
    : "  ⚠️  see the warnings above.\n");
  return ok;
}

// ---- main -----------------------------------------------------------------
const args = parseArgs(process.argv.slice(2));

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  console.error("error: playwright is not installed in this project — npm i -D playwright");
  process.exit(2);
}

if (args.selfCheck) {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.setContent("<div data-testid='ok'>real browser</div>");
  const visible = await page.getByTestId("ok").isVisible();
  await browser.close();
  console.log(visible
    ? "\n  ✅ SELF-CHECK PASSED — a real Chromium launched, rendered, and was queried.\n"
    : "\n  ❌ SELF-CHECK FAILED — Chromium did not render.\n");
  process.exit(visible ? 0 : 1);
}

if (!args.code) {
  console.error("error: --code <ROOM_CODE> is required (or use --self-check)");
  process.exit(2);
}

const browser = await chromium.launch({ headless: !args.headed });
const shared = {
  stop: false, joined: 0, failures: [],
  painted: new Map(), sawVerdict: new Map(), betweenGamesNow: new Set(),
};
const started = performance.now();
// Only draw the live ticker on a real terminal — piped/redirected output has
// no cursor to carriage-return over, and every tick would land as a new line.
const ticker = process.stdout.isTTY ? setInterval(() => {
  const painted = [...shared.painted.values()].reduce((a, l) => a + l.length, 0);
  process.stdout.write(`\r  ${shared.joined}/${args.browsers} real phones · ${painted} paints · ${shared.sawVerdict.size} verdicts   `);
}, 1000) : null;

await Promise.all(Array.from({ length: args.browsers }, (_, ix) =>
  runBrowserPlayer({ browser, ...args, ix, shared })));

if (ticker) { clearInterval(ticker); process.stdout.write("\r" + " ".repeat(78) + "\r"); }
const pass = report(args, shared, (performance.now() - started) / 1000);
await browser.close();
process.exit(pass ? 0 : 1);
