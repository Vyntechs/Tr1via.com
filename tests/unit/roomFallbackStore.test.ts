// roomFallbackStore — module store that holds the latest server-route payload +
// the backup-mode flag, so every consumer (useRoom + the aux hooks) reads from
// ONE fetched payload instead of each making its own request during a degraded
// window.

import { describe, it, expect, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  publishRoomFallback,
  setBackupMode,
  getRoomFallback,
  useRoomFallback,
  __resetRoomFallbackForTests,
} from "@/lib/room/roomFallbackStore";
import type { RoomSnapshotPayload } from "@/lib/room/roomSnapshotPayload";

afterEach(() => __resetRoomFallbackForTests());

const payload = (tag: string): RoomSnapshotPayload => ({
  audience: "player",
  night: null,
  hostDefaultThemeKey: null,
  games: [],
  categories: [],
  players: [],
  currentQuestion: null,
  lastResolvedQuestion: null,
  currentReveal: null,
  allQuestions: [],
  allScores: [],
  scores: [],
  self: {
    playerKey: `player-${tag}`,
    displayName: "Alice",
    joinedAt: "2026-06-07T00:00:00Z",
    lastSeenAt: "2026-06-07T00:00:00Z",
    removedAt: null,
    appSwitchTotalSeconds: 0,
  },
  myAnswers: [{
    questionId: "question-1",
    chosenIndex: 2,
    scramble: [2, 0, 3, 1],
    lockedAt: "2026-06-07T00:00:01Z",
    msToLock: 800,
    isCorrect: null,
    awardedPoints: null,
  }],
  myParticipations: [],
  questionScrambles: {},
});

describe("roomFallbackStore", () => {
  it("starts not-in-backup-mode with no payload", () => {
    expect(getRoomFallback()).toEqual({ backupMode: false, payload: null });
    const { result } = renderHook(() => useRoomFallback());
    expect(result.current.backupMode).toBe(false);
    expect(result.current.payload).toBeNull();
  });

  it("notifies subscribers when backup mode turns on and a payload publishes", () => {
    const { result } = renderHook(() => useRoomFallback());
    act(() => setBackupMode(true));
    act(() => publishRoomFallback(payload("n1")));
    expect(result.current.backupMode).toBe(true);
    expect(result.current.payload).not.toBeNull();
  });

  it("adapts a player's canonical locked answer with its own scramble intact", () => {
    act(() => {
      setBackupMode(true);
      publishRoomFallback(payload("n1"));
    });

    expect(getRoomFallback().payload?.myAnswers).toEqual([{
      id: "answer:question-1",
      question_id: "question-1",
      player_id: "player-n1",
      chosen_index: 2,
      scramble: [2, 0, 3, 1],
      locked_at: "2026-06-07T00:00:01Z",
      ms_to_lock: 800,
      is_correct: null,
      awarded_points: null,
    }]);
  });

  it("clears the payload when backup mode turns off (recovery)", () => {
    const { result } = renderHook(() => useRoomFallback());
    act(() => {
      setBackupMode(true);
      publishRoomFallback(payload("n1"));
    });
    act(() => setBackupMode(false));
    expect(result.current.backupMode).toBe(false);
    expect(result.current.payload).toBeNull();
  });

  it("does not re-notify when backup mode is set to its current value", () => {
    let renders = 0;
    renderHook(() => {
      renders += 1;
      return useRoomFallback();
    });
    const before = renders;
    act(() => setBackupMode(false));
    expect(renders).toBe(before); // unchanged value → no extra render
  });
});
