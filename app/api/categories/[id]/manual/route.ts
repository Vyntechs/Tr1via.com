// POST /api/categories/[id]/manual
//
// The fallback when Claude generation fails (or when the host wants to
// skip generation entirely): she types her 7 questions by hand. The
// route accepts exactly 7 question rows in the order she wants them
// laid out on the board.
//
// Behaviour:
//   - Wipes any existing questions in the category (manual entry is a
//     fresh start — there's no notion of "merging" with prior AI output).
//   - Inserts 7 new rows with source='host-edit', is_picked=true.
//   - Order entered IS the difficulty / point order: row 1 becomes the
//     100-pointer (difficulty=1), row 7 the 700-pointer (difficulty=7).
//     The host has explicit control via the order she types — there's
//     no Claude rating to defer to.
//   - Flips category.state to 'ready' (skipping 'review' — there's
//     nothing to review when she just typed them herself).
//
// Host-only. Refuses if the category is already locked ('ready'); the
// host can unlock by regenerating or by hitting reset elsewhere. We
// also refuse 'generating' so we don't fight a background job.

import { type NextRequest } from "next/server";

import { requireOwnedCategory } from "@/lib/api/auth";
import { ManualCategoryBodySchema } from "@/lib/api/schemas";
import {
  badRequest,
  conflict,
  forbidden,
  notFound,
  ok,
  serverError,
  unauthorized,
} from "@/lib/api/responses";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { QuestionInsert } from "@/lib/supabase/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const POINT_VALUES = [100, 200, 300, 400, 500, 600, 700] as const;

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

  if (category.state === "ready") {
    return conflict("category already locked; reset before manual entry");
  }
  if (category.state === "generating") {
    return conflict("generation in progress; cancel before manual entry");
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("invalid JSON body");
  }
  const parsed = ManualCategoryBodySchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error);
  const { questions } = parsed.data;

  const admin = getSupabaseAdmin();

  // Step 1: wipe prior questions in this category. Manual entry is a
  // clean slate.
  const { error: deleteError } = await admin
    .from("questions")
    .delete()
    .eq("category_id", categoryId);
  if (deleteError) {
    return serverError(
      `failed to clear existing questions: ${deleteError.message}`,
    );
  }

  // Step 2: build the insert rows. Position-in-array drives difficulty
  // AND point_value — easiest first, hardest last.
  const insertRows: QuestionInsert[] = questions.map((q, idx) => {
    const row: QuestionInsert = {
      category_id: categoryId,
      prompt: q.prompt,
      options: q.options as [string, string, string, string],
      correct_index: q.correctIndex,
      difficulty: idx + 1,
      point_value: POINT_VALUES[idx] as
        | 100
        | 200
        | 300
        | 400
        | 500
        | 600
        | 700,
      source: "host-edit",
      is_picked: true,
    };
    if (q.imageUrl) {
      row.image_url = q.imageUrl;
      row.image_source = "upload";
      row.image_attribution = null;
    } else {
      row.image_url = null;
      row.image_source = null;
      row.image_attribution = null;
    }
    return row;
  });

  const { data: inserted, error: insertError } = await admin
    .from("questions")
    .insert(insertRows)
    .select("id, point_value, difficulty, prompt");
  if (insertError || !inserted) {
    return serverError(
      `failed to insert manual questions: ${insertError?.message ?? "unknown"}`,
    );
  }

  // Step 3: flip the category to 'ready'.
  const { error: stateError } = await admin
    .from("categories")
    .update({ state: "ready" })
    .eq("id", categoryId);
  if (stateError) {
    return serverError(`failed to mark ready: ${stateError.message}`);
  }

  return ok({ questions: inserted });
}
