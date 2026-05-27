// useAnswerSubmit — optimistic POST /api/answers with exponential backoff
// retry on transient failures.
//
// State machine:
//   idle    → submit(slot) → pending
//   pending → 2xx or 409   → sent          (terminal, stays sent for this question)
//   pending → other 4xx    → failed        (no retry; usually a bug, not flaky)
//   pending → 5xx / network→ pending       (retry with backoff)
//   pending → exhausted    → failed        (after maxAttempts)
//   failed  → retry()      → pending       (manual re-attempt from the UI)
//
// The 20-second question timer caps the total useful retry window, so the
// default backoff schedule (500ms, 1s, 2s) over 4 attempts keeps the last
// retry under ~8s — fast enough to still hit the question.
//
// Refresh-survives-the-answer: on submit we persist {questionId, slotChosen}
// to localStorage. If the page unmounts mid-retry (player refreshes or closes
// Safari and reopens), the next mount on the same questionId reads it and
// re-fires the submit. Cleared on `sent`. The server is idempotent via the
// unique (question_id, player_id) constraint + 409 handling, so a double-fire
// is safe.

"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type AnswerSubmitStatus = "idle" | "pending" | "sent" | "failed";

export interface UseAnswerSubmitOptions {
  questionId: string;
  scramble: number[];
  /** Default 4. */
  maxAttempts?: number;
  /** Default [500, 1000, 2000] (ms between attempts). */
  backoffMs?: number[];
}

export interface UseAnswerSubmitResult {
  status: AnswerSubmitStatus;
  /** Lock + send the chosen slot (1..4). Idempotent — no-op if pending/sent. */
  submit: (slot: 1 | 2 | 3 | 4) => void;
  /** Re-attempt after a failed terminal. No-op if not failed. */
  retry: () => void;
  /**
   * Timestamp (Date.now()) set the moment the server confirms the answer.
   * null until then. Task 15 uses this to fire the lock-in ceremony only after
   * the DB has the answer — not on the tap itself.
   */
  confirmedAt: number | null;
}

const DEFAULT_BACKOFF = [500, 1000, 2000];

export const PENDING_ANSWER_KEY = "tr1via:pending-answer";

export interface PendingAnswer {
  questionId: string;
  slotChosen: 1 | 2 | 3 | 4;
}

export function loadPendingAnswer(): PendingAnswer | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PENDING_ANSWER_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as unknown;
    if (
      !p ||
      typeof p !== "object" ||
      typeof (p as { questionId?: unknown }).questionId !== "string" ||
      ![1, 2, 3, 4].includes((p as { slotChosen?: unknown }).slotChosen as number)
    ) {
      return null;
    }
    const obj = p as { questionId: string; slotChosen: number };
    return { questionId: obj.questionId, slotChosen: obj.slotChosen as 1 | 2 | 3 | 4 };
  } catch {
    return null;
  }
}

function savePendingAnswer(p: PendingAnswer): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PENDING_ANSWER_KEY, JSON.stringify(p));
  } catch {
    // Storage full or disabled (private browsing on some browsers) — best-effort.
  }
}

export function clearPendingAnswer(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(PENDING_ANSWER_KEY);
  } catch {
    // Ignore — storage layer is best-effort.
  }
}

function isTerminalClientError(status: number): boolean {
  // 4xx that we won't retry. 409 is "already answered" which is success-equivalent.
  return status >= 400 && status < 500 && status !== 409 && status !== 429;
}

function shouldTreatAsSent(status: number): boolean {
  return (status >= 200 && status < 300) || status === 409;
}

export function useAnswerSubmit({
  questionId,
  scramble,
  maxAttempts = 4,
  backoffMs = DEFAULT_BACKOFF,
}: UseAnswerSubmitOptions): UseAnswerSubmitResult {
  const [status, setStatus] = useState<AnswerSubmitStatus>("idle");
  const [confirmedAt, setConfirmedAt] = useState<number | null>(null);
  const lastSlotRef = useRef<1 | 2 | 3 | 4 | null>(null);
  const cancelledRef = useRef(false);

  const runAttempt = useCallback(
    async (slot: 1 | 2 | 3 | 4, attempt: number) => {
      try {
        const res = await fetch("/api/answers", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ questionId, slotChosen: slot, scramble }),
        });
        if (cancelledRef.current) return;
        if (shouldTreatAsSent(res.status)) {
          clearPendingAnswer();
          setConfirmedAt(Date.now());
          setStatus("sent");
          return;
        }
        if (isTerminalClientError(res.status)) {
          // The question is closed or the request is malformed. There is no
          // useful future retry; drop the persisted entry so we don't fire
          // again on next mount.
          clearPendingAnswer();
          setStatus("failed");
          return;
        }
        // Transient (5xx or 429) — fall through to retry.
      } catch {
        if (cancelledRef.current) return;
        // Network error — fall through to retry.
      }
      if (attempt + 1 >= maxAttempts) {
        // Exhausted in-memory retries. Leave the localStorage entry alone:
        // if the player refreshes, the next mount will auto-resume.
        setStatus("failed");
        return;
      }
      const delay = backoffMs[Math.min(attempt, backoffMs.length - 1)] ?? backoffMs[backoffMs.length - 1] ?? 1000;
      setTimeout(() => {
        if (!cancelledRef.current) runAttempt(slot, attempt + 1);
      }, delay);
    },
    [questionId, scramble, maxAttempts, backoffMs],
  );

  useEffect(() => {
    // Reset on question change.
    lastSlotRef.current = null;
    cancelledRef.current = false;
    setStatus("idle");
    setConfirmedAt(null);

    // Refresh-survives-the-answer: if the player closed/refreshed mid-retry
    // for THIS question, the persisted slot is still in localStorage. Resume
    // the submission. The server is idempotent (409 → treated as sent), so
    // re-firing after a partial first attempt is safe.
    const pending = loadPendingAnswer();
    if (pending) {
      if (pending.questionId === questionId) {
        lastSlotRef.current = pending.slotChosen;
        setStatus("pending");
        void runAttempt(pending.slotChosen, 0);
      } else {
        // Stale entry for a different question — clear so it doesn't fire later.
        clearPendingAnswer();
      }
    }

    return () => {
      cancelledRef.current = true;
    };
    // runAttempt depends on the same `questionId` that gates this effect, so
    // including it would create a redundant re-run on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questionId]);

  const submit = useCallback(
    (slot: 1 | 2 | 3 | 4) => {
      if (status === "pending" || status === "sent") return;
      lastSlotRef.current = slot;
      savePendingAnswer({ questionId, slotChosen: slot });
      setStatus("pending");
      runAttempt(slot, 0);
    },
    [status, runAttempt, questionId],
  );

  const retry = useCallback(() => {
    if (status !== "failed") return;
    const slot = lastSlotRef.current;
    if (!slot) return;
    savePendingAnswer({ questionId, slotChosen: slot });
    setStatus("pending");
    runAttempt(slot, 0);
  }, [status, runAttempt, questionId]);

  return { status, submit, retry, confirmedAt };
}
