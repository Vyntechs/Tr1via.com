// roomFallbackStore — module-level store for the server-route fallback.
//
// During a degraded window useRoom fetches `/api/room/:code/snapshot` and
// publishes the payload here; the aux consumer hooks (the player's own answers /
// participations / scores, the host's board questions / scores / live answers)
// read their slice from this ONE payload instead of each firing its own degraded
// request. `backupMode` tells consumers whether to prefer the store over their
// normal direct read.
//
// Same module-singleton rationale as channelHealth/reachability: the producer
// (useRoom, in the route) and consumers (hooks in the player page / host client)
// live in different component subtrees.

"use client";

import { useEffect, useState } from "react";
import type { RoomFallbackPayload, RoomSnapshotPayload } from "./roomSnapshotPayload";

export interface RoomFallbackState {
  backupMode: boolean;
  payload: RoomFallbackPayload | null;
}

type Listener = (state: RoomFallbackState) => void;
const listeners = new Set<Listener>();
let current: RoomFallbackState = { backupMode: false, payload: null };

function emit() {
  for (const listener of listeners) listener(current);
}

/** Turn backup mode on/off. Turning it off clears the stale payload so
 *  consumers immediately fall back to their normal direct reads on recovery. */
export function setBackupMode(on: boolean): void {
  if (current.backupMode === on) return;
  current = on
    ? { ...current, backupMode: true }
    : { backupMode: false, payload: null };
  emit();
}

/** Publish the latest route payload (from the bootstrap fallback or the poll). */
export function publishRoomFallback(payload: RoomSnapshotPayload | null): void {
  current = { ...current, payload: payload as RoomFallbackPayload | null };
  emit();
}

export function getRoomFallback(): RoomFallbackState {
  return current;
}

export function useRoomFallback(): RoomFallbackState {
  const [state, setState] = useState<RoomFallbackState>(current);
  useEffect(() => {
    setState(current); // re-sync across SSR→hydration
    const listener: Listener = (next) => setState(next);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return state;
}

// Test-only reset.
export function __resetRoomFallbackForTests(): void {
  listeners.clear();
  current = { backupMode: false, payload: null };
}
