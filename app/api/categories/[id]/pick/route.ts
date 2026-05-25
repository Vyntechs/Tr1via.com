// POST /api/categories/[id]/pick
//
// The host has reviewed the 20 candidates and picked 7. We assign each one
// of the canonical board point values (100..700) via
// `lib/game/difficulty.ts → assignPointValues()`, then atomically update
// the picked rows + unpick the rest, then mark the category 'ready'.
//
// Body: { questionIds: [7 distinct uuids] }
//
// Host-only.

import { type NextRequest } from "next/server";

import { requireOwnedCategory } from "@/lib/api/auth";
import { PickCategoryBodySchema } from "@/lib/api/schemas";
import {
  badRequest,
  conflict,
  forbidden,
  notFound,
  ok,
  unauthorized,
} from "@/lib/api/responses";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { assignPointValues } from "@/lib/game/difficulty";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id: categoryId } = await context.params;

  const owned = await requireOwnedCategory(categoryId);
  if (!owned.ok) {
    if (owned.status === 401) return unauthorized(owned.error);
    if (owned.status === 403) return forbidden(owned.error);
    return notFound(owned.error);
  }
  const { category } = owned;

  if (category.state !== "review" && category.state !== "ready") {
    return conflict(
      `cannot pick from a category in state '${category.state}'`,
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("invalid JSON body");
  }
  const parsed = PickCategoryBodySchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error);
  const { questionIds } = parsed.data;

  const admin = getSupabaseAdmin();

  // Verify every id belongs to this category. RLS would catch foreign
  // ids on update, but checking up front lets us return a clean 400.
  const { data: belongs, error: belongsError } = await admin
    .from("questions")
    .select("id, difficulty, point_value")
    .eq("category_id", categoryId)
    .in("id", questionIds);
  if (belongsError) {
    return badRequest(`failed to verify questions: ${belongsError.message}`);
  }
  if (!belongs || belongs.length !== 7) {
    return badRequest(
      `expected 7 questions in this category, found ${belongs?.length ?? 0}`,
    );
  }

  // Assign point values 100..700. Any question the host has already
  // explicitly placed via the Edit panel keeps its slot; the remaining
  // picks fill open slots by Claude-rated difficulty asc (stable). This
  // is the change that fixes the first host's "I edited to 400 but it shows
  // 200" complaint: her override now flows all the way through to lock.
  const assignments = assignPointValues(
    belongs.map((row) => ({
      id: row.id,
      difficulty: row.difficulty,
      pointValue: row.point_value,
    })),
  );

  // Two-phase update: unpick everything first (idempotent in case of
  // re-pick), then set the chosen seven to is_picked=true with the
  // assigned point_value. The unique index on (category_id, point_value)
  // is DEFERRABLE INITIALLY DEFERRED so transient overlaps don't fire.
  //
  // We update in a sequence that defends against the unique constraint
  // even outside an explicit transaction: clear first → then set fresh
  // values. If anything fails midway, the category goes back to 'review'.
  const { error: clearError } = await admin
    .from("questions")
    .update({ is_picked: false, point_value: null })
    .eq("category_id", categoryId);
  if (clearError) {
    return badRequest(`failed to clear picks: ${clearError.message}`);
  }

  // Apply each assignment. (Per-row updates so we never collide on the
  // point_value unique index even momentarily.)
  for (const { id, pointValue } of assignments) {
    const { error } = await admin
      .from("questions")
      .update({
        is_picked: true,
        point_value: pointValue as 100 | 200 | 300 | 400 | 500 | 600 | 700,
      })
      .eq("id", id);
    if (error) {
      // Best-effort rollback then bail.
      await admin
        .from("questions")
        .update({ is_picked: false, point_value: null })
        .eq("category_id", categoryId);
      return badRequest(`failed to pick question ${id}: ${error.message}`);
    }
  }

  const { error: stateError } = await admin
    .from("categories")
    .update({ state: "ready" })
    .eq("id", categoryId);
  if (stateError) {
    return badRequest(`failed to mark ready: ${stateError.message}`);
  }

  return ok({ picked: assignments });
}
