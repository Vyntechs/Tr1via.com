"use client";

import { useEffect, useRef } from "react";
import {
  ALL_LOCKED_AUTO_REVEAL_GRACE_MS,
  type AllLockedAutoRevealDecision,
} from "@/lib/game/allLockedAutoReveal";

export interface UseAllLockedAutoRevealOpts {
  questionId: string | null | undefined;
  decision: AllLockedAutoRevealDecision | null;
  onAutoReveal: () => void | Promise<void>;
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

  useEffect(() => {
    onAutoRevealRef.current = onAutoReveal;
  }, [onAutoReveal]);

  useEffect(() => {
    if (!questionId || !decision?.complete) return;
    if (firedQuestionRef.current === questionId) return;

    const handle = window.setTimeout(() => {
      if (firedQuestionRef.current === questionId) return;
      firedQuestionRef.current = questionId;
      void onAutoRevealRef.current();
    }, graceMs);

    return () => window.clearTimeout(handle);
  }, [decision?.complete, graceMs, questionId]);

  useEffect(() => {
    if (!questionId) {
      firedQuestionRef.current = null;
    }
  }, [questionId]);
}
