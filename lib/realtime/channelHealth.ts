// Module-level pub/sub for the player's Supabase Realtime channel health.
//
// Why module-level: `useRoom` mounts inside the room route, but the
// `ConnectionRibbonProvider` lives in the player layout one level up. A
// React Context provider inside the route can't expose state to a sibling
// in the layout, and lifting state to the layout breaks server rendering.
// A tiny module-level singleton bridges them.
//
// Lifecycle:
//   - `useRoom` calls `setChannelHealth(status)` from each channel's
//     `.subscribe(callback)` status handler.
//   - It calls `setChannelHealth(undefined)` on unmount so the ribbon
//     doesn't show stale "Reconnecting..." after the player navigates away.
//   - `ConnectionRibbonProvider` reads via `useChannelHealth()` and forwards
//     to `useConnectionStatus({ channelState })`.

"use client";

import { useEffect, useState } from "react";

type Listener = (state: string | undefined) => void;
const listeners = new Set<Listener>();
let currentState: string | undefined = undefined;

export function setChannelHealth(state: string | undefined): void {
  if (currentState === state) return;
  currentState = state;
  for (const listener of listeners) listener(state);
}

export function useChannelHealth(): string | undefined {
  const [state, setState] = useState<string | undefined>(currentState);

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

// Test-only: drop all listeners + reset state. Not used in production paths.
export function __resetChannelHealthForTests(): void {
  listeners.clear();
  currentState = undefined;
}
