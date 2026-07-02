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

export function buildNightStandings(scores: GameScoreRow[]): GameScoreRow[] {
  const byPlayer = new Map<string, GameScoreRow>();
  for (const row of scores) {
    if (!row.player_id) continue;
    const existing = byPlayer.get(row.player_id);
    if (!existing) {
      byPlayer.set(row.player_id, { ...row });
      continue;
    }
    const existingFastest = existing.fastest_correct_ms;
    const rowFastest = row.fastest_correct_ms;
    byPlayer.set(row.player_id, {
      ...existing,
      display_name: existing.display_name ?? row.display_name,
      score: Number(existing.score ?? 0) + Number(row.score ?? 0),
      correct_count: Number(existing.correct_count ?? 0) + Number(row.correct_count ?? 0),
      answered_count: Number(existing.answered_count ?? 0) + Number(row.answered_count ?? 0),
      fastest_correct_ms:
        existingFastest === null || existingFastest === undefined
          ? rowFastest
          : rowFastest === null || rowFastest === undefined
            ? existingFastest
            : Math.min(existingFastest, rowFastest),
    });
  }
  return [...byPlayer.values()].sort((a, b) => Number(b.score ?? 0) - Number(a.score ?? 0));
}
