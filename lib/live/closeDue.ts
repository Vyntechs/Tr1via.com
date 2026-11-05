// The server's own close for a legacy question that nobody closed in time.
//
// Three callers: the alarm in the reveal route, and the snapshot ticks on the
// room and TV routes. All of them wait until 1.2s past the deadline, so phones
// and the TV keep closing at zero as they do today and this only picks up what
// they missed. It can never end a question early.
//
// resolve_question_once decides the single winner, so a close from here and a
// close from /resolve can race safely. Only the winner broadcasts.

import { broadcastFireworks, broadcastToRoom } from "@/lib/api/broadcast";
import { afterReply } from "@/lib/live/afterReply";
import { liveCloseModeFor } from "@/lib/live/liveCloseMode";
import {
  closeLateMs,
  logAlarmWake,
  logClose,
  logWouldClose,
  type ClosedBy,
  type CloseSource,
} from "@/lib/live/logClose";
import { repairQuestionScoresCapped, withCap } from "@/lib/live/scoreLateAnswers";
import type { getSupabaseAdmin } from "@/lib/supabase/admin";
import { questionDurationFor } from "@/lib/theme/lockInCeremony";
import type { ThemeKey } from "@/lib/theme/tokens";

type AdminClient = ReturnType<typeof getSupabaseAdmin>;

export const CLOSE_DUE_AFTER_MS = 1_200;
const MAX_QUESTION_AGE_MS = 10 * 60_000;
const RPC_RETRY_WAIT_MS = 500;
const TICK_CAP_MS = 1_500;
const TICK_SPACING_MS = 500;
const TICK_MEMO_LIMIT = 256;

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function broadcastLegacyResolveBestEffort(
  roomCode: string,
  payload: {
    questionId: string;
    correctIndex: number;
    refetch: true;
    serverNow: string;
  },
): Promise<void> {
  try {
    await broadcastToRoom(roomCode, "resolve", payload);
  } catch {
    // A timeout can mean Supabase accepted the broadcast but its acknowledgement
    // was lost. Do not retry and amplify one commit into two room-wide refetches;
    // durable Postgres Changes and snapshot recovery cover a truly missed signal.
    console.warn("broadcast resolve failed");
  }
}

/**
 * Stamps who closed it on the question's resolve row, keeping what is there:
 * the host reads correct_index from this column. Winners only, at close time.
 * Callers run this only when the mode is on. The host ignores reveals updates,
 * since a later write to this row could otherwise flip a mirrored TV.
 */
export async function recordCloseOnResolveRow(
  admin: AdminClient,
  close: { questionId: string; closedBy: ClosedBy; lateMs: number | null },
): Promise<void> {
  try {
    const { data: row, error } = await admin
      .from("reveals")
      .select("id, metadata")
      .eq("question_id", close.questionId)
      .eq("event", "resolve")
      .order("occurred_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !row) return;
    const existing = (row.metadata ?? {}) as Record<string, unknown>;
    const { error: writeError } = await admin
      .from("reveals")
      .update({
        metadata: {
          ...existing,
          closed_by: close.closedBy,
          late_ms: close.lateMs,
        },
      })
      .eq("id", row.id);
    if (writeError) console.warn("close record not written");
  } catch {
    console.warn("close record not written");
  }
}

export type CloseOutcome = "won" | "lost" | "stale" | "not_due" | "shadow" | "off" | "error";

export interface CloseInput {
  questionId: string;
  expectedPlayedAt: string;
  nightId: string;
  roomCode: string;
  source: CloseSource;
  themeKey?: ThemeKey;
}

type DueCheck =
  | { due: false; outcome: CloseOutcome }
  | { due: true; correctIndex: number; dueAtMs: number };

async function checkDue(
  admin: AdminClient,
  input: CloseInput,
): Promise<DueCheck> {
  const { data: q, error } = await admin
    .from("questions")
    .select("played_at, finished_at, correct_index")
    .eq("id", input.questionId)
    .maybeSingle();
  if (error) return { due: false, outcome: "error" };
  if (!q?.played_at) return { due: false, outcome: "stale" };

  // As times: the reveal route stamps "...Z" and Postgres hands back "+00:00".
  const playedAtMs = Date.parse(q.played_at);
  if (playedAtMs !== Date.parse(input.expectedPlayedAt)) {
    return { due: false, outcome: "stale" };
  }
  if (q.finished_at) return { due: false, outcome: "lost" };

  const nowMs = Date.now();
  if (nowMs - playedAtMs >= MAX_QUESTION_AGE_MS) {
    return { due: false, outcome: "stale" };
  }
  const dueAtMs = playedAtMs + questionDurationFor(input.themeKey) * 1_000;
  if (nowMs < dueAtMs + CLOSE_DUE_AFTER_MS) {
    return { due: false, outcome: "not_due" };
  }
  return { due: true, correctIndex: q.correct_index, dueAtMs };
}

export async function closeQuestionIfDue(
  admin: AdminClient,
  input: CloseInput,
): Promise<CloseOutcome> {
  const mode = liveCloseModeFor(input.nightId);
  if (mode === "off") return "off";

  let check = await checkDue(admin, input);
  if (!check.due) return check.outcome;
  if (mode === "shadow") {
    logWouldClose({
      questionId: input.questionId,
      roomCode: input.roomCode,
      source: input.source,
      lateMs: closeLateMs(Date.now(), check.dueAtMs),
    });
    return "shadow";
  }

  let result = await admin.rpc("resolve_question_once", {
    p_question_id: input.questionId,
  });
  if (result.error && result.error.code !== "P0001") {
    await sleep(RPC_RETRY_WAIT_MS);
    check = await checkDue(admin, input);
    if (!check.due) return check.outcome;
    result = await admin.rpc("resolve_question_once", {
      p_question_id: input.questionId,
    });
  }
  if (result.error) {
    // P0001 is the function's own raise: the question is gone or was undone.
    return result.error.code === "P0001" ? "stale" : "error";
  }
  if (!result.data) return "lost";

  const closedAtMs = Date.now();
  await broadcastLegacyResolveBestEffort(input.roomCode, {
    questionId: input.questionId,
    correctIndex: check.correctIndex,
    refetch: true,
    serverNow: new Date(closedAtMs).toISOString(),
  });
  try {
    await broadcastFireworks(input.roomCode, "salvo", input.questionId);
  } catch {
    console.warn("broadcast fireworks(salvo) failed");
  }

  const lateMs = closeLateMs(closedAtMs, check.dueAtMs);
  logClose({
    questionId: input.questionId,
    roomCode: input.roomCode,
    closedBy: input.source,
    lateMs,
  });
  await recordCloseOnResolveRow(admin, {
    questionId: input.questionId,
    closedBy: input.source,
    lateMs,
  });

  await repairQuestionScoresCapped(admin, {
    questionId: input.questionId,
    nightId: input.nightId,
    roomCode: input.roomCode,
  });
  return "won";
}

/**
 * The reveal route's alarm: sleep to 1.2s past the deadline, then close. Most
 * wakes lose to a browser, which is fine, and every wake logs, so the log shows
 * whether the alarm really runs on each question. Undo or re-reveal changes
 * played_at, so a stale alarm stops at the first read.
 */
export async function runCloseAlarm(
  admin: AdminClient,
  input: Omit<CloseInput, "source">,
): Promise<void> {
  const wakeAtMs =
    Date.parse(input.expectedPlayedAt) +
    questionDurationFor(input.themeKey) * 1_000 +
    CLOSE_DUE_AFTER_MS;
  // A loop because a timer can fire a hair early, and that would read as not due.
  for (let left = wakeAtMs - Date.now(); left > 0; left = wakeAtMs - Date.now()) {
    await sleep(left);
  }
  const lateMs = Date.now() - wakeAtMs;
  const outcome = await closeQuestionIfDue(admin, {
    ...input,
    source: "alarm",
  }).catch((): CloseOutcome => "error");
  logAlarmWake({ questionId: input.questionId, outcome, lateMs });
}

// Per instance. Fifty phones polling an overdue question should cost one
// attempt, and the rest skip past with no database call.
const lastTickAtMs = new Map<string, number>();

function claimTick(questionId: string, nowMs: number): boolean {
  const last = lastTickAtMs.get(questionId);
  if (last !== undefined && nowMs - last < TICK_SPACING_MS) return false;
  if (lastTickAtMs.size >= TICK_MEMO_LIMIT) lastTickAtMs.clear();
  lastTickAtMs.set(questionId, nowMs);
  return true;
}

export function clearCloseTicksForTest(): void {
  lastTickAtMs.clear();
}

/**
 * A snapshot request that lands past the due time closes the question. It runs
 * inline because after() may not finish when the reply can't be delivered, and
 * that is the very case this exists for. The cost is a slower reply on the one
 * snapshot that does the close, capped so a stuck database can't hold it. Past
 * the cap the close keeps going and after() is asked to carry it.
 */
export async function closeOverdueOnTick(
  admin: AdminClient,
  tick: {
    answerEngine: string | undefined;
    gameIsLive: boolean;
    question: { id: string; played_at: string | null } | null;
    nightId: string;
    roomCode: string;
    source: CloseSource;
    themeKey?: ThemeKey;
  },
): Promise<void> {
  const { question } = tick;
  if (tick.answerEngine !== "legacy" || !tick.gameIsLive) return;
  if (!question?.played_at) return;
  const nowMs = Date.now();
  const dueAtMs =
    Date.parse(question.played_at) +
    questionDurationFor(tick.themeKey) * 1_000 +
    CLOSE_DUE_AFTER_MS;
  if (!(nowMs >= dueAtMs)) return;
  if (liveCloseModeFor(tick.nightId) === "off") return;
  if (!claimTick(question.id, nowMs)) return;

  const closing = closeQuestionIfDue(admin, {
    questionId: question.id,
    expectedPlayedAt: question.played_at,
    nightId: tick.nightId,
    roomCode: tick.roomCode,
    source: tick.source,
    themeKey: tick.themeKey,
  }).catch(() => {
    console.warn("tick close failed");
  });
  afterReply(() => closing);
  await withCap(closing, TICK_CAP_MS);
}
