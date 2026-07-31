// POST /api/questions/[id]/fact-blurb
//
// Rewrite the fun fact so it matches the question as it NOW reads, and save
// it. Called right after the host saves an edit that changed the question
// text or the answer — she does not press anything.
//
// The fun fact is the line the host reads aloud when the answer is revealed.
// Before this existed, editing a question left the previous version's fact
// attached to it, and she read it out as truth (2026-07-29: a Pythagorean
// 5-12-13 fact under "The square root of 900 is:"). Issue #173.
//
// Failure posture: this route never leaves a WRONG fact in place. The client
// clears the stale blurb as part of the save that precedes this call, so the
// worst case here is a question with no fun fact — which the TV simply omits.
// A wrong one read to a room is the failure we are engineering against.
//
// Host-only.

import { type NextRequest } from "next/server";

import { requireOwnedQuestion } from "@/lib/api/auth";
import {
  forbidden,
  notFound,
  ok,
  serverError,
  unauthorized,
} from "@/lib/api/responses";
import { generateFactBlurb } from "@/lib/ai/generate-fact-blurb";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** One short generation. Far below the 300s the batch generate route needs,
 *  but above the SDK timeout so a slow call fails on our terms. */
export const maxDuration = 60;

export async function POST(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id: questionId } = await context.params;

  const owned = await requireOwnedQuestion(questionId);
  if (!owned.ok) {
    if (owned.status === 401) return unauthorized(owned.error);
    if (owned.status === 403) return forbidden(owned.error);
    return notFound(owned.error);
  }
  const { question } = owned;

  const options = question.options as [string, string, string, string] | null;
  if (!Array.isArray(options) || options.length !== 4) {
    return serverError("question is missing its four options");
  }
  const correctIndex = question.correct_index;
  if (correctIndex === null || correctIndex < 0 || correctIndex > 3) {
    return serverError("question has no valid correct answer");
  }

  let blurb: string | null;
  try {
    blurb = await generateFactBlurb({
      prompt: question.prompt,
      options,
      correctIndex: correctIndex as 0 | 1 | 2 | 3,
    });
  } catch (err) {
    // Network / rate-limit / auth. The host's edit is already saved and the
    // stale fact already cleared, so this is recoverable and non-blocking —
    // she can type one herself, or hit rewrite again.
    const message = err instanceof Error ? err.message : "unknown error";
    console.error(`[fact-blurb] generation failed: ${message}`);
    return serverError("could not rewrite the fun fact — try again");
  }

  // Persist through the same fenced authoring RPC every other question edit
  // uses, so this cannot race a Start or a concurrent slot change.
  const admin = getSupabaseAdmin();
  const result = await (admin.rpc as unknown as (
    name: "apply_question_authoring_patch",
    args: { p_question_id: string; p_patch: Record<string, unknown> },
  ) => PromiseLike<{
    data: Record<string, unknown> | null;
    error: { message?: string } | null;
  }>)("apply_question_authoring_patch", {
    p_question_id: questionId,
    // `null` is meaningful: Claude gave us nothing usable, so the question
    // ends up with no fun fact rather than the previous question's.
    p_patch: { fact_blurb: blurb },
  });
  if (result.error || !result.data) {
    return serverError(
      `failed to save the fun fact: ${result.error?.message ?? "unknown"}`,
    );
  }

  return ok({ question: result.data, blurb });
}
