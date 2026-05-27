// TV-side lock-in ceremony orchestrator. Subscribes to lock-in events
// (passed in via the `events` prop), maintains a queue, and renders each
// strike with the correct mode:
//
//   CALM mode — chip pulls to center (parent renders the spotlight via
//               spotlightedPlayerId), Lightning bolt fires loud + tinted.
//   STORM mode — chips strike in place; multiple bolts welcome; existing
//               Lightning subsequent-stroke pattern produces rolling thunder.
//
// Mode is decided per-event at the moment it's about to fire. Once started,
// a strike completes fully — calm strikes don't morph mid-flight.
//
// Every event eventually fires — no silent drops. If reveal-state arrives
// while the queue is still draining, the parent decides whether to overlay
// the late strikes onto the reveal screen (Task 18).

"use client";

import { useEffect, useRef, useState } from "react";
import { fireLightningBeat } from "@/components/system/Lightning";

export type CeremonyMode = "calm" | "storm";

export interface CeremonyEvent {
  playerId: string;
  /** Hex color from playerColor.ts. */
  tint: string;
  /** Server-reported lock time in ms (drives +SPD eligibility, ≤5000 = speed bonus). */
  msToLock: number;
  /** When this event was received at the TV (Date.now() at enqueue). */
  receivedAtMs: number;
}

const RECENT_WINDOW_MS = 1500;
const CALM_PENDING_THRESHOLD = 2;
const STORM_RECENT_THRESHOLD = 3;

const CEREMONY_MS_CALM = 1200;
const CEREMONY_MS_STORM = 700;

export function decideMode(input: {
  pending: CeremonyEvent[];
  recent: CeremonyEvent[];
  nowMs: number;
}): CeremonyMode {
  if (input.pending.length >= CALM_PENDING_THRESHOLD) return "storm";
  const recentCount = input.recent.filter(
    (e) => input.nowMs - e.receivedAtMs <= RECENT_WINDOW_MS
  ).length;
  if (recentCount >= STORM_RECENT_THRESHOLD) return "storm";
  return "calm";
}

export interface TVLockInCeremonyProps {
  /** External event stream — parent forwards lock-in broadcasts here. */
  events: CeremonyEvent[];
  /** Called when each event has finished its ceremony (parent clears it from `events`). */
  onEventComplete?: (playerId: string) => void;
  /** Called when calm mode starts a spotlight so parent can highlight the chip. */
  onSpotlight?: (playerId: string | null) => void;
}

export function TVLockInCeremony({
  events,
  onEventComplete,
  onSpotlight,
}: TVLockInCeremonyProps) {
  const recentRef = useRef<CeremonyEvent[]>([]);
  // Track in-flight state with a ref rather than component state so that
  // updating it doesn't retrigger the effect and cancel the pending timer.
  const activeRef = useRef<CeremonyEvent | null>(null);
  // Force a re-render when the active event clears so the next queued event
  // is picked up.
  const [, forceUpdate] = useState(0);

  // Stabilize callbacks so the effect doesn't restart when callers pass inline arrows.
  const onEventCompleteRef = useRef(onEventComplete);
  const onSpotlightRef = useRef(onSpotlight);
  useEffect(() => {
    onEventCompleteRef.current = onEventComplete;
    onSpotlightRef.current = onSpotlight;
  });

  useEffect(() => {
    if (activeRef.current) return;
    const next = events[0];
    if (!next) return;

    const mode = decideMode({
      pending: events,
      recent: recentRef.current,
      nowMs: Date.now(),
    });
    activeRef.current = next;

    if (mode === "calm") {
      onSpotlightRef.current?.(next.playerId);
    }

    fireLightningBeat("close", { tint: next.tint });

    const ceremonyMs = mode === "calm" ? CEREMONY_MS_CALM : CEREMONY_MS_STORM;
    const handle = setTimeout(() => {
      recentRef.current = [
        ...recentRef.current.filter((e) => Date.now() - e.receivedAtMs <= RECENT_WINDOW_MS),
        next,
      ];
      onSpotlightRef.current?.(null);
      onEventCompleteRef.current?.(next.playerId);
      activeRef.current = null;
      // Trigger re-render so the effect picks up the next queued event.
      forceUpdate((n) => n + 1);
    }, ceremonyMs);

    return () => clearTimeout(handle);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- activeRef is a ref, intentionally excluded
  }, [events]);

  // Pure orchestration — no DOM output. Visuals come from Lightning + parent chip spotlight.
  return null;
}
