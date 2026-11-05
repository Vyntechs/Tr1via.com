// useResolveAtZero — runs the timer-zero ladder (lib/game/resolveAtZero.ts) at
// most once per question, and drops it when the question goes away. Call this
// before useTimer: a question that has already expired fires onZero during
// useTimer's first effect, and the reset below has to run first.

"use client";

import { useCallback, useEffect, useRef } from "react";
import { resolveAtZero, type ResolveCaller } from "@/lib/game/resolveAtZero";

export function useResolveAtZero({
  questionId,
  caller,
  onSettled,
}: {
  questionId: string;
  caller: ResolveCaller;
  onSettled?: () => void;
}): () => void {
  const onSettledRef = useRef(onSettled);
  useEffect(() => {
    onSettledRef.current = onSettled;
  });
  const startedRef = useRef(false);
  const cancelRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    startedRef.current = false;
    return () => {
      cancelRef.current?.();
      cancelRef.current = null;
    };
  }, [questionId]);

  return useCallback(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    cancelRef.current = resolveAtZero({
      questionId,
      caller,
      onSettled: () => onSettledRef.current?.(),
    });
  }, [questionId, caller]);
}
