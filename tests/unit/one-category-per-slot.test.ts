import { describe, expect, it } from "vitest";
import {
  countPickedByCategory,
  doubledSlotCategoryIds,
  oneCategoryPerSlot,
  pickSlotWinner,
  sameTopicText,
} from "@/lib/host/oneCategoryPerSlot";
import { roomToTVSnapshot } from "@/lib/host/roomToTVSnapshot";
import type { RoomSnapshot } from "@/lib/hooks/useRoom";
import type { CategoryRow, GameRow, NightRow, QuestionRow } from "@/lib/supabase/types";

// Production rows from game 2 on 2026-10-07 (Heather's night): the slot-2
// extra row that showed on the TV board as a full column of dead tiles.
const orphan = {
  id: "dc1bc976-2394-4565-9f37-726454e648be",
  game_id: "game-2",
  name: "Legendary Ghost stories",
  topic: "Legendary Ghost stories",
  position: 2,
  color: null,
  state: "review",
  created_at: "2026-10-03T15:36:41.777Z",
};
const real = {
  id: "05580ab6-eddb-46c7-b663-04aea9170bd4",
  game_id: "game-2",
  name: "Ghost Stories",
  topic: "legendary ghost stories",
  position: 2,
  color: null,
  state: "ready",
  created_at: "2026-10-03T15:37:09.161Z",
};
const pumpkins = {
  id: "f44d8d6e-b759-4525-8dd1-ab67a3366ac6",
  game_id: "game-2",
  name: "Pumpkins",
  topic: "Pumpkins",
  position: 3,
  color: null,
  state: "ready",
  created_at: "2026-10-04T15:43:02.437Z",
};

describe("oneCategoryPerSlot", () => {
  it("keeps the locked row over an older unlocked extra in the same slot", () => {
    expect(oneCategoryPerSlot([orphan, real, pumpkins]).map((c) => c.name)).toEqual([
      "Ghost Stories",
      "Pumpkins",
    ]);
    // Row order from the database does not change the answer.
    expect(oneCategoryPerSlot([real, orphan, pumpkins]).map((c) => c.name)).toEqual([
      "Ghost Stories",
      "Pumpkins",
    ]);
  });

  it("with two unlocked rows, keeps the newer one (the host's latest attempt)", () => {
    const older = { ...orphan, id: "a", name: "Saint or Sitcom Character?", created_at: "2026-10-13T18:57:00Z" };
    const newer = { ...orphan, id: "b", name: "Is That Actually Catholic?", created_at: "2026-10-13T19:00:18Z" };
    expect(pickSlotWinner([older, newer])?.name).toBe("Is That Actually Catholic?");
    expect(pickSlotWinner([newer, older])?.name).toBe("Is That Actually Catholic?");
  });

  it("keeps the row with more picked questions over a newer empty one in the same state", () => {
    // The Back-button double: her filled row is OLDER; the retyped one is newer
    // and empty. The newer one must not hide her work.
    const filled = { ...orphan, id: "a-filled", name: "Ghosts", created_at: "2026-10-14T18:00:00Z" };
    const empty = { ...orphan, id: "b-empty", name: "ghosts", created_at: "2026-10-14T18:01:00Z" };
    const picked = new Map([[filled.id, 7]]);
    expect(pickSlotWinner([filled, empty], picked)?.id).toBe("a-filled");
    expect(pickSlotWinner([empty, filled], picked)?.id).toBe("a-filled");
    expect(oneCategoryPerSlot([empty, filled, pumpkins], picked).map((c) => c.id)).toEqual([
      "a-filled",
      pumpkins.id,
    ]);
    // Picks come before state: a filled review row beats an empty locked one.
    const emptyLocked = { ...empty, state: "ready" };
    expect(pickSlotWinner([filled, emptyLocked], picked)?.id).toBe("a-filled");
    // Same picks: the locked row wins, then the newer row.
    const lockedSame = { ...empty, state: "ready" };
    expect(pickSlotWinner([filled, lockedSame], new Map([[filled.id, 7], [lockedSame.id, 7]]))?.id).toBe(
      lockedSame.id,
    );
  });

  it("counts picked questions per category and lists only doubled slots", () => {
    const counts = countPickedByCategory([
      { category_id: "x" },
      { category_id: "x", is_picked: true },
      { category_id: "x", is_picked: false },
      { category_id: "y" },
    ]);
    expect(counts.get("x")).toBe(2);
    expect(counts.get("y")).toBe(1);
    expect(doubledSlotCategoryIds([orphan, real, pumpkins]).sort()).toEqual([orphan.id, real.id].sort());
    expect(doubledSlotCategoryIds([real, pumpkins])).toEqual([]);
  });

  it("leaves a normal board untouched and keeps slots in different games apart", () => {
    const game1Slot2 = { ...real, id: "g1", game_id: "game-1", name: "Haunted Highways" };
    const rows = [game1Slot2, real, pumpkins];
    expect(oneCategoryPerSlot(rows)).toEqual(rows);
    expect(pickSlotWinner([])).toBeNull();
  });

  it("treats the same words with different capitals or spacing as the same topic", () => {
    expect(sameTopicText("Legendary Ghost stories", "  legendary  ghost STORIES ")).toBe(true);
    expect(sameTopicText("Saint or Sitcom Character?", "Is That Actually Catholic?")).toBe(false);
  });
});

describe("TV board from a doubled slot", () => {
  it("shows one column per slot and drops the hidden row's picked questions", () => {
    const game = {
      id: "game-2",
      game_no: 2,
      state: "live",
      started_at: "2026-10-08T00:43:21Z",
      ended_at: null,
      category_count: 6,
      question_count: 7,
    } as unknown as GameRow;
    const room = {
      night: {
        id: "night-1",
        venue_name: "Soul Fire Pizza",
        theme_key: "house",
        room_code: "PF8NVJ",
        opened_at: "2026-10-07T23:17:35Z",
        closed_at: null,
        scheduled_at: null,
        is_locked: false,
        room_magic_enabled: false,
      } as unknown as NightRow,
      hostDefaultThemeKey: "house",
      games: [game],
      categories: [orphan, real, pumpkins] as unknown as CategoryRow[],
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

    const snapshot = roomToTVSnapshot({
      room,
      allQuestions: [picked("q-real", real.id), picked("q-orphan", orphan.id)],
      scores: [],
      answers: [],
    });

    expect(snapshot?.categories.map((c) => c.name)).toEqual(["Ghost Stories", "Pumpkins"]);
    expect(snapshot?.questions.map((q) => q.id)).not.toContain("q-orphan");

    // The Back-button double: her OLDER row holds the picks, a newer retyped
    // row is empty, both unlocked. The board shows the filled one.
    const filled = { ...orphan, id: "a-filled", name: "Ghosts", created_at: "2026-10-14T18:00:00Z" };
    const emptyNewer = { ...orphan, id: "b-empty", name: "ghosts", created_at: "2026-10-14T18:01:00Z" };
    const filledBoard = roomToTVSnapshot({
      room: { ...room, categories: [filled, emptyNewer, pumpkins] as unknown as CategoryRow[] },
      allQuestions: [picked("q-f1", filled.id), picked("q-f2", filled.id)],
      scores: [],
      answers: [],
    });
    expect(filledBoard?.categories.map((c) => c.id)).toEqual(["a-filled", pumpkins.id]);
    expect(filledBoard?.questions.map((q) => q.id).sort()).toEqual(["q-f1", "q-f2"]);
  });
});
