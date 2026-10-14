// PATCH /api/categories/:id — host renames the category's display label.
// DELETE /api/categories/:id — host removes a category during setup.
//
// PATCH body: { name: string (1..80, trimmed) }. The rename only touches
// `categories.name`. `categories.topic` (the original Claude prompt) is
// preserved so we don't accidentally invalidate the 20 generated
// candidates or shift the Pexels seed for the question images.
//
// Allowed at any category state — `draft`, `generating`, `review`,
// `ready`. Renaming a locked category is the entire point of the
// feature (the first host: "I just want it to say skirts"); there's no
// invariant a rename can break.
//
// DELETE removes the category row. The FK chain in 0001_init.sql
// cascades through: questions → plays + answers all use
// `on delete cascade`. So removing the category cleanly nukes any
// generated questions and any (in-setup) artifacts hanging off them.
//
// DELETE is host-only and allowed in any setup state — we explicitly
// want the host to be able to remove a 'generating' category if she
// realises she typed the wrong topic; the background `after()` job
// finishes harmlessly even if its target row is gone. Out of scope:
// deleting categories from a live night — that's the existing
// "Reset and edit game" path.
//
// The database decides, not this route: the board guard from 0031
// (fence_category_authoring) runs on every category delete and checks the
// GAME's state, not the category's. While the game is 'draft' or 'ready'
// (setup) any category can go, whatever its own state or picks. Once the game
// is 'live' or 'done' every delete is refused with 55000 ("the board cannot
// change after its game starts"), even a 'review' row with no picks. The guard
// takes the game row with NOWAIT, so a delete that lands while another write
// holds that game (Start, a generation finishing) fails at once with 55P03.
// Both come back as a plain 409 the setup screen can show.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  badRequest,
  conflict,
  forbidden,
  noContent,
  notFound,
  ok,
  serverError,
  unauthorized,
} from "@/lib/api/responses";
import { requireOwnedCategory } from "@/lib/api/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { PatchCategoryBodySchema } from "@/lib/api/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 0031 board guard: the game is live or done. */
const BOARD_GUARD_REFUSED = "55000";
/** 0031 board guard: another write holds the game row (NOWAIT). */
const GAME_ROW_BUSY = "55P03";

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await ctx.params;
  const owned = await requireOwnedCategory(id);
  if (!owned.ok) {
    if (owned.status === 401) return unauthorized(owned.error);
    if (owned.status === 403) return forbidden(owned.error);
    return notFound(owned.error);
  }

  let parsed: z.infer<typeof PatchCategoryBodySchema>;
  try {
    parsed = PatchCategoryBodySchema.parse(await req.json());
  } catch (err) {
    if (err instanceof z.ZodError) return badRequest(err);
    return badRequest(err instanceof Error ? err.message : "invalid body");
  }

  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("categories")
    .update({ name: parsed.name })
    .eq("id", id)
    .select("id, name")
    .single();
  if (error || !data) {
    return serverError(error?.message ?? "could not rename category");
  }

  return ok({ category: { id: data.id, name: data.name } });
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await ctx.params;
  const owned = await requireOwnedCategory(id);
  if (!owned.ok) {
    if (owned.status === 401) return unauthorized(owned.error);
    if (owned.status === 403) return forbidden(owned.error);
    return notFound(owned.error);
  }

  const admin = getSupabaseAdmin();
  const { error } = await admin.from("categories").delete().eq("id", id);
  if (error) {
    const code = (error as { code?: string }).code;
    if (code === BOARD_GUARD_REFUSED) {
      return conflict(
        "This game has started, so its categories can't be deleted. They stay as they are.",
      );
    }
    if (code === GAME_ROW_BUSY) {
      return conflict("This game is being changed right now. Try again in a moment.");
    }
    return serverError(error.message ?? "could not delete category");
  }
  return noContent();
}
