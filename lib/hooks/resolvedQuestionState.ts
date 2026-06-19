import type { QuestionRow } from "@/lib/supabase/types";

/**
 * Pick which question belongs in useRoom's single `lastResolvedQuestion` slot
 * when a new "resolved" value arrives.
 *
 * Rule: the MOST-recently-resolved question wins. A stale, duplicated, or
 * out-of-order broadcast / refetch for an OLDER question must never overwrite a
 * more-recently-resolved one. Without this guard the host live console oscillated
 * between two finished questions' REVEAL screens (2026-06-19 PROD): after
 * end-early(A) → pick + resolve(B), a redelivered broadcast for A (a venue-WiFi
 * delivery artifact) re-asserted A, and the 15s heartbeat restored B — back and
 * forth.
 *
 * Same id → take `incoming` so a metadata/correct_index backfill on the already-
 * resolved question still refreshes the slot.
 */
export function pickNewerResolvedQuestion(
  prev: QuestionRow | null,
  incoming: QuestionRow,
): QuestionRow {
  if (!prev) return incoming;
  if (prev.id === incoming.id) return incoming;
  // finished_at is an ISO-8601 string → lexicographic compare == chronological.
  return (incoming.finished_at ?? "") >= (prev.finished_at ?? "") ? incoming : prev;
}
