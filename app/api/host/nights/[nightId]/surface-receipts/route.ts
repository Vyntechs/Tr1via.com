import { z } from "zod";

import { requireOwnedNight } from "@/lib/api/auth";
import {
  badRequest,
  forbidden,
  noContent,
  notFound,
  serverError,
  unauthorized,
} from "@/lib/api/responses";
import { recordHostSurfaceEvent } from "@/lib/evidence/incidentEvidence";
import { questionDurationFor } from "@/lib/theme/lockInCeremony";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

const BodySchema = z.object({
  questionId: z.string().uuid(),
  frameKind: z.enum(["question_open", "timer_zero", "answer_reveal"]),
  surfaceInstanceId: z.string().uuid(),
  clientRelease: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
}).strict();

export async function POST(
  request: Request,
  context: { params: Promise<{ nightId: string }> },
) {
  const { nightId } = await context.params;
  const owned = await requireOwnedNight(nightId);
  if (!owned.ok) {
    if (owned.status === 401) return unauthorized(owned.error);
    if (owned.status === 403) return forbidden(owned.error);
    return notFound(owned.error);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest("invalid JSON");
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error);

  // The first receipt slice deliberately covers the current legacy game. It
  // is independent from the future connection-protection engine.
  if (owned.night.answer_engine !== "legacy") return noContent();

  const admin = getSupabaseAdmin();
  const { data: question, error: questionError } = await admin
    .from("questions")
    .select("id, category_id, played_at, finished_at")
    .eq("id", parsed.data.questionId)
    .maybeSingle();
  if (questionError) return serverError();
  if (!question) return notFound("question not found");

  const { data: category, error: categoryError } = await admin
    .from("categories")
    .select("game_id")
    .eq("id", question.category_id)
    .maybeSingle();
  if (categoryError) return serverError();
  if (!category) return notFound("category not found");
  const { data: game, error: gameError } = await admin
    .from("games")
    .select("id, night_id")
    .eq("id", category.game_id)
    .maybeSingle();
  if (gameError) return serverError();
  if (!game || game.night_id !== nightId) return forbidden("wrong night");

  const playedAtMs = question.played_at
    ? Date.parse(question.played_at)
    : Number.NaN;
  const finishedAtMs = question.finished_at
    ? Date.parse(question.finished_at)
    : Number.NaN;
  let authoritativeAt: string | null = null;
  if (parsed.data.frameKind === "question_open" && Number.isFinite(playedAtMs)) {
    authoritativeAt = new Date(playedAtMs).toISOString();
  } else if (
    parsed.data.frameKind === "timer_zero" &&
    Number.isFinite(playedAtMs)
  ) {
    authoritativeAt = new Date(
      playedAtMs + questionDurationFor(undefined) * 1_000,
    ).toISOString();
  } else if (
    parsed.data.frameKind === "answer_reveal" &&
    Number.isFinite(finishedAtMs)
  ) {
    authoritativeAt = new Date(finishedAtMs).toISOString();
  }
  if (!authoritativeAt) return badRequest("frame is not canonical");

  const stored = await recordHostSurfaceEvent({
    nightId,
    hostId: owned.host.id,
    answerEngine: "legacy",
    gameId: game.id,
    questionId: question.id,
    stage: parsed.data.frameKind,
    authoritativeAt,
    currentWhenReceived:
      parsed.data.frameKind === "answer_reveal"
        ? Number.isFinite(finishedAtMs)
        : !Number.isFinite(finishedAtMs),
    surfaceInstanceId: parsed.data.surfaceInstanceId,
    releaseId: parsed.data.clientRelease === "unknown"
      ? undefined
      : parsed.data.clientRelease,
    traceId: (() => {
      const value = request.headers.get("x-vercel-id")?.trim();
      return value && value.length <= 128 ? value : undefined;
    })(),
  });
  return stored ? noContent() : serverError("could not store display receipt");
}
