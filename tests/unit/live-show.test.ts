// lib/auth/live-show — "is this host running a show right now?"
//
// Proves: a night that was opened in the last 12 hours and isn't closed is
// running; an old night that was never closed (every past production night)
// is NOT; a closed night isn't; an older-opened night with a game that
// started recently and is still live IS; other hosts' nights don't count;
// no host row → false; a database error → null (callers decide).

import { describe, expect, it, vi } from "vitest";
import { hostHasRunningShow } from "@/lib/auth/live-show";
import { fakeShowDb, openedNight } from "./helpers/fake-show-db";

const HOST = { id: "host-h", user_id: "user-h" };

function db(nights: object[], games: object[] = []) {
  return fakeShowDb({
    hosts: () => [HOST, { id: "host-other", user_id: "user-other" }],
    nights: () => nights as never,
    games: () => games as never,
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

  it("a night set up but never opened → not running", async () => {
    expect(await ask(db([{ id: "n", host_id: "host-h", opened_at: null, closed_at: null }]))).toBe(false);
  });

  it("opened yesterday, but a game started an hour ago and is live → running", async () => {
    const night = openedNight("host-h", 30);
    const game = {
      id: "g1",
      night_id: night.id,
      state: "live",
      started_at: new Date(Date.now() - 3600_000).toISOString(),
    };
    expect(await ask(db([night], [game]))).toBe(true);
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
