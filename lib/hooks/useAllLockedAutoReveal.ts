"use client";

import { useEffect, useRef } from "react";
import {
  ALL_LOCKED_AUTO_REVEAL_GRACE_MS,
  type AllLockedAutoRevealDecision,
} from "@/lib/game/allLockedAutoReveal";

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

    const scheduleAttempt = (targetQuestionId: string) => {
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
          .then((result) => {
            if (result === false) {
              if (inFlightQuestionRef.current === targetQuestionId) {
                inFlightQuestionRef.current = null;
              }
              if (
                latestQuestionIdRef.current === targetQuestionId &&
                latestDecisionCompleteRef.current
              ) {
                scheduleAttempt(targetQuestionId);
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
      }, graceMs);
    };

    if (!questionId || !decision?.complete) {
      clearScheduled();
      return clearScheduled;
    }

    scheduleAttempt(questionId);
    return clearScheduled;
  }, [decision?.complete, graceMs, questionId]);
}
