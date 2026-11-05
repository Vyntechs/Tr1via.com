// reachability — module-level pub/sub for "can this surface reach the server?"
//
// Sibling of channelHealth.ts, and intentionally SEPARATE from it. channelHealth
// tracks the realtime WebSocket's status (SUBSCRIBED / CHANNEL_ERROR / …);
// reachability tracks the OUTCOME of the browser→Supabase REST reads in
// useRoom's bootstrap:
//
//   "ok"           — a bootstrap read succeeded; the server is reachable.
//   "unreachable"  — the bootstrap reads timed out / failed (restrictive venue
//                    WiFi blocking *.supabase.co). Drives the "switch to
//                    hotspot" tier on the player ribbon + host banner/console.
//   undefined      — unknown (before the first read settles, or after unmount).
//
// Kept distinct so the freshness watchdog (which keys off channelHealth ===
// "SUBSCRIBED") and the reconnect throttle stay honest — "unreachable" is a
// higher-severity tier with its own copy and self-healing retry, not just
// another channel status string.
//
// Same module-level-singleton rationale as channelHealth: useRoom mounts inside
// the route while the ConnectionRibbonProvider lives in the layout one level up.

"use client";

import { useEffect, useState } from "react";
import { diagEvent } from "@/lib/diagnostics/client";

export type Reachability = "ok" | "unreachable";

type Listener = (state: Reachability | undefined) => void;
const listeners = new Set<Listener>();
let currentState: Reachability | undefined = undefined;
// When the current unreachable spell began. Repeat failures don't move it, so a
// phone whose retries keep failing counts from the first one.
let unreachableSince: number | null = null;

/** Phones soften the ribbon until this long unreachable, then give the cellular hint. */
export const UNREACHABLE_HINT_MS = 25_000;
/** A phone holding a room or a recent join keeps its screen until this long unreachable. */
export const UNREACHABLE_SCREEN_MS = 45_000;

export function setReachability(state: Reachability | undefined): void {
  if (currentState === state) return;
  // Diagnostic log (does nothing unless logging is on).
  diagEvent("reach", { from: currentState, to: state }, true);
  currentState = state;
  unreachableSince = state === "unreachable" ? Date.now() : null;
  for (const listener of listeners) listener(state);
}

export function useReachability(): Reachability | undefined {
  const [state, setState] = useState<Reachability | undefined>(currentState);

  useEffect(() => {
    // Re-sync after mount in case `currentState` moved between SSR and hydration.
    setState(currentState);
    const listener: Listener = (next) => setState(next);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  return state;
}

/** Non-hook read of the latest reachability. */
export function getReachability(): Reachability | undefined {
  return currentState;
}

/** When the current unreachable spell began; null when reachable or unknown. */
export function getUnreachableSince(): number | null {
  return unreachableSince;
}

/** True once this surface has been unreachable for at least `thresholdMs`. */
export function useUnreachableFor(thresholdMs: number): boolean {
  const state = useReachability();
  // The spell that crossed the threshold. Comparing it with the current one
  // means a new spell starts from false with no reset step.
  const [crossedSpell, setCrossedSpell] = useState<number | null>(null);

  useEffect(() => {
    if (state !== "unreachable") return;
    let timer: ReturnType<typeof setTimeout>;
    const check = () => {
      if (unreachableSince === null) return;
      const left = unreachableSince + thresholdMs - Date.now();
      // A recovery and a new failure can land in one render, which moves the
      // start of the spell without changing `state`, so this looks again.
      if (left > 0) timer = setTimeout(check, left);
      else setCrossedSpell(unreachableSince);
    };
    timer = setTimeout(check, 0);
    return () => clearTimeout(timer);
  }, [state, thresholdMs]);

  return state === "unreachable" && crossedSpell !== null && crossedSpell === unreachableSince;
}

// Test-only: drop all listeners + reset state.
export function __resetReachabilityForTests(): void {
  listeners.clear();
  currentState = undefined;
  unreachableSince = null;
}
