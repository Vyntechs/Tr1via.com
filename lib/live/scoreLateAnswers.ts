// Scores answers that were saved just after the close ran. resolve_question
// scores what it can see, so a row committing behind it stays is_correct null
// and earns nothing unless someone comes back for it.
//
// The rule here must match resolve_question in SQL. lib/game/score.ts is that
// rule in TypeScript, and tests pin the two together.
//
// This never writes to the resolve row of `reveals`. An update there can
// replace `currentReveal` and flip a mirrored TV, so the screens hear about a
// repair through one refetch hint instead.

import { broadcastToRoom } from "@/lib/api/broadcast";
import { awardPoints } from "@/lib/game/score";
import { afterReply } from "@/lib/live/afterReply";
import { liveCloseModeFor } from "@/lib/live/liveCloseMode";
import { logLateScored, logRepair } from "@/lib/live/logClose";
import type { getSupabaseAdmin } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof getSupabaseAdmin>;

/** Keeps the old unscored rows from past shows out of reach. */
export const REPAIR_WINDOW_MS = 10 * 60_000;
export const REFETCH_HINT_DELAY_MS = 2_000;
const REPAIR_CAP_MS = 1_000;

/** Stops waiting at `ms`. The work itself keeps running. */
export function withCap(work: Promise<unknown>, ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    work.then(done, done);
  });
}

export async function scoreLateAnswers(
  admin: AdminClient,
  questionId: string,
  { dryRun = false }: { dryRun?: boolean } = {},
): Promise<number> {
  const { data: q, error: questionError } = await admin
    .from("questions")
    .select("correct_index, point_value, finished_at")
    .eq("id", questionId)
    .maybeSingle();
  if (questionError || !q?.finished_at) return 0;
  const finishedAtMs = Date.parse(q.finished_at);
  if (!(Date.now() - finishedAtMs < REPAIR_WINDOW_MS)) return 0;

  const { data: rows, error: rowsError } = await admin
    .from("answers")
    .select("id, chosen_index, ms_to_lock, locked_at")
    .eq("question_id", questionId)
    .is("is_correct", null);
  if (rowsError || !rows || rows.length === 0) return 0;
  if (dryRun) return rows.length;

  const written = await Promise.all(
    rows.map(async (row) => {
      const correct = row.chosen_index === q.correct_index;
      const { data, error } = await admin
        .from("answers")
        .update({
          is_correct: correct,
          awarded_points: awardPoints({
            pointValue: q.point_value ?? 0,
            correct,
            msToLock: row.ms_to_lock,
          }),
        })
        .eq("id", row.id)
        .is("is_correct", null)
        .select("id");
      if (error || !data || data.length === 0) return 0;
      const lockedAtMs = Date.parse(row.locked_at);
      if (lockedAtMs >= finishedAtMs) {
        logLateScored({
          questionId,
          answerId: row.id,
          msPastClose: lockedAtMs - finishedAtMs,
        });
      }
      return 1;
    }),
  );
  return written.reduce<number>((sum, n) => sum + n, 0);
}

// Per instance, so a burst of resends that each repair a row sends one hint.
const hintsWaiting = new Set<string>();

function sendRefetchHintSoon(roomCode: string, questionId: string): void {
  if (hintsWaiting.has(questionId)) return;
  hintsWaiting.add(questionId);
  afterReply(async () => {
    await new Promise((resolve) => setTimeout(resolve, REFETCH_HINT_DELAY_MS));
    hintsWaiting.delete(questionId);
    try {
      await broadcastToRoom(roomCode, "scores-refetch", {
        questionId,
        serverNow: new Date().toISOString(),
      });
    } catch {
      console.warn("broadcast scores-refetch failed");
    }
  });
}

export interface RepairTarget {
  questionId: string;
  nightId: string;
  roomCode: string;
}

/** The one entry point for a repair. Obeys the switches. */
export async function repairQuestionScores(
  admin: AdminClient,
  target: RepairTarget,
): Promise<void> {
  const mode = liveCloseModeFor(target.nightId);
  if (mode === "off") return;
  const dryRun = mode === "shadow";
  const count = await scoreLateAnswers(admin, target.questionId, { dryRun });
  if (count === 0) return;
  logRepair({ questionId: target.questionId, rows: count, dryRun });
  if (!dryRun) sendRefetchHintSoon(target.roomCode, target.questionId);
}

interface SweepTarget {
  gameId: string;
  nightId: string;
  roomCode: string;
}

/** On the insert path: nothing for the phone to wait on. */
export function repairAfterReply(admin: AdminClient, target: RepairTarget): void {
  if (liveCloseModeFor(target.nightId) === "off") return;
  afterReply(() => repairQuestionScores(admin, target));
}

/**
 * Inline, for callers that can't trust after() to finish. Waits 1s at most, and
 * past that the repair keeps going and after() is asked to carry it.
 */
export async function repairQuestionScoresCapped(
  admin: AdminClient,
  target: RepairTarget,
): Promise<void> {
  if (liveCloseModeFor(target.nightId) === "off") return;
  const work = repairQuestionScores(admin, target).catch(() => {
    console.warn("score repair failed");
  });
  afterReply(() => work);
  await withCap(work, REPAIR_CAP_MS);
}

/**
 * The next reveal and the game's end come back for the question just before
 * them, in case the work above died with its function.
 */
async function repairLastFinishedQuestion(
  admin: AdminClient,
  target: SweepTarget,
): Promise<void> {
  const { data: categories, error: categoryError } = await admin
    .from("categories")
    .select("id")
    .eq("game_id", target.gameId);
  if (categoryError || !categories || categories.length === 0) return;
  const { data: last, error } = await admin
    .from("questions")
    .select("id")
    .in("category_id", categories.map((c) => c.id))
    .not("finished_at", "is", null)
    .order("finished_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !last) return;
  await repairQuestionScores(admin, {
    questionId: last.id,
    nightId: target.nightId,
    roomCode: target.roomCode,
  });
}

export function sweepLastFinishedAfterReply(
  admin: AdminClient,
  target: SweepTarget,
): void {
  if (liveCloseModeFor(target.nightId) === "off") return;
  afterReply(() => repairLastFinishedQuestion(admin, target));
}
