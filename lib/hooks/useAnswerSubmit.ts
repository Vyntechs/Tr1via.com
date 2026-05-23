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
}

const DEFAULT_BACKOFF = [500, 1000, 2000];

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
  const lastSlotRef = useRef<1 | 2 | 3 | 4 | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    // Reset on question change.
    lastSlotRef.current = null;
    cancelledRef.current = false;
    setStatus("idle");
    return () => {
      cancelledRef.current = true;
    };
  }, [questionId]);

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
          setStatus("sent");
          return;
        }
        if (isTerminalClientError(res.status)) {
          setStatus("failed");
          return;
        }
        // Transient (5xx or 429) — fall through to retry.
      } catch {
        if (cancelledRef.current) return;
        // Network error — fall through to retry.
      }
      if (attempt + 1 >= maxAttempts) {
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

  const submit = useCallback(
    (slot: 1 | 2 | 3 | 4) => {
      if (status === "pending" || status === "sent") return;
      lastSlotRef.current = slot;
      setStatus("pending");
      runAttempt(slot, 0);
    },
    [status, runAttempt],
  );

  const retry = useCallback(() => {
    if (status !== "failed") return;
    const slot = lastSlotRef.current;
    if (!slot) return;
    setStatus("pending");
    runAttempt(slot, 0);
  }, [status, runAttempt]);

  return { status, submit, retry };
}
