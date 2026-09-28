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
//   - scheduled for today (venue time, America/Chicago) or within 12h of
//     now, even if made long ago and never opened → running
//   - only the last week's nights are looked at: an unclosed night from
//     weeks ago is ignored, even with game activity
//   - show day: on a weekday she opened a room on in the last 5 weeks
//     (venue time), any not-closed night from the last week → running,
//     even before the room is opened (she sets up days ahead)
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
    // 8 days, not 7: a room opened exactly a week ago makes today her show day.
    expect(await ask(db([openedNight("host-h", 24 * 8)]))).toBe(false);
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
    // 6 days: inside the week, but not today's weekday (not show day).
    const night = openedNight("host-h", 24 * 6);
    const game = { id: "g1", night_id: night.id, state: "done", started_at: hoursAgo(24 * 6 - 1) };
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

  it("scheduled for tonight, made 10 days ago, never opened → running", async () => {
    const night = {
      id: "n",
      host_id: "host-h",
      created_at: hoursAgo(240),
      opened_at: null,
      scheduled_at: hoursAgo(-3),
      closed_at: null,
    };
    expect(await ask(db([night]))).toBe(true);
  });

  it("scheduled for today in Chicago, 14h away (morning check for a late show) → running", async () => {
    // 2026-09-30 08:00 Chicago (13:00Z); show at 22:00 Chicago (03:00Z next UTC day).
    const now = new Date("2026-09-30T13:00:00Z");
    const night = {
      id: "n",
      host_id: "host-h",
      created_at: "2026-09-01T00:00:00Z",
      opened_at: null,
      scheduled_at: "2026-10-01T03:00:00Z",
      closed_at: null,
    };
    expect(await hostHasRunningShow(db([night]) as never, "user-h", now)).toBe(true);
  });

  it("scheduled for another day (and nothing recent) → not running", async () => {
    const now = new Date("2026-09-30T13:00:00Z");
    const night = {
      id: "n",
      host_id: "host-h",
      created_at: "2026-09-25T00:00:00Z",
      opened_at: null,
      scheduled_at: "2026-10-02T00:30:00Z", // Oct 1, 19:30 Chicago
      closed_at: null,
    };
    expect(await hostHasRunningShow(db([night]) as never, "user-h", now)).toBe(false);
  });

  it("an unclosed night from weeks ago is ignored, even with a game started an hour ago", async () => {
    const night = openedNight("host-h", 24 * 21);
    const game = { id: "g1", night_id: night.id, state: "live", started_at: hoursAgo(1) };
    expect(await ask(db([night], [game]))).toBe(false);
  });

  it("a 3-day-old night with a game started an hour ago still counts", async () => {
    const night = openedNight("host-h", 72);
    const game = { id: "g1", night_id: night.id, state: "live", started_at: hoursAgo(1) };
    expect(await ask(db([night], [game]))).toBe(true);
  });

  describe("show day (learned from the rooms she opened)", () => {
    // Heather's real pattern: night made the Thursday before, room opened
    // Wednesday evening. Wed 2026-09-30 15:00 Chicago = 20:00Z.
    const wedAfternoon = new Date("2026-09-30T20:00:00Z");
    const lastWeek = {
      id: "last",
      host_id: "host-h",
      created_at: "2026-09-19T15:09:00Z",
      opened_at: "2026-09-23T21:36:00Z", // Wed Sep 23, 16:36 Chicago
      closed_at: null,
    };
    const upcoming = {
      id: "next",
      host_id: "host-h",
      created_at: "2026-09-24T16:26:00Z", // Thu Sep 24
      opened_at: null,
      scheduled_at: null,
      closed_at: null,
    };

    it("Wednesday afternoon, room not opened yet, night made last Thursday → running", async () => {
      expect(await hostHasRunningShow(db([lastWeek, upcoming]) as never, "user-h", wedAfternoon)).toBe(true);
    });

    it("the same nights on Tuesday → not running (she can be asked)", async () => {
      const tue = new Date("2026-09-29T20:00:00Z");
      expect(await hostHasRunningShow(db([lastWeek, upcoming]) as never, "user-h", tue)).toBe(false);
    });

    it("a CLOSED past night still teaches her show day", async () => {
      const closed = { ...lastWeek, closed_at: "2026-09-24T02:00:00Z" };
      expect(await hostHasRunningShow(db([closed, upcoming]) as never, "user-h", wedAfternoon)).toBe(true);
    });

    it("show day but no night from the last week → not running", async () => {
      const oldOpened = { ...lastWeek, created_at: "2026-09-05T14:28:00Z", opened_at: "2026-09-09T23:37:00Z" };
      expect(await hostHasRunningShow(db([oldOpened]) as never, "user-h", wedAfternoon)).toBe(false);
    });

    it("a room opened more than 5 weeks ago doesn't set show day", async () => {
      const ancient = { ...lastWeek, id: "old", created_at: "2026-08-15T00:00:00Z", opened_at: "2026-08-19T23:00:00Z" };
      expect(await hostHasRunningShow(db([ancient, upcoming]) as never, "user-h", wedAfternoon)).toBe(false);
    });

    it("another host's show day doesn't count", async () => {
      const theirs = { ...lastWeek, host_id: "host-other" };
      expect(await hostHasRunningShow(db([theirs, upcoming]) as never, "user-h", wedAfternoon)).toBe(false);
    });

    it("show day uses venue time: Wednesday 9pm Chicago is still Wednesday (Thursday in UTC)", async () => {
      const wedNight = new Date("2026-10-01T02:00:00Z"); // Wed Sep 30, 21:00 Chicago
      expect(await hostHasRunningShow(db([lastWeek, upcoming]) as never, "user-h", wedNight)).toBe(true);
    });
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
