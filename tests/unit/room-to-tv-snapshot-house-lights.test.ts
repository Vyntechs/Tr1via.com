import { describe, expect, it } from "vitest";
import { roomToTVSnapshot } from "@/lib/host/roomToTVSnapshot";
import type { RoomSnapshot } from "@/lib/hooks/useRoom";
import type {
  CategoryRow,
  GameRow,
  NightRow,
  PlayerRow,
  QuestionRow,
} from "@/lib/supabase/types";

describe("roomToTVSnapshot House Lights answer scoping", () => {
  it("drops stale answer rows from another question before TV House Lights counts them", () => {
    const room = {
      night: {
        id: "night-1",
        venue_name: "Venue",
        theme_key: "house",
        room_code: "ABCDEF",
        opened_at: "2026-06-30T00:00:00Z",
        closed_at: null,
        scheduled_at: null,
        is_locked: false,
        room_magic_enabled: true,
      } as unknown as NightRow,
      hostDefaultThemeKey: "house",
      games: [
        {
          id: "game-1",
          game_no: 1,
          state: "live",
          started_at: "2026-06-30T00:00:00Z",
          ended_at: null,
          category_count: 1,
          question_count: 7,
        } as unknown as GameRow,
      ],
      categories: [
        {
          id: "cat-1",
          game_id: "game-1",
          name: "Category",
          topic: "Topic",
          position: 1,
          color: null,
          state: "ready",
        } as unknown as CategoryRow,
      ],
      players: [
        {
          id: "player-1",
          display_name: "Alex",
          joined_at: "2026-06-30T00:00:00Z",
          last_seen_at: "2026-06-30T00:00:00Z",
          removed_at: null,
        } as unknown as PlayerRow,
        {
          id: "player-2",
          display_name: "Blair",
          joined_at: "2026-06-30T00:00:00Z",
          last_seen_at: "2026-06-30T00:00:00Z",
          removed_at: null,
        } as unknown as PlayerRow,
      ],
      currentGame: {
        id: "game-1",
        game_no: 1,
        state: "live",
        started_at: "2026-06-30T00:00:00Z",
        ended_at: null,
        category_count: 1,
        question_count: 7,
      } as unknown as GameRow,
      currentQuestion: {
        id: "q-live",
        category_id: "cat-1",
        point_value: 100,
        prompt: "Question?",
        options: ["A", "B", "C", "D"],
        correct_index: 0,
        image_url: null,
        fact_blurb: null,
        played_at: "2026-06-30T00:00:00Z",
        finished_at: null,
        is_picked: true,
      } as unknown as QuestionRow,
      lastResolvedQuestion: null,
      currentReveal: null,
      lastBroadcast: null,
      lastFireworksBeat: null,
      lastRoomMagicReaction: null,
      isLoading: false,
    } satisfies RoomSnapshot;

    const snapshot = roomToTVSnapshot({
      room,
      allQuestions: [],
      scores: [],
      answers: [
        {
          id: "answer-live",
          question_id: "q-live",
          player_id: "player-1",
          ms_to_lock: 700,
          is_correct: null,
          chosen_index: 0,
        },
        {
          id: "answer-stale",
          question_id: "q-old",
          player_id: "player-2",
          ms_to_lock: 800,
          is_correct: null,
          chosen_index: 1,
        },
      ],
    });

    expect(snapshot?.liveAnswers).toHaveLength(1);
    expect(snapshot?.liveAnswers[0]).toMatchObject({
      id: "answer-live",
      question_id: "q-live",
      player_id: "player-1",
    });
  });
});
