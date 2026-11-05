"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** How long "Sent, checking" stays up. The board shows the truth from then on. */
export const SENT_CHECKING_HOLD_MS = 4_000;

/**
 * A host action lost its reply: show "Sent, checking" and re-read the room once.
 * The note then clears on its own, so a re-read that also fails can't leave it
 * stuck on screen.
 */
export function useSentChecking(reRead: () => void) {
  const [checking, setChecking] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reReadRef = useRef(reRead);
  useEffect(() => {
    reReadRef.current = reRead;
  }, [reRead]);

  const stopChecking = useCallback(() => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = null;
    setChecking(false);
  }, []);

  const startChecking = useCallback(() => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    setChecking(true);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setChecking(false);
    }, SENT_CHECKING_HOLD_MS);
    reReadRef.current();
  }, []);

  useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    },
    [],
  );

  return { checking, startChecking, stopChecking };
}
