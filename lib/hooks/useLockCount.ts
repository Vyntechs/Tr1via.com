// useLockCount — how many players have locked in for the current live question.
//
// Polls the same canonical endpoint the TV uses (`/api/games/:id/locks`), so
// it's the reliable path on phones where Supabase realtime is the weak spot.
// Powers the locked screen's live "X of Y locked in" bar — the one thing that
// moves while the timer runs. Returns 0 (and never polls) when inactive.

"use client";

import { useEffect, useState } from "react";

export interface UseLockCountOpts {
  gameId: string;
  active: boolean;
}

const POLL_MS = 2000;

export function useLockCount({ gameId, active }: UseLockCountOpts): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!active || !gameId) return;
    let cancelled = false;

    async function tick() {
      try {
        const res = await fetch(`/api/games/${gameId}/locks`);
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { locks?: unknown[] };
        if (!cancelled) setCount(Array.isArray(data.locks) ? data.locks.length : 0);
      } catch {
        // Transient network error — the next tick retries. Keep the last count.
      }
    }

    tick();
    const handle = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, [gameId, active]);

  // When inactive, report 0 without mutating state inside the effect (the last
  // polled value is simply masked until the screen is active again).
  return active ? count : 0;
}
