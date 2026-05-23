// POST /api/categories — host creates a category inside one of their games.
//
// One category = one column on the Jeopardy board. The host creates 6 of
// these per game during the setup flow. Position 1..6 maps left-to-right on
// the board. We default category.state to 'draft'; generation flips it
// through 'generating' → 'review' → 'ready' via the existing routes.
//
// Host-only. Verifies ownership of the parent game (which verifies
// ownership of the night). Returns the new category's id so the host UI
// can navigate straight into the topic / generate / pick flow.

import type { NextRequest } from "next/server";
import { CreateCategoryBodySchema } from "@/lib/api/schemas";
import {
  badRequest,
  forbidden,
  notFound,
  ok,
  serverError,
  unauthorized,
} from "@/lib/api/responses";
import { requireOwnedGame } from "@/lib/api/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("invalid JSON");
  }
  const parsed = CreateCategoryBodySchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error);
  const { gameId, name, topic, position } = parsed.data;

  const owned = await requireOwnedGame(gameId);
  if (!owned.ok) {
    if (owned.status === 401) return unauthorized(owned.error);
    if (owned.status === 403) return forbidden(owned.error);
    return notFound(owned.error);
  }

  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("categories")
    .insert({
      game_id: gameId,
      name,
      topic,
      position,
    })
    .select("id, name, topic, position, state")
    .single();
  if (error || !data) {
    return serverError(error?.message ?? "could not create category");
  }
  return ok({ category: data }, 201);
}
