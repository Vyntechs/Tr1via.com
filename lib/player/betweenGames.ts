import type { GameScoreRow } from "@/lib/supabase/types";

export interface StandingRow {
  /** 1-based rank within the game. */
  rank: number;
  name: string;
  score: number;
  isYou: boolean;
}

export interface Game1Standings {
  /** The top `limit` rows, ranked 1..limit. */
  top: StandingRow[];
  /** The player's own row when they rank BELOW `limit` (so the UI can pin
   *  it under the top list). null when the player is already in `top` or has
   *  no score row in this game. */
  you: StandingRow | null;
}

/**
 * Build the Game-1 leaderboard for the between-games screen from the
 * already-sorted (score desc) `game_scores` rows.
 *
 * `display_name`/`score` are nullable on the view type (it's a left-join), but
 * never null for a row that actually has a score — coalesce defensively so the
 * caller always gets a concrete string/number.
 */
export function buildGame1Standings(
  scores: GameScoreRow[],
  meId: string,
  limit = 5,
): Game1Standings {
  const ranked: StandingRow[] = scores.map((s, i) => ({
    rank: i + 1,
    name: s.display_name ?? "",
    score: s.score ?? 0,
    isYou: s.player_id === meId,
  }));
  const top = ranked.slice(0, limit);
  const meIndex = ranked.findIndex((r) => r.isYou);
  const you = meIndex >= limit ? ranked[meIndex] : null;
  return { top, you };
}
