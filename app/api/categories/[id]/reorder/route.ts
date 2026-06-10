// POST /api/categories/[id]/reorder
//
// The host dragged the "YOUR BOARD" sidebar to reorder her picked questions.
// We reassign each picked question's point value to match the new top→bottom
// slot order (100 at the top, up to 700). The set of point values in play is
// unchanged — only which question holds each slot changes.
//
// Body: { assignments: [{ id, pointValue }, ...] }  (2..7 entries, distinct)
//
// Host-only. Only valid while the category is in 'review'/'ready' (pre-game
// setup) — the same window the pick screen renders in.

import { type NextRequest } from "next/server";

import { requireOwnedCategory } from "@/lib/api/auth";
import { ReorderBoardBodySchema } from "@/lib/api/schemas";
import {
  badRequest,
  conflict,
  forbidden,
  notFound,
  ok,
  unauthorized,
} from "@/lib/api/responses";
import { reorderBoardQuestions } from "@/lib/host/reorderBoard";

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
      `cannot reorder a category in state '${category.state}'`,
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("invalid JSON body");
  }
  const parsed = ReorderBoardBodySchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error);

  const result = await reorderBoardQuestions(categoryId, parsed.data.assignments);
  if (!result.ok) return badRequest(result.error);
  return ok({ picked: result.picked });
}
