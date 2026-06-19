// PyrotechnicsBeatConductor — schedules a synchronized firework beat so the TV
// and the host's live preview (and, in Phase 3, every phone) ignite the SAME
// burst at the SAME wall-clock instant.
//
// The drift bug this exists to prevent: if each surface fired the burst when
// its OWN post-broadcast work finished (the TV waits on a full /api/tv/snapshot
// refetch + re-render; the host does direct Supabase reads), the two would
// diverge by their refetch latencies — 50-250ms apart, visibly out of step for
// a sharp firework flash. Instead the server stamps an absolute ignition instant
// `fireAt` on the broadcast, and each surface schedules against that instant
// off the broadcast RECEIPT — independent of its own refetch.
//
// Clock strategy (the honest version): a device's wall clock is the real
// synchronizer when it's NTP-accurate — schedule `fireAt - now` and every
// accurate device fires together regardless of network jitter. But a device
// with a wrong clock would fire wildly early/late, so we sanity-check against
// the server's intended lead and fall back to "ignite `lead` ms after receipt"
// when the clock disagrees. A genuinely stale beat (we mounted long after it
// fired) is skipped, not replayed. `receivedAtMs` is stamped locally by the hook
// on receipt, so the staleness check is immune to clock skew.
//
// Mirrors TVLockInCeremony: a render-less orchestrator driven by a beat the
// hook surfaces. Cosmetic + best-effort — a missed beat never affects the game.

"use client";

import { useEffect } from "react";
import { publishPyrotechnicsBeat, type PyrotechnicsBeatKind } from "./Pyrotechnics";

export interface FireworksBeat {
  kind: PyrotechnicsBeatKind;
  /** Absolute server instant to ignite (ISO). */
  fireAt: string;
  /** Server "now" at emit (ISO) — used only as a clock-sanity check. */
  serverNow: string;
  /** Local `Date.now()` when this surface received the broadcast. Stamped by
   *  the hook; lets staleness be measured on ONE clock (skew-immune). */
  receivedAtMs: number;
  /** The question a salvo celebrates (absent for the game-end finale). The
   *  player route gates a salvo on this matching the question its correctness
   *  is known for, so the burst fires only on a phone that got THAT question
   *  right. Cosmetic-only; the TV/host conductors ignore it. */
  questionId?: string;
}

// Beats older than this at the moment we'd schedule them are dropped, not
// replayed — covers "the conductor mounted seconds after the burst already
// happened" (e.g. opening the TV mid-show). Measured on the local clock via
// `receivedAtMs`, so a skewed device clock can't make a fresh beat look stale.
const STALE_WINDOW_MS = 1500;
// How far the wall-clock target may disagree with the server's intended lead
// before we stop trusting the device clock and fall back to receipt+lead.
const SKEW_TOLERANCE_MS = 300;
// Never schedule farther out than this — a backstop against a wild value.
const MAX_SCHEDULE_MS = 2000;

/**
 * Compute the local delay (ms) to wait before igniting, or `null` to skip the
 * beat entirely (stale or malformed). Pure + exported for unit testing.
 *
 * @param nowMs  The caller's `Date.now()` at scheduling time.
 */
export function computeBeatDelayMs(beat: FireworksBeat, nowMs: number): number | null {
  const fireAtMs = Date.parse(beat.fireAt);
  const serverNowMs = Date.parse(beat.serverNow);
  if (
    Number.isNaN(fireAtMs) ||
    Number.isNaN(serverNowMs) ||
    !Number.isFinite(beat.receivedAtMs)
  ) {
    return null; // malformed — don't fire on garbage
  }

  // Staleness on the LOCAL clock (skew-immune): how long since we received it.
  const age = Math.max(0, nowMs - beat.receivedAtMs);
  if (age > STALE_WINDOW_MS) return null;

  const lead = Math.max(0, fireAtMs - serverNowMs); // server's intended lead
  const rawDelay = fireAtMs - nowMs; // trust the wall clock → true cross-device sync

  // If the wall-clock target sits in the plausible band (clocks agree to within
  // tolerance), trust it. Otherwise the device clock is skewed — fall back to
  // "ignite `lead` ms after receipt," minus the time already elapsed since
  // receipt, so a skewed screen still fires roughly in step instead of breaking.
  const clockAgrees = rawDelay >= -SKEW_TOLERANCE_MS && rawDelay <= lead + SKEW_TOLERANCE_MS;
  const delay = clockAgrees ? rawDelay : lead - age;
  return Math.max(0, Math.min(MAX_SCHEDULE_MS, delay));
}

export interface PyrotechnicsBeatConductorProps {
  /** The latest firework beat surfaced by useRoom / useTVRoom, or null. */
  beat: FireworksBeat | null;
}

export function PyrotechnicsBeatConductor({ beat }: PyrotechnicsBeatConductorProps) {
  useEffect(() => {
    if (!beat) return;
    const delay = computeBeatDelayMs(beat, Date.now());
    if (delay === null) return; // stale / malformed → skip
    // Publish the beat with its local target instant; the mounted engine(s)
    // schedule + de-dup the actual ignition (see Pyrotechnics.publishPyrotechnicsBeat).
    // We do NOT fire here, so this conductor needs no timer/cleanup — a newer
    // beat simply supersedes by bumping the engine's beat id.
    publishPyrotechnicsBeat(beat.kind, delay);
  }, [beat]);

  return null;
}
