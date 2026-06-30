// PATCH /api/nights/:id/room-magic — host toggles Room Magic for a night.
//
// Default-off, cosmetic-only. The toggle is blocked while any game in the
// night is live so Heather's live Classic flow cannot change mid-question.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  badRequest,
  conflict,
  forbidden,
  notFound,
  ok,
  serverError,
  unauthorized,
} from "@/lib/api/responses";
import { requireOwnedNight } from "@/lib/api/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  enabled: z.boolean(),
});

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await ctx.params;
  const owned = await requireOwnedNight(id);
  if (!owned.ok) {
    if (owned.status === 401) return unauthorized(owned.error);
    if (owned.status === 403) return forbidden(owned.error);
    return notFound(owned.error);
  }

  let parsed: z.infer<typeof Body>;
  try {
    parsed = Body.parse(await req.json());
  } catch (err) {
    return badRequest(err instanceof Error ? err.message : "invalid body");
  }

  const admin = getSupabaseAdmin();

  const { data: liveGame } = await admin
    .from("games")
    .select("id")
    .eq("night_id", id)
    .eq("state", "live")
    .maybeSingle();

  if (liveGame) {
    return conflict(
      "Can't change Room Magic while a game is live. End the current game first.",
    );
  }

  const { data, error } = await admin
    .from("nights")
    .update({ room_magic_enabled: parsed.enabled })
    .eq("id", id)
    .select("room_magic_enabled")
    .single();
  if (error || !data) {
    return serverError(error?.message ?? "could not update Room Magic");
  }

  return ok({ roomMagicEnabled: data.room_magic_enabled });
}
