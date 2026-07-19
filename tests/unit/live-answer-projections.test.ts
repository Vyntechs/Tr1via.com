import { describe, expect, it } from "vitest";

import {
  projectHostLiveRoom,
  projectLiveRoom,
  projectPlayerLiveRoom,
} from "@/lib/live-answer/projectPlay";

const night = {
  current_run_id: "run-1",
  room_revision: 8,
  control_revision: 5,
};

const play = {
  id: "play-1",
  game_id: "game-1",
  question_id: "question-1",
  status: "accepting",
  opened_at: "2026-07-19T01:00:00.000Z",
  main_zero_at: "2026-07-19T01:00:30.000Z",
  final_window_starts_at: null,
  final_window_ends_at: "2026-07-19T01:00:32.000Z",
  finalize_at: null,
  eligible_count: 3,
  confirmed_count: 1,
};

const eligibility = {
  play_id: "play-1",
  player_id: "player-1",
  night_id: "night-1",
  frozen_at: "2026-07-19T01:00:00.000Z",
};

const answer = {
  play_id: "play-1",
  player_id: "player-1",
  submission_id: "submission-secret",
  visible_slot: 3,
  canonical_index: 1,
  received_at: "2026-07-19T01:00:04.000Z",
  locked_at: "2026-07-19T01:00:04.000Z",
  ms_to_lock: 4_000,
  is_correct: null,
  awarded_points: null,
  device_id: "device-secret",
  eligibility_reason: "internal-secret",
};

describe("live answer audience projections", () => {
  it("projects the common canonical play without internal ancestry or identity fields", () => {
    const projected = projectLiveRoom({ night, play });

    expect(projected).toEqual({
      runId: "run-1",
      roomRevision: 8,
      controlRevision: 5,
      playId: "play-1",
      play: {
        playId: "play-1",
        gameId: "game-1",
        questionId: "question-1",
        state: "accepting",
        openedAt: "2026-07-19T01:00:00.000Z",
        mainZeroAt: "2026-07-19T01:00:30.000Z",
        finalWindowStartsAt: null,
        finalWindowEndsAt: "2026-07-19T01:00:32.000Z",
        finalizeAt: null,
        eligibleCount: 3,
        confirmedCount: 1,
      },
    });
    expect(JSON.stringify(projected)).not.toContain("night-1");
  });

  it("gives an eligible signed player only their frozen bit and canonical saved answer", () => {
    const projected = projectPlayerLiveRoom({ night, play, eligibility, answer });

    expect(projected.canAnswerThisPlay).toBe(true);
    expect(projected.canonicalAnswer).toEqual({
      confirmedSlot: 3,
      canonicalIndex: 1,
      receivedAt: "2026-07-19T01:00:04.000Z",
      lockedAt: "2026-07-19T01:00:04.000Z",
      msToLock: 4_000,
      isCorrect: null,
      awardedPoints: null,
    });
    const json = JSON.stringify(projected);
    expect(json).not.toContain("player-1");
    expect(json).not.toContain("submission-secret");
    expect(json).not.toContain("device-secret");
    expect(json).not.toContain("internal-secret");
  });

  it("makes a late join watch-only for the already-open play", () => {
    const projected = projectPlayerLiveRoom({
      night,
      play,
      eligibility: null,
      answer: null,
    });

    expect(projected.canAnswerThisPlay).toBe(false);
    expect(projected.canonicalAnswer).toBeNull();
  });

  it("keeps a removed player eligible when their immutable frozen row exists", () => {
    const projected = projectPlayerLiveRoom({
      night,
      play,
      eligibility,
      answer: null,
    });

    expect(projected.canAnswerThisPlay).toBe(true);
  });

  it("adds only aggregate operational counts to the host projection", () => {
    const projected = projectHostLiveRoom({ night, play });

    expect(projected.operations).toEqual({
      eligibleCount: 3,
      confirmedCount: 1,
      awaitingCount: 2,
    });
    expect(JSON.stringify(projected)).not.toContain("player-1");
  });
});
