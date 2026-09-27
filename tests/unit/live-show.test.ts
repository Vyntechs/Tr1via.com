// lib/auth/live-show — "is this host running a show right now?"
//
// Proves (errs toward "running" on show day):
//   - opened in the last 12 hours and not closed → running
//   - created in the last 12 hours, room not opened yet (setup at the
//     venue) → running
//   - opened long ago but a game started in the window — live, or done and
//     on the break before the next game → running
//   - opened long ago but a category is being built in the window → running
//   - an old night that was never closed (every past production night),
//     with nothing recent → NOT running
//   - a closed night, another host's night, no host row → not running
//   - a database error → null (callers decide)

import { describe, expect, it, vi } from "vitest";
import { hostHasRunningShow } from "@/lib/auth/live-show";
import { fakeShowDb, openedNight } from "./helpers/fake-show-db";

const HOST = { id: "host-h", user_id: "user-h" };
const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();

function db(nights: object[], games: object[] = [], jobs: object[] = []) {
  return fakeShowDb({
    hosts: () => [HOST, { id: "host-other", user_id: "user-other" }],
    nights: () => nights as never,
    games: () => games as never,
    question_generation_jobs: () => jobs as never,
  });
}
const ask = (d: ReturnType<typeof fakeShowDb>, userId = "user-h") =>
  hostHasRunningShow(d as never, userId);

describe("hostHasRunningShow", () => {
  it("a night opened tonight and not closed → running", async () => {
    expect(await ask(db([openedNight("host-h", 1)]))).toBe(true);
  });

  it("last week's night, never closed (like every past prod night) → not running", async () => {
    expect(await ask(db([openedNight("host-h", 24 * 7)]))).toBe(false);
  });

  it("a closed night → not running", async () => {
    expect(
      await ask(db([openedNight("host-h", 1, { closed_at: new Date().toISOString() })])),
    ).toBe(false);
  });

  it("setup at the venue: created an hour ago, room not opened yet → running", async () => {
    expect(
      await ask(db([{ id: "n", host_id: "host-h", created_at: hoursAgo(1), opened_at: null, closed_at: null }])),
    ).toBe(true);
  });

  it("a night made days ago and never opened, nothing since → not running", async () => {
    expect(
      await ask(db([{ id: "n", host_id: "host-h", created_at: hoursAgo(72), opened_at: null, closed_at: null }])),
    ).toBe(false);
  });

  it("opened yesterday, but a game started an hour ago and is live → running", async () => {
    const night = openedNight("host-h", 30);
    const game = { id: "g1", night_id: night.id, state: "live", started_at: hoursAgo(1) };
    expect(await ask(db([night], [game]))).toBe(true);
  });

  it("the break between games: game 1 done, game 2 not started (room opened >12h ago) → running", async () => {
    const night = openedNight("host-h", 13);
    const games = [
      { id: "g1", night_id: night.id, state: "done", started_at: hoursAgo(2), ended_at: hoursAgo(0.2) },
      { id: "g2", night_id: night.id, state: "ready", started_at: null, ended_at: null },
    ];
    expect(await ask(db([night], games))).toBe(true);
  });

  it("a game from last week on an old unclosed night → not running", async () => {
    const night = openedNight("host-h", 24 * 7);
    const game = { id: "g1", night_id: night.id, state: "done", started_at: hoursAgo(24 * 7 - 1) };
    expect(await ask(db([night], [game]))).toBe(false);
  });

  it("setup on a night made days ago: a category built an hour ago → running", async () => {
    const night = { id: "n", host_id: "host-h", created_at: hoursAgo(72), opened_at: null, closed_at: null };
    const job = { id: "j", host_id: "host-h", night_id: "n", updated_at: hoursAgo(1) };
    expect(await ask(db([night], [], [job]))).toBe(true);
  });

  it("a category built recently for a CLOSED night doesn't count", async () => {
    const night = openedNight("host-h", 30, { closed_at: hoursAgo(20) });
    const job = { id: "j", host_id: "host-h", night_id: night.id, updated_at: hoursAgo(1) };
    expect(await ask(db([night], [], [job]))).toBe(false);
  });

  it("another host's show doesn't count", async () => {
    expect(await ask(db([openedNight("host-other", 1)]))).toBe(false);
  });

  it("no host row yet (still onboarding) → not running", async () => {
    expect(await ask(db([openedNight("host-h", 1)]), "user-new")).toBe(false);
  });

  it("database error → null", async () => {
    const d = db([openedNight("host-h", 1)]);
    d.fail = true;
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await ask(d)).toBeNull();
    log.mockRestore();
  });
});
