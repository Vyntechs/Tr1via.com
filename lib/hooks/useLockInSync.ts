// useLockInSync — 3-second polling fallback for missed lock-in broadcasts.
//
// Supabase realtime can drop events. The TV uses this hook to periodically
// check the canonical locks list from the server and call `onMissed` for any
// lock-in it hasn't already played a ceremony for. The caller tracks what it
// has acknowledged via the `acknowledged` Set.

"use client";

import { useEffect, useRef } from "react";

export interface LockInRecord {
  playerId: string;
  msToLock: number;
  lockedAtMs: number;
}

export interface UseLockInSyncOpts {
  gameId: string;
  active: boolean;
  acknowledged?: Set<string>;
  onMissed?: (lock: LockInRecord) => void;
}

const POLL_MS = 3000;

export function useLockInSync({ gameId, active, acknowledged, onMissed }: UseLockInSyncOpts) {
  // Refs keep the latest callback/set without recreating the interval.
  const onMissedRef = useRef(onMissed);
  const acknowledgedRef = useRef(acknowledged);
  onMissedRef.current = onMissed;
  acknowledgedRef.current = acknowledged;

  useEffect(() => {
    if (!active) return;
    let cancelled = false;

    async function tick() {
      try {
        const res = await fetch(`/api/games/${gameId}/locks`);
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { locks: LockInRecord[] };
        const ack = acknowledgedRef.current ?? new Set<string>();
        for (const lock of data.locks) {
          if (!ack.has(lock.playerId)) onMissedRef.current?.(lock);
        }
      } catch {
        // Network errors are transient — the next tick retries.
      }
    }

    tick();
    const handle = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, [gameId, active]);
}
