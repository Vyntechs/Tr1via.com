// useFiveTapEgg — five rapid taps on a target reveal an easter-egg payload.
//
// Memo 03 ("Where personality lives") asks for a 5-tap on the TR1VIA
// wordmark to peek at the 14 themes. The tap-count resets if more than
// 600ms elapses between presses — so accidental brushes don't trigger,
// but a deliberate tap-tap-tap-tap-tap does.
//
// The hook is presentation-agnostic — it doesn't care which surface mounts
// it or what the egg shows. It returns a `bind` function the caller spreads
// onto the target element; the `trigger` callback fires when the 5th tap
// lands inside the window.

"use client";

import { useCallback, useRef } from "react";

export interface FiveTapEggBindings {
  onClick: () => void;
  /** Encourage screen readers + keyboard users to skip the egg quietly. */
  role: "button";
  tabIndex: number;
  onKeyDown: (event: { key: string; preventDefault?: () => void }) => void;
}

export interface UseFiveTapEggOptions {
  /** Fires when the 5th tap lands within the window. */
  onTrigger: () => void;
  /** Max ms between consecutive taps. Default 600ms (deliberate, not frantic). */
  windowMs?: number;
  /** Disable the egg without re-mounting (e.g. while the overlay is already open). */
  disabled?: boolean;
}

export function useFiveTapEgg({
  onTrigger,
  windowMs = 600,
  disabled = false,
}: UseFiveTapEggOptions): FiveTapEggBindings {
  const countRef = useRef(0);
  const lastAtRef = useRef(0);

  const tap = useCallback(() => {
    if (disabled) return;
    const now = Date.now();
    if (now - lastAtRef.current > windowMs) {
      countRef.current = 1;
    } else {
      countRef.current += 1;
    }
    lastAtRef.current = now;
    if (countRef.current >= 5) {
      countRef.current = 0;
      onTrigger();
    }
  }, [onTrigger, windowMs, disabled]);

  const onKeyDown = useCallback(
    (event: { key: string; preventDefault?: () => void }) => {
      // Enter or Space — match the implicit button affordance.
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault?.();
        tap();
      }
    },
    [tap],
  );

  return {
    onClick: tap,
    role: "button",
    tabIndex: 0,
    onKeyDown,
  };
}
