import { describe, expect, it } from "vitest";
import { classifyNights } from "@/lib/host/classifyNights";
import { hiddenEmptyTwinIds, twinCandidateIds, type TwinNight } from "@/lib/host/nightTwins";

// A night exactly as a tap on "+ Plan a new night" stores it.
const night = (
  id: string,
  created_at: string,
  opened_at: string | null = null,
  extra: Partial<TwinNight> = {},
): TwinNight => ({
  id,
  created_at,
  opened_at,
  closed_at: null,
  venue_name: "Soul Fire Pizza",
  theme_key: null,
  scheduled_at: null,
  room_magic_enabled: false,
  is_locked: false,
  current_run_id: null,
  answer_engine_latched_at: null,
  room_revision: 0,
  control_revision: 0,
  ...extra,
});
const EMPTY_COUNTS = { categories: 0, players: 0 };

// Heather's real nights (newest first), Oct 8 2026.
const BUILT = night("0993af1d", "2026-10-08T16:46:07.596Z");
const EMPTY = night("14a0091e", "2026-10-08T16:46:06.524Z");
const LAST_WEEK = night("be6ad300", "2026-10-03T15:08:55.638Z", "2026-10-07T23:17:35Z");
const MAY_EMPTY = night("b12d1ff1", "2026-05-29T20:50:37.730Z");

describe("empty twin nights on the host dashboard", () => {
  it("only asks for counts on never-opened nights that have a near neighbour", () => {
    expect(twinCandidateIds([BUILT, EMPTY, LAST_WEEK, MAY_EMPTY])).toEqual([
      "0993af1d",
      "14a0091e",
    ]);
  });

  it("hides Heather's empty older twin and keeps the night she built in", () => {
    const content = {
      "0993af1d": { categories: 12, players: 0 },
      "14a0091e": { categories: 0, players: 0 },
    };
    const hidden = hiddenEmptyTwinIds([BUILT, EMPTY, LAST_WEEK, MAY_EMPTY], content);
    expect([...hidden]).toEqual(["14a0091e"]);
    const visible = [BUILT, EMPTY, LAST_WEEK, MAY_EMPTY].filter((n) => !hidden.has(n.id));
    const { tonight, inSetup } = classifyNights(visible);
    expect(tonight?.id).toBe("0993af1d");
    // The lone empty May night is a real leftover, not a twin: still listed.
    expect(inSetup.map((n) => n.id)).toEqual(["b12d1ff1"]);
  });

  it("when the NEWER twin is the empty one, the headline becomes the one with content", () => {
    const builtFirst = night("aaaa", "2026-10-08T16:46:06.000Z");
    const emptySecond = night("bbbb", "2026-10-08T16:46:07.000Z");
    const nights = [emptySecond, builtFirst, LAST_WEEK];
    const hidden = hiddenEmptyTwinIds(nights, {
      aaaa: { categories: 3, players: 0 },
      bbbb: { categories: 0, players: 0 },
    });
    const { tonight } = classifyNights(nights.filter((n) => !hidden.has(n.id)));
    expect(tonight?.id).toBe("aaaa");
  });

  it("when both twins are empty, keeps exactly one (the newest)", () => {
    const a = night("a", "2026-05-25T11:58:56.066Z");
    const b = night("b", "2026-05-25T11:58:55.010Z");
    expect([...hiddenEmptyTwinIds([a, b], { a: { categories: 0, players: 0 }, b: { categories: 0, players: 0 } })]).toEqual(["b"]);
  });

  it("never hides a night with players, an opened night, or one whose counts are unknown", () => {
    const a = night("a", "2026-10-08T16:46:07.000Z");
    const b = night("b", "2026-10-08T16:46:06.000Z");
    expect(hiddenEmptyTwinIds([a, b], { a: { categories: 5, players: 0 }, b: { categories: 0, players: 2 } }).size).toBe(0);
    const opened = night("o", "2026-10-08T16:46:06.000Z", "2026-10-08T23:00:00Z");
    expect(hiddenEmptyTwinIds([a, opened], { a: { categories: 0, players: 0 } })).toEqual(new Set(["a"]));
    expect(hiddenEmptyTwinIds([a, b], {}).size).toBe(0);
  });

  it("never hides a second night planned on purpose a little later, even if both are empty", () => {
    // 30 seconds, 2 minutes, 9 minutes: all used to be "twins" (10-minute rule).
    for (const gapMs of [30_000, 120_000, 540_000]) {
      const first = night("first", "2026-10-08T16:40:00.000Z");
      const second = night("second", new Date(Date.parse(first.created_at) + gapMs).toISOString());
      const nights = [second, first];
      expect(twinCandidateIds(nights)).toEqual([]);
      expect(hiddenEmptyTwinIds(nights, { first: EMPTY_COUNTS, second: EMPTY_COUNTS }).size).toBe(0);
    }
    // The test host's 5.7s pair (May 25) is past the 5-second window too: both stay listed.
    const a = night("a", "2026-05-25T11:58:56.066Z");
    const b = night("b", "2026-05-25T11:58:50.353Z");
    expect(hiddenEmptyTwinIds([a, b], { a: EMPTY_COUNTS, b: EMPTY_COUNTS }).size).toBe(0);
  });

  it("never hides a twin the host touched (theme, room magic, date, lock, revisions)", () => {
    const built = night("built", "2026-10-08T16:46:07.596Z");
    const edits: Partial<TwinNight>[] = [
      { theme_key: "halloween" },
      { room_magic_enabled: true },
      { scheduled_at: "2026-10-16T00:00:00Z" },
      { is_locked: true },
      { room_revision: 1 },
      { control_revision: "2" },
      { answer_engine_latched_at: "2026-10-08T16:50:00Z" },
      { current_run_id: "run-1" },
      { room_revision: undefined }, // not known = keep it
    ];
    for (const edit of edits) {
      const twin = night("twin", "2026-10-08T16:46:06.524Z", null, edit);
      const content = { built: { categories: 12, players: 0 }, twin: EMPTY_COUNTS };
      expect(twinCandidateIds([built, twin]), JSON.stringify(edit)).toEqual(["built"]);
      expect(hiddenEmptyTwinIds([built, twin], content).size, JSON.stringify(edit)).toBe(0);
    }
  });

  it("never hides a twin made for another venue", () => {
    const built = night("built", "2026-10-08T16:46:07.596Z");
    const other = night("other", "2026-10-08T16:46:06.524Z", null, { venue_name: "Another Bar" });
    expect(
      hiddenEmptyTwinIds([built, other], { built: { categories: 12, players: 0 }, other: EMPTY_COUNTS }).size,
    ).toBe(0);
  });

  it("leaves nights alone when they are more than 10 minutes apart", () => {
    const a = night("a", "2026-10-08T17:00:00.000Z");
    const b = night("b", "2026-10-08T16:49:00.000Z");
    expect(twinCandidateIds([a, b])).toEqual([]);
    expect(hiddenEmptyTwinIds([a, b], { a: { categories: 0, players: 0 }, b: { categories: 0, players: 0 } }).size).toBe(0);
  });
});
