// Host phone and host console build their board with roomToTVSnapshot. The
// picked questions (which decide the winner of a doubled slot) load after
// first paint. Before this, a doubled slot was ranked with zero counts for a
// moment (state, then newest), so the newer EMPTY row's name flashed in the
// header and then flipped to the filled older row. Now the slot waits.

import { describe, expect, it } from "vitest";
import { roomToTVSnapshot } from "@/lib/host/roomToTVSnapshot";
import type { RoomSnapshot } from "@/lib/hooks/useRoom";
import type { CategoryRow, GameRow, NightRow, QuestionRow } from "@/lib/supabase/types";

const base = { game_id: "game-1", color: null, state: "review" };
const filledOlder = { ...base, id: "a-filled", name: "Ghosts", topic: "Ghosts", position: 4, created_at: "2026-10-14T18:00:00Z" };
const emptyNewer = { ...base, id: "b-empty", name: "ghosts", topic: "ghosts", position: 4, created_at: "2026-10-14T18:01:00Z" };
const pumpkins = { ...base, id: "c-pumpkins", name: "Pumpkins", topic: "Pumpkins", position: 3, state: "ready", created_at: "2026-10-14T17:00:00Z" };

const game = {
  id: "game-1",
  game_no: 1,
  state: "ready",
  started_at: null,
  ended_at: null,
  category_count: 6,
  question_count: 7,
} as unknown as GameRow;

const room = {
  night: {
    id: "night-1",
    venue_name: "Venue",
    theme_key: "house",
    room_code: "PF8NVJ",
    opened_at: "2026-10-14T23:00:00Z",
    closed_at: null,
    scheduled_at: null,
    is_locked: false,
    room_magic_enabled: false,
  } as unknown as NightRow,
  hostDefaultThemeKey: "house",
  games: [game],
  categories: [pumpkins, filledOlder, emptyNewer] as unknown as CategoryRow[],
  players: [],
  currentGame: game,
  currentQuestion: null,
  lastResolvedQuestion: null,
  currentReveal: null,
  lastBroadcast: null,
  lastFireworksBeat: null,
  lastRoomMagicReaction: null,
  tvPlayerKeys: {},
  isLoading: false,
} satisfies RoomSnapshot;

const picked = (id: string, categoryId: string) =>
  ({
    id,
    category_id: categoryId,
    point_value: 100,
    prompt: "Q?",
    options: ["A", "B", "C", "D"],
    correct_index: 0,
    image_url: null,
    fact_blurb: null,
    played_at: null,
    finished_at: null,
    is_picked: true,
  }) as unknown as QuestionRow;

describe("doubled slot on the host's own board while picked questions load", () => {
  it("shows neither row of the doubled slot before counts load (no wrong-row flash)", () => {
    const first = roomToTVSnapshot({
      room,
      allQuestions: [],
      scores: [],
      answers: [],
      pickedCountsReady: false,
    });
    const names = first?.categories.map((c) => c.name) ?? [];
    expect(names).toEqual(["Pumpkins"]);
    expect(names).not.toContain("ghosts");
  });

  it("shows the filled row once counts are in, and never the empty one", () => {
    const loaded = roomToTVSnapshot({
      room,
      allQuestions: [picked("q1", filledOlder.id), picked("q2", filledOlder.id)],
      scores: [],
      answers: [],
      pickedCountsReady: true,
    });
    expect(loaded?.categories.map((c) => c.name)).toEqual(["Pumpkins", "Ghosts"]);
  });

  it("a clean board looks the same before and after counts load", () => {
    const clean = { ...room, categories: [pumpkins, filledOlder] as unknown as CategoryRow[] };
    const before = roomToTVSnapshot({ room: clean, allQuestions: [], scores: [], answers: [], pickedCountsReady: false });
    const after = roomToTVSnapshot({ room: clean, allQuestions: [], scores: [], answers: [] });
    expect(before?.categories.map((c) => c.id)).toEqual(after?.categories.map((c) => c.id));
  });
});
