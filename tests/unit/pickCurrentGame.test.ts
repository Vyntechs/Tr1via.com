// pickCurrentGame — which game a surface should show "now". Extracted from
// useRoom so the server-route fallback mapper derives currentGame identically.

import { describe, it, expect } from "vitest";
import { pickCurrentGame } from "@/lib/room/pickCurrentGame";
import type { GameRow } from "@/lib/supabase/types";

function game(partial: Partial<GameRow> & { id: string; state: GameRow["state"] }): GameRow {
  return {
    id: partial.id,
    night_id: "n1",
    game_no: partial.game_no ?? 1,
    state: partial.state,
    started_at: partial.started_at ?? null,
    ended_at: partial.ended_at ?? null,
    category_count: 0,
    question_count: 0,
  } as GameRow;
}

describe("pickCurrentGame", () => {
  it("prefers the live game", () => {
    const games = [
      game({ id: "g1", game_no: 1, state: "done", ended_at: "2026-01-01T00:00:00Z" }),
      game({ id: "g2", game_no: 2, state: "live" }),
    ];
    expect(pickCurrentGame(games)?.id).toBe("g2");
  });

  it("falls back to the most-recently-ended done game when none live", () => {
    const games = [
      game({ id: "g1", game_no: 1, state: "done", ended_at: "2026-01-01T00:00:00Z" }),
      game({ id: "g2", game_no: 2, state: "done", ended_at: "2026-01-02T00:00:00Z" }),
    ];
    expect(pickCurrentGame(games)?.id).toBe("g2");
  });

  it("falls back to a ready game when none live or done", () => {
    const games = [
      game({ id: "g1", game_no: 1, state: "draft" }),
      game({ id: "g2", game_no: 2, state: "ready" }),
    ];
    expect(pickCurrentGame(games)?.id).toBe("g2");
  });

  it("falls back to the first game, then null", () => {
    expect(pickCurrentGame([game({ id: "g1", state: "draft" })])?.id).toBe("g1");
    expect(pickCurrentGame([])).toBeNull();
  });
});
