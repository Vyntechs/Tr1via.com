// Announces questions the database clock closed. close_due_questions() can only
// write a row; it can't reach the phones. Any request that lands afterwards
// drains the queue and sends the reveal, so a close is heard as soon as one
// device gets through.
//
// This protects sweep closes only. A route close keeps its own single
// best-effort broadcast and never touches this table.
//
// Delivery rule: at most once, matching the resolve route's no-retry rule. The
// claim itself marks the row sent, so a lost write or a slow reply can't bring a
// delivered close round again. Only a definite refusal releases the row, and the
// claim's 3-second lease then retries it within the 60-second budget.
//
// The cost: a crash after the claim, or a claim whose reply is lost to its time
// limit, loses that one broadcast. Phones then catch up on their 15-second refresh.

import "server-only";

import { after } from "next/server";

import { broadcastFireworks, broadcastToRoom } from "@/lib/api/broadcast";
import { broadcastDefinitelyRefused, broadcastErrorKind } from "@/lib/diagnostics/classify";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/types";

type AdminClient = ReturnType<typeof getSupabaseAdmin>;
type CloseEventRow = Database["public"]["Tables"]["question_close_events"]["Row"];

export const DRAIN_MIN_GAP_MS = 1_000;
// Longer than the four 750ms steps in a row: claim, resolve, fireworks, label.
export const DRAIN_DEADLINE_MS = 4_000;
const DB_TIMEOUT_MS = 750;

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

async function writeRow(
  admin: AdminClient,
  row: CloseEventRow,
  values: Pick<CloseEventRow, "sent_via"> & Partial<Pick<CloseEventRow, "sent_at">>,
): Promise<boolean> {
  try {
    const { error } = await admin
      .from("question_close_events")
      .update(values)
      .eq("id", row.id)
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS));
    return !error;
  } catch {
    return false;
  }
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
    if (broadcastDefinitelyRefused(error)) {
      const released = await writeRow(admin, row, { sent_at: null, sent_via: null });
      logOutbox(row, `${released ? "refused" : "refused-not-released"}:${kind}`);
      return;
    }
    sentVia = `rest-${kind}`;
  }
  logOutbox(row, sentVia);

  try {
    await broadcastFireworks(row.room_code, "salvo", row.question_id);
  } catch {
    console.warn("broadcast fireworks(salvo) failed");
  }

  // Only a label for the logs. The claim already marked the row sent.
  if (!(await writeRow(admin, row, { sent_via: sentVia }))) {
    console.warn("close outbox label failed");
  }
}

async function drainOnce(admin: AdminClient): Promise<void> {
  const { data, error } = await admin
    .rpc("claim_close_broadcasts")
    .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS));
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
 * The deadline lets go of a drain that never settles, so one stuck call can't
 * block every later drain on this instance. Its rows stay marked sent.
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
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        drainOnce(admin),
        new Promise<void>((resolve) => {
          deadline = setTimeout(() => {
            console.warn("close outbox drain hit its deadline");
            resolve();
          }, DRAIN_DEADLINE_MS);
        }),
      ]);
    } catch {
      console.warn("close outbox drain failed");
    } finally {
      clearTimeout(deadline);
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
