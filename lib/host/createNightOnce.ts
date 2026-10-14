// Get-or-create for POST /api/nights, so a repeated tap, a retried request,
// or a second tab returns the night that was just made instead of a twin.
//
// Two layers:
//   1. createNightLocked: calls the database function create_night_once
//      (supabase/proposed/20261014_create_night_once.sql). It takes a
//      per-host lock, returns a fresh empty night if one exists, otherwise
//      inserts the night and both games in one transaction. Until that
//      migration is applied the function is missing and we fall through.
//   2. findReusableEmptyNight: the same rule in app code, without the lock.
//      It covers every real case seen in production (repeat calls 1-30s
//      apart); two calls inside the same ~100ms can still both create until
//      the migration is applied, which the client tap lock also prevents.
//
// "Reusable" means: same host, created within NIGHT_TWIN_WINDOW_MS, never
// opened/closed/run, same venue/theme/date as asked, both game shells
// still draft and never started, and no categories and no players yet. A night with anything in it
// is never reused.

import type { SupabaseClient } from "@supabase/supabase-js";
import { NIGHT_TWIN_WINDOW_MS } from "@/lib/host/nightTwins";

export interface CreateNightRequest {
  hostId: string;
  venueName: string;
  themeKey: string | null;
  scheduledAt: string | null;
}

export interface CreatedNight {
  nightId: string;
  roomCode: string;
  reused: boolean;
}

export type LockedResult =
  | { kind: "ok"; night: CreatedNight }
  | { kind: "unavailable" }
  | { kind: "error"; message: string };

// PostgREST answers PGRST202 when the function is not in its schema cache;
// Postgres answers 42883 when no function matches the arguments.
const MISSING_FUNCTION_CODES = new Set(["PGRST202", "42883"]);

export async function createNightLocked(
  admin: SupabaseClient,
  req: CreateNightRequest,
  roomCodes: string[],
): Promise<LockedResult> {
  const { data, error } = await admin.rpc("create_night_once", {
    p_host_id: req.hostId,
    p_venue_name: req.venueName,
    p_theme_key: req.themeKey,
    p_scheduled_at: req.scheduledAt,
    p_room_codes: roomCodes,
    p_reuse_window_seconds: Math.round(NIGHT_TWIN_WINDOW_MS / 1000),
  });
  if (error) {
    if (error.code && MISSING_FUNCTION_CODES.has(error.code)) return { kind: "unavailable" };
    return { kind: "error", message: error.message ?? "could not create night" };
  }
  const row = (Array.isArray(data) ? data[0] : data) as
    | { night_id?: string; room_code?: string; reused?: boolean }
    | null
    | undefined;
  if (!row?.night_id || !row.room_code) {
    return { kind: "error", message: "create_night_once returned no night" };
  }
  return {
    kind: "ok",
    night: { nightId: row.night_id, roomCode: row.room_code, reused: Boolean(row.reused) },
  };
}

function sameInstant(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  return Date.parse(a) === Date.parse(b);
}

export async function findReusableEmptyNight(
  admin: SupabaseClient,
  req: CreateNightRequest,
  nowMs: number = Date.now(),
): Promise<{ night: CreatedNight | null; error: string | null }> {
  const sinceIso = new Date(nowMs - NIGHT_TWIN_WINDOW_MS).toISOString();
  const { data: rows, error } = await admin
    .from("nights")
    .select("id, room_code, venue_name, theme_key, scheduled_at, created_at")
    .eq("host_id", req.hostId)
    .is("opened_at", null)
    .is("closed_at", null)
    .is("current_run_id", null)
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(5);
  if (error) return { night: null, error: error.message };

  const candidates = ((rows ?? []) as Array<{
    id: string;
    room_code: string;
    venue_name: string;
    theme_key: string | null;
    scheduled_at: string | null;
  }>).filter(
    (n) =>
      n.venue_name === req.venueName &&
      (n.theme_key ?? null) === req.themeKey &&
      sameInstant(n.scheduled_at ?? null, req.scheduledAt),
  );
  if (candidates.length === 0) return { night: null, error: null };
  const ids = candidates.map((n) => n.id);

  const { data: games, error: gamesError } = await admin
    .from("games")
    .select("id, night_id, state, started_at")
    .in("night_id", ids);
  if (gamesError) return { night: null, error: gamesError.message };
  const gameRows = (games ?? []) as Array<{
    id: string;
    night_id: string;
    state?: string | null;
    started_at?: string | null;
  }>;

  let catRows: Array<{ game_id: string }> = [];
  if (gameRows.length > 0) {
    const { data: cats, error: catsError } = await admin
      .from("categories")
      .select("game_id")
      .in("game_id", gameRows.map((g) => g.id));
    if (catsError) return { night: null, error: catsError.message };
    catRows = (cats ?? []) as Array<{ game_id: string }>;
  }

  const { data: players, error: playersError } = await admin
    .from("players")
    .select("night_id")
    .in("night_id", ids);
  if (playersError) return { night: null, error: playersError.message };
  const playerNights = new Set(((players ?? []) as Array<{ night_id: string }>).map((p) => p.night_id));

  const nightOfGame = new Map(gameRows.map((g) => [g.id, g.night_id]));
  const nightsWithCategories = new Set(
    catRows.map((c) => nightOfGame.get(c.game_id)).filter((id): id is string => Boolean(id)),
  );
  // Count only untouched game shells (draft, never started).
  const gameCount = new Map<string, number>();
  for (const g of gameRows) {
    if ((g.state ?? "draft") !== "draft" || g.started_at) continue;
    gameCount.set(g.night_id, (gameCount.get(g.night_id) ?? 0) + 1);
  }

  // Candidates are newest-first, so the first empty one is the latest.
  const reusable = candidates.find(
    (n) =>
      gameCount.get(n.id) === 2 &&
      !nightsWithCategories.has(n.id) &&
      !playerNights.has(n.id),
  );
  return {
    night: reusable ? { nightId: reusable.id, roomCode: reusable.room_code, reused: true } : null,
    error: null,
  };
}
