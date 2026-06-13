// components/host/HostConnectionBanner.tsx
// Non-intrusive connection banner for the HOST live console. Two tiers:
//   - "unreachable" (red): the browser→Supabase reads failed (restrictive
//     venue WiFi) — tells Heather to switch the laptop to a hotspot. Takes
//     precedence because it needs a real call to action.
//   - "reconnecting" (amber): the realtime socket is flaky but reachable —
//     calmly reassures, never reloads the page (Option A).
// Reads the shared channelHealth + reachability signals (set by useRoom).

"use client";

import { useChannelHealth } from "@/lib/realtime/channelHealth";
import { useReachability } from "@/lib/realtime/reachability";
import { useRoomFallback } from "@/lib/room/roomFallbackStore";

const UNHEALTHY = new Set(["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"]);

export function HostConnectionBanner() {
  const health = useChannelHealth();
  const reachability = useReachability();
  const { backupMode } = useRoomFallback();

  if (reachability === "unreachable") {
    return (
      <div
        role="status"
        aria-live="polite"
        data-testid="host-unreachable-banner"
        className="fixed left-1/2 top-3 z-50 -translate-x-1/2 rounded-full bg-red-600/90 px-4 py-1.5 text-sm font-medium text-white shadow-lg"
      >
        Can&apos;t reach the server — switch this laptop to a hotspot
      </div>
    );
  }

  // Running via the resilient server route — game is live, just on a backup
  // connection. Calmer than "reconnecting", and it outranks it.
  if (backupMode) {
    return (
      <div
        role="status"
        aria-live="polite"
        data-testid="host-backup-banner"
        className="fixed left-1/2 top-3 z-50 -translate-x-1/2 rounded-full bg-amber-500/90 px-4 py-1.5 text-sm font-medium text-black shadow-lg"
      >
        Slow connection — game still live
      </div>
    );
  }

  if (health && UNHEALTHY.has(health)) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="fixed left-1/2 top-3 z-50 -translate-x-1/2 rounded-full bg-amber-500/90 px-4 py-1.5 text-sm font-medium text-black shadow-lg"
      >
        Reconnecting — your game is safe
      </div>
    );
  }

  return null;
}
