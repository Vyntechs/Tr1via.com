// 100ms-resolution countdown timer, server-clock-aligned.
//
// Inputs:
//   - revealedAtMs: the server's timestamp (ms since epoch) of when the
//     question was revealed.
//   - serverNowMs: the server's "now" at the moment the reveal broadcast
//     was sent. We use this to compute a per-device clock offset so the
//     countdown is precisely aligned across phones / TV.
//   - receivedAtMs: this device's clock when that broadcast arrived. Taken at
//     the broadcast, not here, because the question screen can mount a good
//     while later and the offset would run late by that gap.
//   - durationS: seconds the question is live for. When omitted, defaults
//     come from the theme registry (25 for every theme).
//   - onZero: called exactly once when the timer first crosses 0. Used by
//     phones to fire `/api/questions/:id/resolve` on the timer-zero path.
//
// Internally we tick on a 100ms interval — fast enough that the visible
// number never appears to skip, cheap enough that battery isn't a worry.

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { secondsRemaining } from "@/lib/game/timer";
import { questionDurationFor } from "@/lib/theme/lockInCeremony";
import type { ThemeKey } from "@/lib/theme/tokens";

const TICK_MS = 100;

export interface UseTimerOpts {
  /** Server timestamp (ms since epoch) of the reveal. */
  revealedAtMs: number | null;
  /** Server's "now" at broadcast time. If provided, used to derive skew. */
  serverNowMs?: number | null;
  /** This device's Date.now() when the broadcast carrying serverNowMs arrived. */
  receivedAtMs?: number | null;
  /**
   * Total question duration in seconds. When omitted, the default comes
   * from the theme registry — 25 for every theme.
   */
  durationS?: number;
  /** When set, default duration is derived from this theme's registry entry. */
  themeKey?: ThemeKey;
  /** Fires exactly once when secondsRemaining first reaches 0. */
  onZero?: () => void;
}

export interface UseTimerResult {
  /** Seconds remaining, clamped [0, durationS]. Updates every 100ms. */
  secondsRemaining: number;
  /** Displayed integer. Reaches 0 only when the answer window has expired. */
  displaySeconds: number;
  /** Convenience: secondsRemaining / durationS for arc rendering, [0..1]. */
  fraction: number;
  /** True after secondsRemaining first hits 0. Stable thereafter. */
  hasExpired: boolean;
  /** Milliseconds left right now, for timers that outlive a render. Stable identity. */
  getRemainingMs: () => number;
}

export function useTimer(opts: UseTimerOpts): UseTimerResult {
  const duration = opts.durationS ?? questionDurationFor(opts.themeKey);

  // Clock-skew offset: serverNow - clientNow at the moment the broadcast
  // arrived. Adding it to Date.now() gives the device's best estimate of the
  // server clock. A later broadcast of another kind replaces the reveal tag and
  // takes serverNowMs back to null; the last good offset stays, because a skewed
  // clock is still skewed. With no receipt stamp, "now" is the closest we have.
  const offsetMs = useRef(0);
  useEffect(() => {
    if (opts.serverNowMs && opts.revealedAtMs) {
      offsetMs.current = opts.serverNowMs - (opts.receivedAtMs ?? Date.now());
    }
  }, [opts.serverNowMs, opts.receivedAtMs, opts.revealedAtMs]);

  const clockRef = useRef({ revealedAtMs: opts.revealedAtMs, duration });
  clockRef.current = { revealedAtMs: opts.revealedAtMs, duration };
  const getRemainingMs = useCallback(() => {
    const { revealedAtMs, duration: durationS } = clockRef.current;
    if (revealedAtMs === null) return durationS * 1000;
    return (
      secondsRemaining({ revealedAtMs, durationS, nowMs: Date.now() + offsetMs.current }) * 1000
    );
  }, []);

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
    // a fresh reveal means we're ready to fire again at T+25.
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
    // ceil keeps the visible countdown and the actual deadline on the same
    // boundary: 1 remains visible through the final fractional second, and 0
    // appears only once `hasExpired` becomes true.
    displaySeconds: Math.ceil(remaining),
    fraction: duration === 0 ? 0 : remaining / duration,
    hasExpired: remaining <= 0,
    getRemainingMs,
  };
}
