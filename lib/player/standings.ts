import type { GameScoreRow } from "@/lib/supabase/types";
import type { StandingRow } from "@/lib/player/betweenGames";
import { rankScores } from "@/lib/game/rankScores";

export interface Neighborhood {
  rows: StandingRow[];
  meRank: number | null;
  total: number;
}

export function buildNeighborhood(
  scores: GameScoreRow[],
  meId: string,
  radius = 4,
): Neighborhood {
  const ranked = rankScores(scores);
  const total = ranked.length;
  const meIndex = ranked.findIndex(({ row }) => row.player_id === meId);
  if (meIndex < 0) return { rows: [], meRank: null, total };
  const start = Math.max(0, meIndex - radius);
  const end = Math.min(total, meIndex + radius + 1);
  const rows: StandingRow[] = ranked.slice(start, end).map(({ row, rank }) => ({
    rank,
    name: row.display_name ?? "",
    score: row.score ?? 0,
    isYou: row.player_id === meId,
  }));
  return { rows, meRank: ranked[meIndex]?.rank ?? null, total };
}
