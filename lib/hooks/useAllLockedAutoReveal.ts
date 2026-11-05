"use client";

import { useEffect, useRef } from "react";
import {
  ALL_LOCKED_AUTO_REVEAL_GRACE_MS,
  type AllLockedAutoRevealDecision,
} from "@/lib/game/allLockedAutoReveal";

/**
 * How long to wait before each retry of a failed auto-end. Past these the hook
 * stops: the timer closes the question anyway, and "Show answer now" still works.
 */
export const AUTO_REVEAL_RETRY_DELAYS_MS = [1_200, 2_400, 4_800] as const;

export interface UseAllLockedAutoRevealOpts {
  questionId: string | null | undefined;
  decision: AllLockedAutoRevealDecision | null;
  onAutoReveal: () => boolean | void | Promise<boolean | void>;
  graceMs?: number;
}

export function useAllLockedAutoReveal({
  questionId,
  decision,
  onAutoReveal,
  graceMs = ALL_LOCKED_AUTO_REVEAL_GRACE_MS,
}: UseAllLockedAutoRevealOpts): void {
  const onAutoRevealRef = useRef(onAutoReveal);
  const firedQuestionRef = useRef<string | null>(null);
  const inFlightQuestionRef = useRef<string | null>(null);
  const latestQuestionIdRef = useRef<string | null | undefined>(questionId);
  const latestDecisionCompleteRef = useRef(Boolean(decision?.complete));
  const timeoutRef = useRef<number | null>(null);
  // Retries used on this question since everyone last became locked.
  const retriesRef = useRef<{ questionId: string; used: number } | null>(null);

  useEffect(() => {
    onAutoRevealRef.current = onAutoReveal;
  }, [onAutoReveal]);

  useEffect(() => {
    latestQuestionIdRef.current = questionId;
  }, [questionId]);

  useEffect(() => {
    latestDecisionCompleteRef.current = Boolean(decision?.complete);
  }, [decision?.complete]);

  useEffect(() => {
    if (!questionId) {
      firedQuestionRef.current = null;
      inFlightQuestionRef.current = null;
      retriesRef.current = null;
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    }
  }, [questionId]);

  useEffect(() => {
    const clearScheduled = () => {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };

    const scheduleAttempt = (targetQuestionId: string, delayMs: number) => {
      if (timeoutRef.current !== null) return;
      if (firedQuestionRef.current === targetQuestionId) return;
      if (inFlightQuestionRef.current === targetQuestionId) return;

      timeoutRef.current = window.setTimeout(() => {
        timeoutRef.current = null;
        if (!latestDecisionCompleteRef.current) return;
        if (latestQuestionIdRef.current !== targetQuestionId) return;
        if (firedQuestionRef.current === targetQuestionId) return;
        if (inFlightQuestionRef.current === targetQuestionId) return;

        inFlightQuestionRef.current = targetQuestionId;
        void Promise.resolve(onAutoRevealRef.current())
          .catch(() => false as const)
          .then((result) => {
            if (result === false) {
              if (inFlightQuestionRef.current === targetQuestionId) {
                inFlightQuestionRef.current = null;
              }
              if (
                latestQuestionIdRef.current === targetQuestionId &&
                latestDecisionCompleteRef.current
              ) {
                const used =
                  retriesRef.current?.questionId === targetQuestionId
                    ? retriesRef.current.used
                    : 0;
                const delay = AUTO_REVEAL_RETRY_DELAYS_MS[used];
                if (delay === undefined) return;
                retriesRef.current = { questionId: targetQuestionId, used: used + 1 };
                scheduleAttempt(targetQuestionId, delay);
              }
              return;
            }
            firedQuestionRef.current = targetQuestionId;
          })
          .finally(() => {
            if (inFlightQuestionRef.current === targetQuestionId) {
              inFlightQuestionRef.current = null;
            }
          });
      }, delayMs);
    };

    if (!questionId || !decision?.complete) {
      // Someone unlocked or joined, so the next "everyone locked" is new news.
      retriesRef.current = null;
      clearScheduled();
      return clearScheduled;
    }

    scheduleAttempt(questionId, graceMs);
    return clearScheduled;
  }, [decision?.complete, graceMs, questionId]);
}
