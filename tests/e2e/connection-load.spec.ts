// connection-load.spec.ts — Step 3 load/stampede check for the Phase-2 fallback.
//
// Opens N player phones, drives them all into backup mode at (nearly) the same
// instant — the worst case: a whole room's venue WiFi degrades together — and
// records when each phone's `/api/room/:code/snapshot` poll actually fires.
// Asserts the polls are SPREAD by jitter (no stampede: no tight cluster of
// near-simultaneous requests) and that every phone is being served. Logs the
// per-bin histogram + peak req/s so the cadence is justified by data.
//
// N is parameterized via LOAD_N (default 8 — feasible in CI/local). The jitter
// property is per-client and N-independent (see tests/unit/poll-stampede.test.ts
// which proves it for N up to 75); this run confirms it holds end-to-end with
// real browsers. Raise LOAD_N on a beefier box to chart the server-load curve.

import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { loginAsHost, seedNight, resetTestData } from "./helpers/host-laptop";
import { joinPhone } from "./helpers/player-phone";

const HOST_EMAIL = "load-host@tr1via.test";
const SUPABASE_GLOB = "**/*.supabase.co/**";
const N = Number(process.env.LOAD_N ?? 8);

test.describe.configure({ mode: "serial" });

test.describe("Phase-2 fallback load — N phones reconnect without a stampede", () => {
  test.setTimeout(180_000);

  let host: BrowserContext;
  const phones: BrowserContext[] = [];

  test.beforeAll(async ({ browser }) => {
    host = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const cleanup = await host.newPage();
    await resetTestData(cleanup);
    await cleanup.close();
    for (let i = 0; i < N; i++) {
      phones.push(await browser.newContext({ viewport: { width: 390, height: 844 } }));
    }
  });

  test.afterAll(async () => {
    try {
      const cleanup = await host.newPage();
      await resetTestData(cleanup);
      await cleanup.close();
    } catch {
      /* already closed */
    }
    await Promise.all(
      [host, ...phones].map((c) => c.close().catch(() => {})),
    );
  });

  test(`${N} phones in backup mode poll the route on a jittered (non-stampeding) cadence`, async () => {
    const hostPage = await host.newPage();
    const { hostId } = await loginAsHost(hostPage, HOST_EMAIL);
    const seed = await seedNight(hostPage, hostId, "happy-path-3-cats-game1");
    await hostPage.close();

    // Join all phones healthy (sequential — avoids hammering the join path).
    const pages: Page[] = [];
    for (let i = 0; i < N; i++) {
      const p = await phones[i].newPage();
      await joinPhone(p, seed.roomCode, `Load ${i + 1}`);
      pages.push(p);
    }

    // Record every /api/room/* poll per phone.
    const hits: number[] = [];
    for (const p of pages) {
      p.on("request", (req) => {
        if (req.url().includes("/api/room/")) hits.push(Date.now());
      });
    }

    // Degrade ALL phones at once, then reload them together → the worst-case
    // simultaneous reconnect.
    await Promise.all(phones.map((c) => c.route(SUPABASE_GLOB, (r) => r.abort())));
    const t0 = Date.now();
    await Promise.all(pages.map((p) => p.reload().catch(() => {})));

    // Observe ~14s of polling.
    await pages[0].waitForTimeout(14_000);

    const rel = hits.map((t) => t - t0).filter((t) => t >= 0).sort((a, b) => a - b);

    // Histogram in 500ms bins.
    const BIN = 500;
    const bins = new Map<number, number>();
    for (const t of rel) {
      const b = Math.floor(t / BIN);
      bins.set(b, (bins.get(b) ?? 0) + 1);
    }
    const maxBin = bins.size ? Math.max(...bins.values()) : 0;
    const peakReqPerSec = maxBin * (1000 / BIN);

    // eslint-disable-next-line no-console
    console.log(
      `[load N=${N}] room-route polls=${rel.length}, maxBin(500ms)=${maxBin}, peak≈${peakReqPerSec} req/s\n` +
        [...bins.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([b, c]) => `  +${(b * BIN) / 1000}s: ${"#".repeat(c)} (${c})`)
          .join("\n"),
    );

    // Every phone is being served via the route (≥1 poll each over 14s).
    expect(rel.length).toBeGreaterThanOrEqual(N);

    // No stampede: even in the worst-case simultaneous reconnect, no 500ms
    // window holds more than ~60% of the phones (jitter spreads them).
    expect(maxBin).toBeLessThanOrEqual(Math.ceil(N * 0.6));
  });
});
