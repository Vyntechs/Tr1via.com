// Content of the few nights the home page might hide as empty twins (see
// lib/host/nightTwins.ts): their game rows (every column), and category and
// player counts (players incl. removed ones). Any read error returns {} so
// nothing is hidden.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  hiddenEmptyTwinIds,
  twinCandidateIds,
  type NightContent,
  type TwinGame,
  type TwinNight,
  type TwinRule,
} from "@/lib/host/nightTwins";

/**
 * The nights the home page shows: every night minus empty twins. If anything
 * in the twin lookup throws, it logs once and returns every night, so the
 * home page never fails and never hides a night because of an error.
 */
export async function withoutEmptyTwinNights<T extends TwinNight>(
  admin: Pick<SupabaseClient, "from">,
  nights: T[],
  rule: TwinRule,
): Promise<T[]> {
  try {
    const content = await loadNightTwinContent(admin, twinCandidateIds(nights, rule));
    const hidden = hiddenEmptyTwinIds(nights, content, rule);
    return nights.filter((n) => !hidden.has(n.id));
  } catch (err) {
    console.error("[host home] twin night lookup failed; showing every night", err);
    return nights;
  }
}

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
