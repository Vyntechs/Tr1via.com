// useUnreachableRetry — self-healing re-check while a surface can't reach the
// server.
//
// When `enabled` (reachability === "unreachable"), re-runs `onRetry` (which
// bumps useRoom's re-bootstrap) on a backing-off, jittered cadence (2s → 4s →
// 8s, see recoveryBackoff) so the "switch to a hotspot" message clears on its
// own within a few seconds of the network returning — no manual refresh.
//
// Two guards keep it gentle at scale (reason-scale-free lesson):
//   - ±jitter per client de-syncs a whole room so they don't all retry in the
//     same instant when shared venue WiFi recovers.
//   - it PAUSES while the tab is hidden (a phone dark in a pocket doesn't
//     retry); useRevalidateOnFocus already forces an immediate re-bootstrap the
//     moment the tab comes back to the foreground.
//
// The existing 15s heartbeat remains the ultimate backstop.

"use client";

import { useEffect, useRef } from "react";
import { recoveryDelayMs } from "@/lib/realtime/recoveryBackoff";

export interface UnreachableRetryArgs {
  /** Run the retry loop only while true (reachability is "unreachable"). */
  enabled: boolean;
  /** Re-attempt the bootstrap. Cheap counter bump on the caller's side. */
  onRetry: () => void;
  /** Injectable RNG for deterministic tests. Defaults to Math.random. */
  rand?: () => number;
}

export function useUnreachableRetry({
  enabled,
  onRetry,
  rand = Math.random,
}: UnreachableRetryArgs): void {
  const cbRef = useRef({ onRetry, rand });
  cbRef.current = { onRetry, rand };

  useEffect(() => {
    if (!enabled || typeof document === "undefined") return;

    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const clear = () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    };

    const arm = () => {
      clear();
      // Don't schedule while hidden — the visibilitychange handler re-arms when
      // the tab returns to the foreground.
      if (document.visibilityState !== "visible") return;
      const delay = recoveryDelayMs(attempt, cbRef.current.rand());
      timer = setTimeout(() => {
        if (document.visibilityState === "visible") {
          cbRef.current.onRetry();
          attempt += 1;
        }
        arm();
      }, delay);
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") arm();
      else clear();
    };

    arm();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clear();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled]);
}
