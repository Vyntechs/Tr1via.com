// GET /api/games/:id/locks — lock-in list for the current live question.
//
// The TV polls this every 3s as a fallback for missed Supabase realtime
// broadcasts. Returns only the locks for whichever question is currently
// live (played_at set, finished_at null). Empty list when there is no live
// question.

import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: gameId } = await ctx.params;
  const supa = getSupabaseAdmin();

  // Find the live question for this game — played_at set, not yet finished.
  // Scoped by category → game to prevent returning locks from other games.
  const { data: liveQuestion } = await supa
    .from("questions")
    .select("id, category_id, categories!inner(game_id)")
    .eq("categories.game_id", gameId)
    .not("played_at", "is", null)
    .is("finished_at", null)
    .limit(1)
    .maybeSingle();

  if (!liveQuestion) {
    return NextResponse.json({ locks: [] });
  }

  const { data: answers } = await supa
    .from("answers")
    .select("player_id, ms_to_lock, locked_at")
    .eq("question_id", liveQuestion.id);

  const locks = (answers ?? []).map((a) => ({
    playerId: a.player_id,
    msToLock: a.ms_to_lock,
    // locked_at is an ISO timestamp; convert to ms epoch for the client shape.
    lockedAtMs: a.locked_at ? Date.parse(a.locked_at) : 0,
  }));

  return NextResponse.json({ locks });
}
