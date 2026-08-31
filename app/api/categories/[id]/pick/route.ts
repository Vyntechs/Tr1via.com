// POST /api/categories/[id]/pick
//
// The host sends the exact seven id-to-slot assignments displayed in YOUR
// BOARD. We validate membership, then atomically persist those assignments
// without deriving a second ordering on the server.
//
// Body: { assignments: [{ id, pointValue }, ...] }
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
  const { assignments } = parsed.data;

  const result = await pickQuestionsForCategory(categoryId, assignments);
  if (!result.ok) return badRequest(result.error);
  return ok({ picked: result.picked });
}
