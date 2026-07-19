// roomSnapshotPayload — the server-route fallback's wire contract.
//
//  - serializeRoomQuestion: withholds correct_index for any question that
//    isn't RESOLVED (finished_at null) — the same security rule the public TV
//    feed enforces (serializeBoardQuestion / 2026-06-06 pentest). A live or
//    unplayed question must never ship its answer to a player's device.
//  - payloadToRoomSnapshot: maps the route payload into the exact RoomSnapshot
//    shape useRoom already produces, so the fallback is a drop-in.

import { describe, it, expect } from "vitest";
import {
  serializeRoomQuestion,
  payloadToRoomSnapshot,
  type RoomSnapshotPayload,
} from "@/lib/room/roomSnapshotPayload";
import type { GameRow, QuestionRow } from "@/lib/supabase/types";

function rawQuestion(over: Partial<QuestionRow> & { id: string }): QuestionRow {
  return {
    category_id: "c1",
    difficulty: 3,
    fact_blurb: null,
    image_attribution: null,
    image_source: null,
    image_url: null,
    is_picked: true,
    options: ["a", "b", "c", "d"],
    played_at: over.played_at ?? null,
    finished_at: over.finished_at ?? null,
    point_value: 300,
    prompt: "P",
    source: null,
    correct_index: 2,
    ...over,
  } as QuestionRow;
}

describe("serializeRoomQuestion — correct_index gating", () => {
  it("omits correctIndex for an unplayed question", () => {
    const q = serializeRoomQuestion(rawQuestion({ id: "q", played_at: null, finished_at: null, correct_index: 2 }));
    expect(q).not.toHaveProperty("correctIndex");
  });

  it("omits correctIndex for a LIVE (played, not finished) question", () => {
    const q = serializeRoomQuestion(
      rawQuestion({ id: "q", played_at: "2026-06-07T00:00:00Z", finished_at: null, correct_index: 1 }),
    );
    expect(q).not.toHaveProperty("correctIndex");
  });

  it("exposes correct_index once the question is RESOLVED", () => {
    const q = serializeRoomQuestion(
      rawQuestion({
        id: "q",
        played_at: "2026-06-07T00:00:00Z",
        finished_at: "2026-06-07T00:00:20Z",
        correct_index: 3,
      }),
    );
    expect(q.correctIndex).toBe(3);
  });

  it("preserves all non-answer fields", () => {
    const raw = rawQuestion({ id: "q", prompt: "Who?" });
    const q = serializeRoomQuestion(raw);
    expect(q.id).toBe("q");
    expect(q.prompt).toBe("Who?");
    expect(q.options).toEqual(["a", "b", "c", "d"]);
  });

  it("fails closed when an admin row grows browser-identity, submission, or live-answer fields", () => {
    const row = rawQuestion({ id: "q", played_at: "2026-06-07T00:00:00Z", finished_at: null });
    Object.assign(row as Record<string, unknown>, {
      device_id: "DEVICE-ID-LEAK",
      submission_id: "SUBMISSION-ID-LEAK",
    });

    const json = JSON.stringify(serializeRoomQuestion(row));
    expect(json).not.toContain("DEVICE-ID-LEAK");
    expect(json).not.toContain("SUBMISSION-ID-LEAK");
    expect(json).not.toContain('"correctIndex"');
  });
});

describe("payloadToRoomSnapshot", () => {
  const game = (over: Partial<GameRow> & { id: string; state: GameRow["state"] }): GameRow =>
    ({
      id: over.id,
      night_id: "n1",
      game_no: over.game_no ?? 1,
      state: over.state,
      started_at: null,
      ended_at: over.ended_at ?? null,
      category_count: 0,
      question_count: 0,
    }) as GameRow;

  const basePayload = (): RoomSnapshotPayload => ({
    night: { nightKey: "night-key-1" } as Extract<RoomSnapshotPayload, { audience: "player" }>["night"],
    hostDefaultThemeKey: "house",
    games: [game({ id: "g1", game_no: 1, state: "done", ended_at: "2026-01-01T00:00:00Z" }), game({ id: "g2", game_no: 2, state: "live" })],
    categories: [],
    players: [],
    currentQuestion: null,
    lastResolvedQuestion: null,
    currentReveal: null,
    allQuestions: [],
    allScores: [],
    audience: "player",
    self: {
      playerKey: "player-key-1",
      displayName: "Player",
      joinedAt: "2026-01-01T00:00:00Z",
      lastSeenAt: "2026-01-01T00:00:00Z",
      removedAt: null,
      appSwitchTotalSeconds: 0,
    },
    myAnswers: [],
    myParticipations: [],
    questionScrambles: {},
    scores: [],
  });

  it("derives currentGame via pickCurrentGame (live wins)", () => {
    const snap = payloadToRoomSnapshot(basePayload());
    expect(snap.currentGame?.id).toBe("g2");
  });

  it("marks the snapshot loaded with no broadcast", () => {
    const snap = payloadToRoomSnapshot(basePayload());
    expect(snap.isLoading).toBe(false);
    expect(snap.lastBroadcast).toBeNull();
    expect(snap.lastRoomMagicReaction).toBeNull();
    expect(snap.self?.id).toBe("player-key-1");
  });

  it("passes night/games/categories/players through unchanged", () => {
    const p = basePayload();
    const snap = payloadToRoomSnapshot(p);
    expect(snap.night?.id).toBe("night-key-1");
    expect(snap.games).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "g1", night_id: "night-key-1" }),
    ]));
    expect(snap.hostDefaultThemeKey).toBe("house");
  });
});
