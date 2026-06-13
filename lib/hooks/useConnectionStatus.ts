// useConnectionStatus — connection health for the surfaces that need to
// surface a ribbon when the room isn't fully wired:
//
//   "online"        — browser navigator.onLine && reachable && channel SUBSCRIBED (or no channel)
//   "reconnecting"  — channel ERROR / TIMED_OUT / CLOSED, but browser online + reachable
//   "unreachable"   — the browser→Supabase reads timed out / failed (restrictive
//                     venue WiFi). Distinct, higher-severity tier with the
//                     "switch to a hotspot" guidance.
//   "offline"       — browser navigator.onLine === false (trumps everything)
//
// Pass `channelState` from a Supabase Realtime channel's `system` event so the
// hook can distinguish "WS dropped, still recovering" from "we have no network",
// and `reachability` (from the reachability signal) so a fully-blocked server
// reads as unreachable instead of an endless "Reconnecting…".

"use client";

import { useEffect, useState } from "react";
import type { Reachability } from "@/lib/realtime/reachability";

export type ConnectionStatus =
  | "online"
  | "backup"
  | "reconnecting"
  | "unreachable"
  | "offline";

export interface UseConnectionStatusOptions {
  /** Pass through the latest Realtime channel state when one exists. */
  channelState?: string;
  /** Outcome of the browser→Supabase bootstrap reads (reachability signal). */
  reachability?: Reachability;
  /** True while the game is running via the resilient server route (Phase 2):
   *  degraded realtime, but still live. Calmer tier than "reconnecting". */
  backupMode?: boolean;
}

const HEALTHY_CHANNEL_STATES = new Set(["SUBSCRIBED", "JOINED"]);

export function useConnectionStatus({
  channelState,
  reachability,
  backupMode,
}: UseConnectionStatusOptions = {}): ConnectionStatus {
  // Always initialize "online" so the server render and the client's first
  // render agree. We read navigator.onLine inside useEffect after mount,
  // which avoids a hydration mismatch when the browser reports offline at
  // boot (Playwright headless does this; some mobile browsers do too).
  const [browserOnline, setBrowserOnline] = useState(true);

  useEffect(() => {
    if (typeof navigator !== "undefined") {
      setBrowserOnline(navigator.onLine);
    }
    const onOnline = () => setBrowserOnline(true);
    const onOffline = () => setBrowserOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  // Precedence: a dead radio (offline) trumps everything; a blocked server even
  // through the route (unreachable) → switch-to-hotspot; running-via-route
  // (backup) is working, so it outranks a merely flaky socket (reconnecting).
  if (!browserOnline) return "offline";
  if (reachability === "unreachable") return "unreachable";
  if (backupMode) return "backup";
  if (channelState && !HEALTHY_CHANNEL_STATES.has(channelState)) return "reconnecting";
  return "online";
}
