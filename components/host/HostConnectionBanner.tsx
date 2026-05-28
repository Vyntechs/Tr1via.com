// components/host/HostConnectionBanner.tsx
// Calm, non-intrusive "Reconnecting…" banner for the HOST live console.
// Reads the shared channelHealth signal (set by useRoom's subscribe callbacks
// and by the freshness watchdog's recovery). Never reloads the page — Option A.

"use client";

import { useChannelHealth } from "@/lib/realtime/channelHealth";

const UNHEALTHY = new Set(["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"]);

export function HostConnectionBanner() {
  const health = useChannelHealth();
  if (!health || !UNHEALTHY.has(health)) return null;
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
