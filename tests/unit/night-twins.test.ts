import { describe, expect, it } from "vitest";
import { classifyNights } from "@/lib/host/classifyNights";
import { hiddenEmptyTwinIds, twinCandidateIds, type TwinNight } from "@/lib/host/nightTwins";

const night = (id: string, created_at: string, opened_at: string | null = null): TwinNight => ({
  id,
  created_at,
  opened_at,
  closed_at: null,
});

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
    const b = night("b", "2026-05-25T11:58:50.353Z");
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

  it("leaves nights alone when they are more than 10 minutes apart", () => {
    const a = night("a", "2026-10-08T17:00:00.000Z");
    const b = night("b", "2026-10-08T16:49:00.000Z");
    expect(twinCandidateIds([a, b])).toEqual([]);
    expect(hiddenEmptyTwinIds([a, b], { a: { categories: 0, players: 0 }, b: { categories: 0, players: 0 } }).size).toBe(0);
  });
});
