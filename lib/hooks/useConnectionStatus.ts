// useConnectionStatus — tri-state connection health for the surfaces that
// need to surface a ribbon when the room isn't fully wired:
//
//   "online"        — browser navigator.onLine && channel SUBSCRIBED (or no channel)
//   "reconnecting"  — channel ERROR / TIMED_OUT / CLOSED, but browser online
//   "offline"       — browser navigator.onLine === false (trumps channel state)
//
// Pass `channelState` from a Supabase Realtime channel's `system` event so the
// hook can distinguish "WS dropped, still recovering" from "we have no network."

"use client";

import { useEffect, useState } from "react";

export type ConnectionStatus = "online" | "reconnecting" | "offline";

export interface UseConnectionStatusOptions {
  /** Pass through the latest Realtime channel state when one exists. */
  channelState?: string;
}

const HEALTHY_CHANNEL_STATES = new Set(["SUBSCRIBED", "JOINED"]);

export function useConnectionStatus({ channelState }: UseConnectionStatusOptions = {}): ConnectionStatus {
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

  if (!browserOnline) return "offline";
  if (channelState && !HEALTHY_CHANNEL_STATES.has(channelState)) return "reconnecting";
  return "online";
}
