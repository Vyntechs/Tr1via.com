// @vitest-environment node
import { describe, expect, it } from "vitest";

import { LIVE_WAIT_MS, POLL_MS, runPreshow, TICK_WAIT_MS } from "../../scripts/live-clock-preshow-run.mjs";

type Result = {
  ok: boolean;
  problems: string[];
  liveGames?: number;
  mode?: string;
  lastTickAt?: string | null;
};

const idle: Result = { ok: true, problems: [], liveGames: 0, mode: "on", lastTickAt: null };
const ticking: Result = { ok: true, problems: [], liveGames: 1, mode: "on", lastTickAt: "T" };
const notTicking: Result = { ok: false, problems: ["job is not ticking"], liveGames: 1 };

/** Plays back the results in turn, and repeats the last one. */
function run(results: Result[], { once = false } = {}) {
  let clock = 0;
  let calls = 0;
  const lines: string[] = [];
  const code = runPreshow({
    check: async () => results[Math.min(calls++, results.length - 1)],
    sleep: async (ms: number) => void (clock += ms),
    now: () => clock,
    log: (line: string) => void lines.push(line),
    once,
  });
  return { code, lines, calls: () => calls, elapsed: () => clock };
}

describe("runPreshow", () => {
  it("fails at once when the first check fails with no game live", async () => {
    const r = run([{ ok: false, problems: ["job tr1via-close-due is not scheduled"], liveGames: 0 }]);
    expect(await r.code).toBe(1);
    expect(r.lines).toEqual(["FAIL job tr1via-close-due is not scheduled"]);
    expect(r.calls()).toBe(1);
  });

  it("doesn't call a no-game pass finished: it checks again once a game is live", async () => {
    const r = run([idle, idle, ticking]);
    expect(await r.code).toBe(0);
    expect(r.calls()).toBe(3);
    expect(r.lines.at(-1)).toBe("PASS mode on, 1 live games, last tick T");
  });

  it("fails when the game goes live and the sweep never ticks", async () => {
    const r = run([idle, notTicking]);
    expect(await r.code).toBe(1);
    expect(r.lines.at(-1)).toBe("FAIL job is not ticking");
    expect(r.elapsed()).toBeGreaterThanOrEqual(TICK_WAIT_MS);
  });

  it("gives the gate its minute to start the sweep after go-live", async () => {
    const r = run([idle, notTicking, notTicking, ticking]);
    expect(await r.code).toBe(0);
    expect(r.elapsed()).toBe(3 * POLL_MS);
  });

  it("keeps waiting through a failed call while no game is live", async () => {
    const r = run([idle, { ok: false, problems: ["could not run the check: x"] }, ticking]);
    expect(await r.code).toBe(0);
  });

  it("fails if no game goes live, because the tick was never proven", async () => {
    const r = run([idle]);
    expect(await r.code).toBe(1);
    expect(r.lines.at(-1)).toBe("FAIL no game went live, so the tick was never proven");
    expect(r.elapsed()).toBeGreaterThanOrEqual(LIVE_WAIT_MS);
  });

  it("--once runs a single check and says the tick isn't proven", async () => {
    const r = run([idle], { once: true });
    expect(await r.code).toBe(0);
    expect(r.calls()).toBe(1);
    expect(r.lines).toEqual([
      "PASS mode on, 0 live games, tick not proven until a game is live, check again then",
    ]);
  });
});
