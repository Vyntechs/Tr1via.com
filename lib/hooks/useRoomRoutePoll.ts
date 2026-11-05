// useRoomRoutePoll — the degraded-network heartbeat over the resilient server
// route.
//
// While `enabled` (useRoom missed a direct read, or is in backup mode), poll
// `fetchPayload` (the room snapshot route) on a JITTERED ~5s cadence and hand
// each payload to `onPayload`. One poll runs at a time, on its own abort
// controller, so a hung poll or a room rebuild can't stop the loop. Jitter
// de-syncs a whole room so their polls don't align into a stampede
// (reason-scale-free-not-observed-count); the poll pauses while the
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
/**
 * A poll that hasn't answered by now counts as failed, so a hung one can't stall
 * the loop. One full attempt of fetchRoomSnapshotPayload, without its retries:
 * the next poll is the retry, and two misses in a row need to come quickly.
 */
export const ROOM_POLL_ABORT_MS = 5000;

export interface RoomRoutePollArgs {
  enabled: boolean;
  /** Gets this poll's own signal, so a room rebuild elsewhere can't cancel it. */
  fetchPayload: (signal: AbortSignal) => Promise<RoomSnapshotPayload>;
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
    let inFlight: AbortController | null = null;

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
      if (cancelled || inFlight || document.visibilityState !== "visible") return;
      const controller = new AbortController();
      inFlight = controller;
      const abortTimer = setTimeout(() => controller.abort(), ROOM_POLL_ABORT_MS);
      const aborted = new Promise<never>((_resolve, reject) => {
        controller.signal.addEventListener(
          "abort",
          () => reject(new Error("room poll timed out")),
          { once: true },
        );
      });
      try {
        const payload = await Promise.race([
          cbRef.current.fetchPayload(controller.signal),
          aborted,
        ]);
        if (!cancelled) cbRef.current.onPayload(payload);
      } catch (err) {
        if (!cancelled) cbRef.current.onError?.(err);
      }
      clearTimeout(abortTimer);
      inFlight = null;
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
      inFlight?.abort();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled]);
}
