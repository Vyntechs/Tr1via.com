// Announces questions the database clock closed. close_due_questions() can only
// write a row; it can't reach the phones. Any request that lands afterwards
// drains the queue and sends the reveal, so a close is heard as soon as one
// device gets through.
//
// This protects sweep closes only. A route close keeps its own single
// best-effort broadcast and never touches this table.
//
// Delivery rule: a timeout may have been delivered, so it is stamped and never
// resent. A send that clearly didn't arrive stays unstamped, and the claim's
// 3-second lease brings it round again within the 60-second budget.

import "server-only";

import { after } from "next/server";

import { broadcastFireworks, broadcastToRoom } from "@/lib/api/broadcast";
import { broadcastErrorKind } from "@/lib/diagnostics/classify";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/types";

type AdminClient = ReturnType<typeof getSupabaseAdmin>;
type CloseEventRow = Database["public"]["Tables"]["question_close_events"]["Row"];

export const DRAIN_MIN_GAP_MS = 1_000;
const CLAIM_TIMEOUT_MS = 750;

let lastDrainAtMs = Number.NEGATIVE_INFINITY;
let running: Promise<void> | null = null;

function logOutbox(row: CloseEventRow, outcome: string): void {
  console.info(
    JSON.stringify({
      kind: "close_outbox",
      questionId: row.question_id,
      roomCode: row.room_code,
      outcome,
      claimCount: row.claim_count,
      sinceCloseMs: Date.now() - Date.parse(row.closed_at),
    }),
  );
}

async function sendClose(admin: AdminClient, row: CloseEventRow): Promise<void> {
  let sentVia = "rest";
  try {
    await broadcastToRoom(row.room_code, "resolve", {
      questionId: row.question_id,
      correctIndex: row.correct_index,
      refetch: true,
      serverNow: new Date().toISOString(),
    });
  } catch (error) {
    const kind = broadcastErrorKind(error);
    if (kind !== "timeout") {
      logOutbox(row, `refused:${kind}`);
      return;
    }
    sentVia = "rest-timeout";
  }

  const { error: stampError } = await admin
    .from("question_close_events")
    .update({ sent_at: new Date().toISOString(), sent_via: sentVia })
    .eq("id", row.id);
  if (stampError) console.warn("close outbox stamp failed");
  logOutbox(row, sentVia);

  try {
    await broadcastFireworks(row.room_code, "salvo", row.question_id);
  } catch {
    console.warn("broadcast fireworks(salvo) failed");
  }
}

async function drainOnce(admin: AdminClient): Promise<void> {
  const { data, error } = await admin
    .rpc("claim_close_broadcasts")
    .abortSignal(AbortSignal.timeout(CLAIM_TIMEOUT_MS));
  if (error) {
    console.warn("close outbox claim failed");
    return;
  }
  await Promise.all((data ?? []).map((row) => sendClose(admin, row)));
}

/**
 * Runs at most once a second per instance, and never throws. `urgent` is for
 * reveal, which must get a queued close out ahead of the next question: it skips
 * the wait, and joins a drain already running rather than starting a second.
 */
export function drainCloseOutbox(
  admin: AdminClient,
  { urgent = false }: { urgent?: boolean } = {},
): Promise<void> {
  if (running) return running;
  const now = Date.now();
  if (!urgent && now - lastDrainAtMs < DRAIN_MIN_GAP_MS) return Promise.resolve();
  lastDrainAtMs = now;
  running = (async () => {
    try {
      await drainOnce(admin);
    } catch {
      console.warn("close outbox drain failed");
    } finally {
      running = null;
    }
  })();
  return running;
}

/** Drains once the response is out. A no-op outside a request. */
export function scheduleCloseDrain(): void {
  try {
    after(() => drainCloseOutbox(getSupabaseAdmin()));
  } catch {
    // after() only works inside a request (not in a unit test or script).
  }
}

/** Test hook: forget the once-a-second limit between cases. */
export function __resetCloseOutboxForTests(): void {
  lastDrainAtMs = Number.NEGATIVE_INFINITY;
  running = null;
}
