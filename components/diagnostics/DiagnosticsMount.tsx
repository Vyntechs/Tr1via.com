// Starts the device reporter (lib/diagnostics/reporter.ts) on the three live
// surfaces: a player's phone (/room/CODE), the venue TV (/tv/CODE) and the
// host laptop or phone (/host/live/NIGHT, /host/phone/NIGHT).
//
// The root layout renders this only when the server has DIAGNOSTIC_LOGGING
// on, so with the switch off this code never runs. It draws nothing, and the
// reporter itself is loaded on demand in its own chunk.

"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import type { DiagSurface } from "@/lib/diagnostics/config";

export interface DiagTarget {
  surface: DiagSurface;
  room?: string;
  night?: string;
}

/** Which live surface (if any) a page path is. */
export function diagTargetFor(pathname: string | null): DiagTarget | null {
  if (!pathname) return null;
  const player = /^\/room\/([^/]+)/.exec(pathname);
  if (player) return { surface: "player", room: decodeURIComponent(player[1]) };
  const tv = /^\/tv\/([^/]+)/.exec(pathname);
  if (tv) return { surface: "tv", room: decodeURIComponent(tv[1]) };
  const host = /^\/host\/(?:live|phone)\/([0-9a-f-]{36})(?:\/|$)/i.exec(pathname);
  if (host) return { surface: "host", night: host[1] };
  return null;
}

export function DiagnosticsMount() {
  const target = diagTargetFor(usePathname());
  const surface = target?.surface;
  const room = target?.room;
  const night = target?.night;

  useEffect(() => {
    if (!surface) return;
    let cancelled = false;
    let stop: (() => void) | undefined;
    import("@/lib/diagnostics/reporter")
      .then((mod) => {
        if (!cancelled) stop = mod.startDeviceReporter({ surface, room, night });
      })
      .catch(() => {
        // Reporting is optional; a failed load changes nothing.
      });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [surface, room, night]);

  return null;
}
