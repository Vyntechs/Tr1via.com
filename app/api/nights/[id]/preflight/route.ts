// GET /api/nights/:id/preflight — read-only Game 1 readiness evidence.
//
// This endpoint proves only facts available in Postgres plus the authenticated
// host control-path round-trip. Delivery to the venue TV and player browsers
// remains unknown until revision-backed observations exist.

import { requireOwnedNight } from "@/lib/api/auth";
import {
  forbidden,
  notFound,
  ok,
  serverError,
  unauthorized,
} from "@/lib/api/responses";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ContentStatus = "ready" | "invalid";

interface PickedQuestion {
  category_id: string;
  prompt: string;
  options: unknown;
  correct_index: number;
  point_value: number | null;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const startedAt = Date.now();
  const { id: nightId } = await context.params;
  const owned = await requireOwnedNight(nightId);
  if (!owned.ok) {
    if (owned.status === 401) return unauthorized(owned.error);
    if (owned.status === 403) return forbidden(owned.error);
    return notFound(owned.error);
  }

  try {
    const admin = getSupabaseAdmin();
    const { data: game, error: gameError } = await admin
      .from("games")
      .select("id, state, category_count, question_count")
      .eq("night_id", nightId)
      .eq("game_no", 1)
      .maybeSingle();
    if (gameError) throw gameError;

    let categories: Array<{ id: string; state: string }> = [];
    let questions: PickedQuestion[] = [];

    if (game) {
      const categoriesResult = await admin
        .from("categories")
        .select("id, state")
        .eq("game_id", game.id)
        .order("position", { ascending: true });
      if (categoriesResult.error) throw categoriesResult.error;
      categories = categoriesResult.data ?? [];

      const categoryIds = categories.map((category) => category.id);
      if (categoryIds.length > 0) {
        const questionsResult = await admin
          .from("questions")
          .select("category_id, prompt, options, correct_index, point_value")
          .in("category_id", categoryIds)
          .eq("is_picked", true);
        if (questionsResult.error) throw questionsResult.error;
        questions = (questionsResult.data ?? []) as PickedQuestion[];
      }
    }

    const playersResult = await admin
      .from("players")
      .select("id", { count: "exact", head: true })
      .eq("night_id", nightId)
      .is("removed_at", null);
    if (playersResult.error) throw playersResult.error;

    const expectedCategoryCount = game?.category_count ?? 0;
    const expectedQuestionCount = game
      ? game.category_count * game.question_count
      : 0;
    const contentReason = contentFailureReason({
      game,
      categories,
      questions,
      expectedCategoryCount,
      expectedQuestionCount,
    });
    const content: ContentStatus = contentReason ? "invalid" : "ready";
    const tv = owned.night.room_code.trim() ? "unknown" as const : "missing" as const;
    const controls = owned.night.closed_at ? "unavailable" as const : "ready" as const;
    const startReason = controls === "unavailable"
      ? "This trivia night is closed."
      : contentReason ?? (tv === "missing" ? "The venue TV surface is unavailable." : null);

    return ok({
      checks: {
        content,
        tv,
        players: "unknown" as const,
        // This is the server/database request path, not venue Wi-Fi reachability.
        network: "control-path-healthy" as const,
        controls,
      },
      canStart: startReason === null,
      startReason,
      checkedAt: new Date().toISOString(),
      elapsedMs: Math.max(0, Date.now() - startedAt),
      playerCount: playersResult.count ?? 0,
      content: {
        gameId: game?.id ?? null,
        categoryCount: categories.length,
        expectedCategoryCount,
        pickedQuestionCount: questions.length,
        expectedQuestionCount,
        reason: contentReason,
      },
    });
  } catch {
    return serverError("could not check game readiness");
  }
}

function contentFailureReason(input: {
  game: {
    id: string;
    state: string;
    category_count: number;
    question_count: number;
  } | null;
  categories: Array<{ id: string; state: string }>;
  questions: PickedQuestion[];
  expectedCategoryCount: number;
  expectedQuestionCount: number;
}): string | null {
  if (!input.game) return "Game 1 is missing.";
  if (input.game.state !== "ready") return "Game 1 is not marked ready.";
  if (input.game.category_count <= 0 || input.game.question_count <= 0) {
    return "Game 1 has invalid board dimensions.";
  }
  if (
    input.categories.length !== input.expectedCategoryCount ||
    input.categories.some((category) => category.state !== "ready")
  ) {
    return `Game 1 needs ${input.expectedCategoryCount} ready ${pluralize("category", input.expectedCategoryCount)} before it can start.`;
  }
  if (input.questions.length !== input.expectedQuestionCount) {
    return `Game 1 needs ${input.expectedQuestionCount} picked ${pluralize("question", input.expectedQuestionCount)} before it can start.`;
  }
  if (input.questions.some((question) => !isCompleteQuestion(question))) {
    return "A picked question is incomplete.";
  }

  const canonicalPoints = Array.from(
    { length: input.game.question_count },
    (_, index) => (index + 1) * 100,
  );
  const hasCanonicalDistribution = input.categories.every((category) => {
    const points = input.questions
      .filter((question) => question.category_id === category.id)
      .map((question) => question.point_value)
      .sort((left, right) => (left ?? 0) - (right ?? 0));
    return (
      points.length === canonicalPoints.length &&
      points.every((point, index) => point === canonicalPoints[index])
    );
  });
  if (!hasCanonicalDistribution) {
    return `Every category needs exactly ${input.game.question_count} canonical point ${pluralize("slot", input.game.question_count)}.`;
  }
  return null;
}

function isCompleteQuestion(question: PickedQuestion): boolean {
  return (
    question.prompt.trim().length > 0 &&
    Array.isArray(question.options) &&
    question.options.length === 4 &&
    question.options.every((option) => typeof option === "string" && option.trim().length > 0) &&
    Number.isInteger(question.correct_index) &&
    question.correct_index >= 0 &&
    question.correct_index < 4 &&
    question.point_value !== null
  );
}

function pluralize(word: string, count: number): string {
  return count === 1 ? word : `${word}s`;
}
