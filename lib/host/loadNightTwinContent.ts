// Content of the few nights the home page might hide as empty twins (see
// lib/host/nightTwins.ts): their game rows (every column), and category and
// player counts (players incl. removed ones). Any read error returns {} so
// nothing is hidden.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { NightContent, TwinGame } from "@/lib/host/nightTwins";

export async function loadNightTwinContent(
  admin: Pick<SupabaseClient, "from">,
  nightIds: string[],
): Promise<Record<string, NightContent>> {
  if (nightIds.length === 0) return {};
  const { data: games, error: gamesError } = await admin
    .from("games")
    .select("*")
    .in("night_id", nightIds);
  if (gamesError) return {};
  const gameRows = (games ?? []) as TwinGame[];
  let catRows: Array<{ game_id: string }> = [];
  if (gameRows.length > 0) {
    const { data: cats, error: catsError } = await admin
      .from("categories")
      .select("game_id")
      .in("game_id", gameRows.map((g) => String(g.id)));
    if (catsError) return {};
    catRows = (cats ?? []) as Array<{ game_id: string }>;
  }
  const { data: players, error: playersError } = await admin
    .from("players")
    .select("night_id")
    .in("night_id", nightIds);
  if (playersError) return {};

  const result: Record<string, NightContent> = {};
  for (const id of nightIds) result[id] = { categories: 0, players: 0, games: [] };
  const nightOfGame = new Map(gameRows.map((g) => [String(g.id), String(g.night_id)]));
  for (const g of gameRows) result[String(g.night_id)]?.games?.push(g);
  for (const c of catRows) {
    const nightId = nightOfGame.get(c.game_id);
    if (nightId && result[nightId]) result[nightId].categories += 1;
  }
  for (const p of (players ?? []) as Array<{ night_id: string }>) {
    if (result[p.night_id]) result[p.night_id].players += 1;
  }
  return result;
}
