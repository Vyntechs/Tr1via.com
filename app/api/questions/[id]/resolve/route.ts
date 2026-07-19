// POST /api/questions/:id/resolve — resolve a question (the T+20 path).
//
// The first phone whose local timer reaches 0 pings this. It's also the
// fallback if the TV's `useTimer` reaches 0 first. Either way, race-safe:
// resolve_question() does a `select … for update` on the questions row, so
// the second caller sees finished_at set and returns no-op.
//
// Authentication: the normal timer trigger remains anonymous so the venue TV
// and player phones can race safely at T+30. Possessing the live question UUID
// is not authority to end it early, though: this handler checks the
// server-recorded reveal time against the same theme duration used by clients
// before invoking the service-role RPC. The authenticated host-only end-early
// route remains the sole production path for an early close.
//
// On success, we:
//   1. Run the RPC (does is_correct + awarded_points for every answer,
//      stamps finished_at, inserts 'resolve' event).
//   2. Read back the canonical correct_index + the per-player awards.
//   3. Broadcast 'resolve' on room:{code} so phones flip Locked → Reveal
//      simultaneously with the TV (without each waiting for the slower
//      Postgres Changes notification).

import { conflict, ok, serverError, notFound } from "@/lib/api/responses";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { broadcastToRoom, broadcastFireworks } from "@/lib/api/broadcast";
import { isTestModeEnabled } from "@/lib/api/require-test-mode";
import { questionDurationFor } from "@/lib/theme/lockInCeremony";
import { resolveTheme } from "@/lib/theme/resolveTheme";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: questionId } = await ctx.params;
  const admin = getSupabaseAdmin();

  // Look up question → category → game → night.room_code through three
  // sequential queries. The stub types don't model FK relationships for
  // joined selects, so a single nested-select wouldn't typecheck.
  const { data: q, error: questionError } = await admin
    .from("questions")
    .select("id, category_id, correct_index, played_at, finished_at")
    .eq("id", questionId)
    .maybeSingle();
  if (questionError) return serverError();
  if (!q) return notFound("question not found");
  const { data: cat, error: categoryError } = await admin
    .from("categories")
    .select("game_id")
    .eq("id", q.category_id)
    .maybeSingle();
  if (categoryError) return serverError();
  if (!cat) return notFound("category not found");
  const { data: game, error: gameError } = await admin
    .from("games")
    .select("night_id")
    .eq("id", cat.game_id)
    .maybeSingle();
  if (gameError) return serverError();
  if (!game) return notFound("game not found");
  const { data: night, error: nightError } = await admin
    .from("nights")
    .select("room_code, theme_key, hosts!inner(default_theme_key)")
    .eq("id", game.night_id)
    .maybeSingle();
  if (nightError) return serverError();
  if (!night) return notFound("night not found");
  const roomCode = night.room_code;

  // The test-only fast-forward proxy is already protected by the two-part
  // TEST_AUTH_ENABLED + x-test-secret gate. Re-check that same gate here so
  // its request can skip elapsed time without introducing a body/query force
  // flag that could ever work in production.
  const isTestFastForward = isTestModeEnabled(req);
  if (!isTestFastForward) {
    if (!q.played_at) {
      return conflict("question is not live");
    }

    // Once resolved, keep the route's existing idempotent behavior: the RPC
    // no-ops and a retry can rebuild/broadcast the canonical result. The
    // deadline guard is needed only while the question remains live.
    if (!q.finished_at) {
      const playedAtMs = new Date(q.played_at).getTime();
      if (!Number.isFinite(playedAtMs)) return serverError();

      const host = Array.isArray(night.hosts) ? night.hosts[0] : night.hosts;
      const themeKey = resolveTheme(
        { theme_key: night.theme_key },
        { default_theme_key: host?.default_theme_key ?? null },
      );
      const resolveAtMs =
        playedAtMs + questionDurationFor(themeKey) * 1_000;
      if (Date.now() < resolveAtMs) {
        return conflict("question answer window is still open");
      }
    }
  }

  const { error: rpcError } = await admin.rpc("resolve_question", {
    p_question_id: questionId,
  });
  if (rpcError) return serverError();

  // Read the awards back for the broadcast payload. Done after the RPC so
  // is_correct/awarded_points are populated.
  const { data: awards, error: awardsError } = await admin
    .from("answers")
    .select("player_id, is_correct, awarded_points")
    .eq("question_id", questionId);
  if (awardsError) return serverError();

  const payload = {
    questionId,
    correctIndex: q.correct_index,
    awards: (awards ?? []).map((a) => ({
      playerId: a.player_id,
      // Coerce to a real boolean: the column is boolean|null (null = no answer),
      // but the broadcast/awards type is `boolean`. null counts as not-correct.
      isCorrect: a.is_correct === true,
      awarded: a.awarded_points ?? 0,
    })),
    serverNow: new Date().toISOString(),
  };

  try {
    await broadcastToRoom(roomCode, "resolve", payload);
  } catch (e) {
    console.warn("broadcast resolve failed", e);
  }

  // Synchronized firework salvo (July) — every July screen ignites the same
  // burst at the same instant as the answer is revealed. Cosmetic + best-effort
  // (a dropped beat never affects scoring); no-op on non-July nights.
  try {
    await broadcastFireworks(roomCode, "salvo", questionId);
  } catch (e) {
    console.warn("broadcast fireworks(salvo) failed", e);
  }

  return ok({
    resolvedAt: new Date().toISOString(),
    awardCount: payload.awards.length,
  });
}
