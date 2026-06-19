import type { GameScoreRow } from "@/lib/supabase/types";
import type { StandingRow } from "@/lib/player/betweenGames";

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
  const total = scores.length;
  const meIndex = scores.findIndex((s) => s.player_id === meId);
  if (meIndex < 0) return { rows: [], meRank: null, total };
  const start = Math.max(0, meIndex - radius);
  const end = Math.min(total, meIndex + radius + 1);
  const rows: StandingRow[] = scores.slice(start, end).map((s, i) => ({
    rank: start + i + 1,
    name: s.display_name ?? "",
    score: s.score ?? 0,
    isYou: s.player_id === meId,
  }));
  return { rows, meRank: meIndex + 1, total };
}
