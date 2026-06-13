// useRoomRoutePoll — the degraded-network heartbeat over the resilient server
// route.
//
// While `enabled` (useRoom is in backup mode), poll `fetchPayload` (the room
// snapshot route) on a JITTERED ~5s cadence and hand each payload to
// `onPayload`. Jitter de-syncs a whole room so their polls don't align into a
// stampede (reason-scale-free-not-observed-count); the poll pauses while the
// tab is hidden (a phone dark in a pocket doesn't poll — useRevalidateOnFocus
// re-bootstraps when it returns). One request per cycle → O(1) per client, same
// envelope as the TV's existing 4s poll.
//
// Recovery (exiting backup mode) is owned by useRoom's heartbeat re-bootstrap,
// not here — this hook only keeps state fresh while degraded.

"use client";

import { useEffect, useRef } from "react";
import { jitteredDelayMs } from "@/lib/realtime/recoveryBackoff";
import type { RoomSnapshotPayload } from "@/lib/room/roomSnapshotPayload";

/** Base poll cadence while degraded. Jitter spreads ±25% → ~3.75–6.25s. */
export const ROOM_POLL_BASE_MS = 5000;

export interface RoomRoutePollArgs {
  enabled: boolean;
  fetchPayload: () => Promise<RoomSnapshotPayload>;
  onPayload: (payload: RoomSnapshotPayload) => void;
  onError?: (err: unknown) => void;
  /** Injectable RNG for deterministic jitter (tests). */
  rand?: () => number;
}

export function useRoomRoutePoll({
  enabled,
  fetchPayload,
  onPayload,
  onError,
  rand = Math.random,
}: RoomRoutePollArgs): void {
  const cbRef = useRef({ fetchPayload, onPayload, onError, rand });
  cbRef.current = { fetchPayload, onPayload, onError, rand };

  useEffect(() => {
    if (!enabled || typeof document === "undefined") return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const clear = () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    };

    const schedule = () => {
      clear();
      if (cancelled || document.visibilityState !== "visible") return;
      const delay = jitteredDelayMs([ROOM_POLL_BASE_MS], 0, cbRef.current.rand());
      timer = setTimeout(tick, delay);
    };

    const tick = async () => {
      if (cancelled || document.visibilityState !== "visible") return;
      try {
        const payload = await cbRef.current.fetchPayload();
        if (!cancelled) cbRef.current.onPayload(payload);
      } catch (err) {
        if (!cancelled) cbRef.current.onError?.(err);
      }
      if (!cancelled) schedule();
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") schedule();
      else clear();
    };

    schedule();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      clear();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled]);
}
