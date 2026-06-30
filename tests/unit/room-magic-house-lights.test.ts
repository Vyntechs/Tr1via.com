import { describe, expect, it } from "vitest";
import {
  countHouseLightsLocks,
  deriveHouseLightsPresence,
} from "@/lib/room-magic/house-lights";

describe("room magic house lights", () => {
  it("stays off when Room Magic is disabled", () => {
    expect(
      deriveHouseLightsPresence({
        roomMagicEnabled: false,
        lockedCount: 2,
        totalPlayers: 3,
      }),
    ).toBeNull();
  });

  it("derives clamped aggregate progress from valid lock counts", () => {
    expect(
      deriveHouseLightsPresence({
        roomMagicEnabled: true,
        lockedCount: 2,
        totalPlayers: 3,
      }),
    ).toEqual({
      lockedCount: 2,
      totalPlayers: 3,
      progressPct: 67,
      intensity: "medium",
      complete: false,
    });
  });

  it("hides when totals are impossible or malformed", () => {
    expect(
      deriveHouseLightsPresence({
        roomMagicEnabled: true,
        lockedCount: 4,
        totalPlayers: 3,
      }),
    ).toBeNull();
    expect(
      deriveHouseLightsPresence({
        roomMagicEnabled: true,
        lockedCount: -1,
        totalPlayers: 3,
      }),
    ).toBeNull();
    expect(
      deriveHouseLightsPresence({
        roomMagicEnabled: true,
        lockedCount: 1,
        totalPlayers: 0,
      }),
    ).toBeNull();
  });

  it("keeps zero locks valid but calm", () => {
    expect(
      deriveHouseLightsPresence({
        roomMagicEnabled: true,
        lockedCount: 0,
        totalPlayers: 5,
      }),
    ).toEqual({
      lockedCount: 0,
      totalPlayers: 5,
      progressPct: 0,
      intensity: "idle",
      complete: false,
    });
  });

  it("counts one lock per player for the active question only", () => {
    const answers = [
      { id: "a1", player_id: "p1", question_id: "q1" },
      { id: "a2", player_id: "p1", question_id: "q1" },
      { id: "a3", player_id: "p2", question_id: "q1" },
      { id: "a4", player_id: "p3", question_id: "q2" },
      { id: "a5", player_id: "", question_id: "q1" },
    ];

    expect(countHouseLightsLocks(answers, "q1")).toBe(2);
  });
});
