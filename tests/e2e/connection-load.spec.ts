// connection-load.spec.ts — a whole room loses the direct Supabase line at once.
//
// Opens N player phones, blocks every phone's direct browser→Supabase line at
// (nearly) the same instant — the worst case: a whole room's venue WiFi
// degrades together — reloads them together, and records each phone's
// `/api/room/:code/snapshot` request. Asserts every phone is still served
// through the route and lands back on the lobby with no "can't reach the
// server" screen. Logs the per-bin histogram + peak req/s.
//
// What changed in #146: this used to assert that the phones' BACKUP-MODE polls
// were spread by jitter. Since #146 a player never reads the direct line — the
// signed route is its only source — so players have no backup mode and no
// backup poll to jitter (useRoomRoutePoll runs for the host only). What is left
// is one bootstrap fetch per reload: the same shape as every reveal, where each
// phone refetches the route at once, which the venue-scale contract already
// treats as normal traffic (tests/concurrency/legacy-venue-load-contract.test.ts).
// The host's backup-poll jitter is still proven in tests/unit/poll-stampede.test.ts.
//
// N is parameterized via LOAD_N (default 8 — feasible locally). Raise LOAD_N on
// a beefier box to chart the server-load curve.

import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { loginAsHost, seedNight, resetTestData } from "./helpers/host-laptop";
import { joinPhone } from "./helpers/player-phone";
import { isDirectSupabaseRequest } from "./helpers/supabase-line";
import { TID } from "./helpers/selectors";

const HOST_EMAIL = "load-host@tr1via.test";
const N = Number(process.env.LOAD_N ?? 8);

test.describe.configure({ mode: "serial" });

test.describe("direct-line outage across a room — every phone stays served via the route", () => {
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

  test(`${N} phones lose the direct line at once and all stay served via the route`, async () => {
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

    // Record every /api/room/* response, per phone, and whether it served.
    const hits: Array<{ phone: number; at: number; ok: boolean }> = [];
    pages.forEach((p, phone) => {
      p.on("response", (res) => {
        if (res.url().includes("/api/room/")) hits.push({ phone, at: Date.now(), ok: res.ok() });
      });
    });

    // Block ALL phones' direct line at once, then reload them together → the
    // worst-case simultaneous reconnect.
    await Promise.all(phones.map((c) => c.route(isDirectSupabaseRequest, (r) => r.abort())));
    const t0 = Date.now();
    await Promise.all(pages.map((p) => p.reload().catch(() => {})));

    // Observe ~14s.
    await pages[0].waitForTimeout(14_000);

    const after = hits.filter((h) => h.at >= t0);
    const rel = after.map((h) => h.at - t0).sort((a, b) => a - b);

    // Histogram in 500ms bins (logged so the traffic shape stays visible).
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
      `[load N=${N}] room-route responses=${rel.length}, maxBin(500ms)=${maxBin}, peak≈${peakReqPerSec} req/s\n` +
        [...bins.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([b, c]) => `  +${(b * BIN) / 1000}s: ${"#".repeat(c)} (${c})`)
          .join("\n"),
    );

    // Every phone was served through the route after the reconnect, and each
    // one is back on the lobby — none stranded on "can't reach the server".
    for (let phone = 0; phone < N; phone++) {
      expect(
        after.some((h) => h.phone === phone && h.ok),
        `phone ${phone + 1} was served by the route`,
      ).toBe(true);
    }
    for (const p of pages) {
      await expect(p.getByTestId(TID.playerLobby.root)).toBeVisible();
      await expect(p.getByTestId(TID.connection.playerUnreachable)).toHaveCount(0);
    }
  });
});
