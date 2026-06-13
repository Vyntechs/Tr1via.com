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

export type Reachability = "ok" | "unreachable";

type Listener = (state: Reachability | undefined) => void;
const listeners = new Set<Listener>();
let currentState: Reachability | undefined = undefined;

export function setReachability(state: Reachability | undefined): void {
  if (currentState === state) return;
  currentState = state;
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

// Test-only: drop all listeners + reset state.
export function __resetReachabilityForTests(): void {
  listeners.clear();
  currentState = undefined;
}
