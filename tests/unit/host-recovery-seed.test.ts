import { describe, it, expect } from "vitest";
import { hostRecoverySeed } from "@/lib/room/hostRecoverySeed";
import type { RoomFallbackPayload } from "@/lib/room/roomSnapshotPayload";

// A payload carrying 3 live answers — i.e. a "3 locked in" count the ~5s route
// poll kept current while the host was on degraded WiFi.
const payload = {
  night: null,
  hostDefaultThemeKey: null,
  games: [],
  categories: [],
  players: [],
  currentQuestion: null,
  lastResolvedQuestion: null,
  currentReveal: null,
  liveAnswers: [
    {
      id: "a1",
      question_id: "q1",
      player_id: "p1",
      chosen_index: 0,
      scramble: [0, 1, 2, 3],
      locked_at: "",
      ms_to_lock: 100,
      is_correct: null,
      awarded_points: null,
    },
    {
      id: "a2",
      question_id: "q1",
      player_id: "p2",
      chosen_index: 0,
      scramble: [0, 1, 2, 3],
      locked_at: "",
      ms_to_lock: 200,
      is_correct: null,
      awarded_points: null,
    },
    {
      id: "a3",
      question_id: "q1",
      player_id: "p3",
      chosen_index: 0,
      scramble: [0, 1, 2, 3],
      locked_at: "",
      ms_to_lock: 300,
      is_correct: null,
      awarded_points: null,
    },
  ],
  scores: [],
  allScores: [],
  allQuestions: [],
  myAnswers: [],
  myParticipations: [],
  roomMagicReactions: [],
  tvPlayerKeys: {},
} satisfies RoomFallbackPayload;

describe("hostRecoverySeed — host board not stale after WiFi recovery (#3)", () => {
  it("returns the last route payload on a backup→direct (recovery) transition", () => {
    const seed = hostRecoverySeed(true, false, payload);
    expect(seed).toBe(payload);
    // The console seeds its lock count from this, so it reads 3 (current), not
    // the stale frozen direct value.
    expect(seed?.liveAnswers.length).toBe(3);
  });

  it("returns null when ENTERING backup mode (direct→backup)", () => {
    expect(hostRecoverySeed(false, true, payload)).toBeNull();
  });

  it("returns null when backup mode is unchanged", () => {
    expect(hostRecoverySeed(true, true, payload)).toBeNull();
    expect(hostRecoverySeed(false, false, payload)).toBeNull();
  });

  it("returns null on recovery when no payload was captured", () => {
    expect(hostRecoverySeed(true, false, null)).toBeNull();
  });
});
