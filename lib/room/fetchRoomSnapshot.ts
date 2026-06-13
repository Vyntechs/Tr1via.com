// fetchRoomSnapshotPayload — client helper for the resilient server-route
// fallback. One same-origin request (browser→Vercel→Supabase) with retry +
// jittered backoff, standing in for the ~7 direct browser→Supabase reads when
// the direct line is degraded/blocked.

"use client";

import { fetchJsonWithRetry } from "@/lib/realtime/fetchWithRetry";
import type { RoomSnapshotPayload } from "./roomSnapshotPayload";

export function fetchRoomSnapshotPayload(
  code: string,
  opts: { signal?: AbortSignal } = {},
): Promise<RoomSnapshotPayload> {
  return fetchJsonWithRetry<RoomSnapshotPayload>(`/api/room/${code}/snapshot`, {
    attempts: 3,
    perAttemptTimeoutMs: 5000,
    signal: opts.signal,
  });
}
