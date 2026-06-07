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
import { pickQuestionsForCategory } from "@/lib/host/pickQuestions";

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

  // The point-value assignment + atomic clear/set/mark-ready write path lives
  // in lib/host/pickQuestions so the founder "build a full game" auto-pick
  // runs the exact same logic as a human pick.
  const result = await pickQuestionsForCategory(categoryId, questionIds);
  if (!result.ok) return badRequest(result.error);
  return ok({ picked: result.picked });
}
