// useRevalidateOnFocus — a tiny hook that bumps a counter whenever the
// tab returns to the foreground OR the network comes back online.
//
// Why: TR1VIA player phones lose their Supabase Realtime WebSocket when
// iOS Safari suspends a backgrounded tab. On return, the UI sits on
// whatever state was there at suspend time — nothing pushes new events
// because the channel is dead. The fix is to force a fresh bootstrap
// (HTTP refetch + new Realtime subscriptions) on focus / online return.
//
// Consumers plumb the returned counter into a useEffect's dep array; a
// bump re-runs the effect.
//
// Throttled so rapid tab-flipping doesn't thrash subscribe/unsubscribe
// (and so iOS doesn't fire focus + online + focus during a single
// network handoff).

"use client";

import { useEffect, useState } from "react";

export const REVALIDATE_THROTTLE_MS = 1500;

export function useRevalidateOnFocus(): number {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return;
    }
    let lastAt = 0;
    function bump(): void {
      const now = Date.now();
      if (now - lastAt < REVALIDATE_THROTTLE_MS) return;
      lastAt = now;
      setTick((t) => t + 1);
    }
    function onVisibility(): void {
      if (document.visibilityState === "visible") bump();
    }
    function onOnline(): void {
      bump();
    }
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
    };
  }, []);

  return tick;
}
