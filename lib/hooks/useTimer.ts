// 100ms-resolution countdown timer, server-clock-aligned.
//
// Inputs:
//   - revealedAtMs: the server's timestamp (ms since epoch) of when the
//     question was revealed.
//   - serverNowMs: the server's "now" at the moment the reveal broadcast
//     was sent. We use this to compute a per-device clock offset so the
//     countdown is precisely aligned across phones / TV.
//   - durationS: seconds the question is live for (default 20 per spec).
//   - onZero: called exactly once when the timer first crosses 0. Used by
//     phones to fire `/api/questions/:id/resolve` for the T+20 path.
//
// Internally we tick on a 100ms interval — fast enough that the visible
// number never appears to skip, cheap enough that battery isn't a worry.

"use client";

import { useEffect, useRef, useState } from "react";
import { secondsRemaining } from "@/lib/game/timer";

const TICK_MS = 100;

export interface UseTimerOpts {
  /** Server timestamp (ms since epoch) of the reveal. */
  revealedAtMs: number | null;
  /** Server's "now" at broadcast time. If provided, used to derive skew. */
  serverNowMs?: number | null;
  /** Total question duration in seconds. Defaults to 20 per spec. */
  durationS?: number;
  /** Fires exactly once when secondsRemaining first reaches 0. */
  onZero?: () => void;
}

export interface UseTimerResult {
  /** Seconds remaining, clamped [0, durationS]. Updates every 100ms. */
  secondsRemaining: number;
  /** Convenience: floor() of secondsRemaining for the displayed integer. */
  displaySeconds: number;
  /** Convenience: secondsRemaining / durationS for arc rendering, [0..1]. */
  fraction: number;
  /** True after secondsRemaining first hits 0. Stable thereafter. */
  hasExpired: boolean;
}

export function useTimer(opts: UseTimerOpts): UseTimerResult {
  const duration = opts.durationS ?? 20;

  // Clock-skew offset: serverNow - clientNow at the moment the broadcast
  // arrived. Subtracting it from Date.now() gives the device's best
  // estimate of the server clock. Recomputed only when opts change so
  // we don't drift between renders.
  const offsetMs = useRef(0);
  useEffect(() => {
    if (opts.serverNowMs && opts.revealedAtMs) {
      offsetMs.current = opts.serverNowMs - Date.now();
    } else {
      offsetMs.current = 0;
    }
  }, [opts.serverNowMs, opts.revealedAtMs]);

  const [remaining, setRemaining] = useState(() =>
    opts.revealedAtMs === null
      ? duration
      : secondsRemaining({
          revealedAtMs: opts.revealedAtMs,
          durationS: duration,
          nowMs: Date.now() + offsetMs.current,
        }),
  );

  const firedZero = useRef(false);

  useEffect(() => {
    // Reset the "I fired onZero" latch whenever the question changes —
    // a fresh reveal means we're ready to fire again at T+20.
    firedZero.current = false;
    if (opts.revealedAtMs === null) {
      setRemaining(duration);
      return;
    }
    let active = true;
    function tick() {
      if (!active || opts.revealedAtMs === null) return;
      const s = secondsRemaining({
        revealedAtMs: opts.revealedAtMs,
        durationS: duration,
        nowMs: Date.now() + offsetMs.current,
      });
      setRemaining(s);
      if (s <= 0 && !firedZero.current) {
        firedZero.current = true;
        opts.onZero?.();
      }
    }
    tick();
    const handle = setInterval(tick, TICK_MS);
    return () => {
      active = false;
      clearInterval(handle);
    };
    // We intentionally exclude `opts.onZero` from deps — callers tend to
    // pass an inline arrow; using a ref-wrapped callback would force more
    // boilerplate at every callsite. Latch above ensures one-fire semantics
    // even if onZero identity changes mid-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.revealedAtMs, duration]);

  return {
    secondsRemaining: remaining,
    displaySeconds: Math.floor(remaining),
    fraction: duration === 0 ? 0 : remaining / duration,
    hasExpired: remaining <= 0,
  };
}
