// lib/hooks/useFreshnessWatchdog.ts
// The realtime freshness watchdog (4th layer). Runs a 1s interval that asks
// evaluateFreshness "should we rebuild the connection?" and, if so, calls
// onRecover — guarded by an in-flight lock and a cooldown so a rebuild can
// never loop or double-fire with useRoom's existing reconnect paths.
//
// Host-only: useRoom passes `enabled = (deviceId === undefined)`. Players keep
// their existing three layers untouched, so this change cannot affect them.

"use client";

import { useEffect, useRef } from "react";
import {
  evaluateFreshness,
  WATCHDOG_INTERVAL_MS,
  HARD_RECONNECT_COOLDOWN_MS,
} from "@/lib/realtime/freshnessWatchdog";

export interface FreshnessWatchdogArgs {
  /** Run the watchdog only when true (host surfaces with a room code). */
  enabled: boolean;
  /** Latest epoch ms of a received realtime event. */
  getLastMessageAt: () => number;
  /** Whether channels currently report SUBSCRIBED. */
  getSubscribed: () => boolean;
  /** Drop + rebuild the transport and re-bootstrap. May be async. */
  onRecover: () => void | Promise<void>;
}

export function useFreshnessWatchdog({
  enabled,
  getLastMessageAt,
  getSubscribed,
  onRecover,
}: FreshnessWatchdogArgs): void {
  // Init to "now" so the first tick's gap is ~1 interval, never a false "slept".
  const lastTickAtRef = useRef(Date.now());
  // 0 so the first recovery can fire immediately; persists across enabled toggles.
  const lastRecoverAtRef = useRef(0);
  const recoveringRef = useRef(false);
  // Hold the latest callbacks so the interval never has to re-arm on re-render.
  const cbRef = useRef({ getLastMessageAt, getSubscribed, onRecover });
  cbRef.current = { getLastMessageAt, getSubscribed, onRecover };

  useEffect(() => {
    if (!enabled || typeof document === "undefined") return;
    lastTickAtRef.current = Date.now();
    const id = setInterval(() => {
      const now = Date.now();
      const verdict = evaluateFreshness({
        now,
        lastMessageAt: cbRef.current.getLastMessageAt(),
        lastTickAt: lastTickAtRef.current,
        subscribed: cbRef.current.getSubscribed(),
        visible: document.visibilityState === "visible",
      });
      lastTickAtRef.current = now;
      if (!verdict.shouldRecover) return;
      if (recoveringRef.current) return;
      if (now - lastRecoverAtRef.current < HARD_RECONNECT_COOLDOWN_MS) return;
      recoveringRef.current = true;
      lastRecoverAtRef.current = now;
      Promise.resolve(cbRef.current.onRecover()).finally(() => {
        recoveringRef.current = false;
      });
    }, WATCHDOG_INTERVAL_MS);
    return () => clearInterval(id);
  }, [enabled]);
}
