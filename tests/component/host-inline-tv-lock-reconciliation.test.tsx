import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RoomSnapshot } from "@/lib/hooks/useRoom";
import type {
  CategoryRow,
  GameRow,
  NightRow,
  PlayerRow,
  QuestionRow,
} from "@/lib/supabase/types";

const ceremony = vi.hoisted(() => ({
  renderedKeys: [] as string[][],
}));

vi.mock("@/components/tv", () => ({
  TVFinaleWinner: () => null,
  TVGrid: () => null,
  TVIntermission: () => null,
  TVLeaderboard: () => null,
  TVLobby: () => null,
  TVQuestion: () => null,
  TVReveal: () => null,
  TVRevealStumper: () => null,
}));

vi.mock("@/components/tv/TVLockInCeremony", () => ({
  TVLockInCeremony: ({ events }: { events: Array<{ playerId: string }> }) => {
    ceremony.renderedKeys.push(events.map((event) => event.playerId));
    return null;
  },
}));

vi.mock("@/lib/hooks/useTimer", () => ({
  useTimer: () => ({ displaySeconds: 30 }),
}));

vi.mock("@/components/system", () => ({ fireJuneBeat: () => undefined }));

import { TVStateMachine } from "@/components/tv/TVStateMachine";
import { roomToTVSnapshot } from "@/lib/host/roomToTVSnapshot";

const RAW_PLAYER_ID = "22222222-2222-4222-8222-222222222222";
const TV_PLAYER_KEY = "pk_tv_alice";

function hostRoom(): RoomSnapshot {
  return {
    night: {
      id: "night-1",
      venue_name: "Venue",
      theme_key: "may",
      room_code: "ABCDEF",
      opened_at: "2026-07-19T00:00:00.000Z",
      closed_at: null,
      scheduled_at: null,
      is_locked: false,
      room_magic_enabled: false,
    } as unknown as NightRow,
    hostDefaultThemeKey: "may",
    games: [{
      id: "game-1",
      game_no: 1,
      state: "live",
      started_at: "2026-07-19T00:00:00.000Z",
      ended_at: null,
      category_count: 1,
      question_count: 1,
    } as unknown as GameRow],
    categories: [{
      id: "category-1",
      game_id: "game-1",
      name: "Music",
      topic: "Music",
      position: 0,
      color: null,
      state: "ready",
    } as unknown as CategoryRow],
    players: [{
      id: RAW_PLAYER_ID,
      display_name: "Alice",
      joined_at: "2026-07-19T00:00:00.000Z",
      last_seen_at: "2026-07-19T00:00:01.000Z",
      removed_at: null,
    } as unknown as PlayerRow],
    currentGame: {
      id: "game-1",
      game_no: 1,
      state: "live",
    } as unknown as GameRow,
    currentQuestion: {
      id: "question-1",
      category_id: "category-1",
      point_value: 100,
      prompt: "Question?",
      options: ["A", "B", "C", "D"],
      correct_index: 0,
      image_url: null,
      fact_blurb: null,
      played_at: "2026-07-19T00:00:00.000Z",
      finished_at: null,
      is_picked: true,
    } as unknown as QuestionRow,
    lastResolvedQuestion: null,
    currentReveal: null,
    lastBroadcast: null,
    lastFireworksBeat: null,
    lastRoomMagicReaction: null,
    tvPlayerKeys: { [RAW_PLAYER_ID]: TV_PLAYER_KEY },
    isLoading: false,
  } as RoomSnapshot;
}

describe("host-inline TV lock identity reconciliation", () => {
  beforeEach(() => {
    ceremony.renderedKeys.length = 0;
    vi.restoreAllMocks();
  });

  it("dedupes an inline answer against the TV-scoped polling fallback", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        locks: [{ playerId: TV_PLAYER_KEY, msToLock: 1200, lockedAtMs: 1_000 }],
      }),
    } as Response);

    const snapshot = roomToTVSnapshot({
      room: hostRoom(),
      allQuestions: [],
      scores: [{
        player_id: RAW_PLAYER_ID,
        display_name: "Alice",
        score: 100,
        correct_count: 1,
        answered_count: 1,
        fastest_correct_ms: 1200,
      } as never],
      answers: [{
        id: "answer-1",
        question_id: "question-1",
        player_id: RAW_PLAYER_ID,
        ms_to_lock: 1200,
        is_correct: null,
        chosen_index: 0,
      }],
    });

    expect(snapshot).not.toBeNull();
    render(<TVStateMachine snapshot={snapshot!} themeKey="may" />);

    await waitFor(() => {
      const latest = ceremony.renderedKeys.at(-1) ?? [];
      expect(latest).toEqual([TV_PLAYER_KEY]);
    });
    expect(snapshot?.players[0]?.id).toBe(TV_PLAYER_KEY);
    expect(snapshot?.scores[0]?.player_key).toBe(TV_PLAYER_KEY);
    expect(snapshot?.liveAnswers[0]?.player_key).toBe(TV_PLAYER_KEY);
  });
});
