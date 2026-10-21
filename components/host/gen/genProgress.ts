// Pure maths for the host loading screen's progress tracker.
//
// Every number here comes from a real count the server reported (the
// `progress` broadcast or the polled job row). Nothing is driven by a timer or
// eased toward a guess: a stage that has not started is empty, and the overall
// figure is just the stage counts weighted by how long each stage usually
// takes (measured on a 20-question build: writing ~75s, two check passes
// ~30s, photos ~30s).

import type { GenerationPhase } from "@/lib/api/broadcast";

export interface HostGenProgress {
  phase: GenerationPhase;
  /** Deck size being built (usually 20). */
  target: number;
  /** Questions written so far. */
  written: number;
  /** Questions that passed every check so far (these land as cards). */
  certified: number;
  /** Questions that have a photo. */
  photos: number;
  /** Questions fact-checked so far in the current pass. */
  checked?: number;
  /** Size of the batch being checked (20 on the first round, smaller on refills). */
  checkTotal?: number;
  /** Which of the two check passes is running. */
  checkPass?: 1 | 2;
  /** Local time (ms) this screen started watching the build. */
  startedAt: number;
  /** True when the screen was opened after the build was already under way,
   *  so the elapsed clock can't claim to be the whole build time. */
  joinedMidway?: boolean;
  /** Local time (ms) of the last real sign of life (broadcast or a fresh
   *  heartbeat in the job row). null = none seen yet. */
  lastSignalAt: number | null;
}

export type StageKey = "write" | "check" | "photos";
export type StageState = "waiting" | "active" | "done";

export interface TrackerStage {
  key: StageKey;
  label: string;
  shortLabel: string;
  count: number;
  total: number;
  /** 0..1, from the stage's own count only. */
  fraction: number;
  state: StageState;
  /** Extra plain-words detail, e.g. "pass 1 of 2". */
  detail: string | null;
  /** Share of the whole build this stage usually takes. */
  weight: number;
}

export interface Tracker {
  stages: [TrackerStage, TrackerStage, TrackerStage];
  /** 0..1 weighted sum of the stages. */
  overall: number;
  headline: string;
  /** Questions being replaced in a refill round (0 when not refilling). */
  refillNeed: number;
}

export const STAGE_WEIGHTS: Record<StageKey, number> = {
  write: 0.56,
  check: 0.22,
  photos: 0.22,
};

/** A healthy build heartbeats every 12s and the job row is polled every 5s,
 *  so a quiet but alive stretch can reach ~17s. Past this we stop claiming
 *  it's live. */
export const LIVE_WINDOW_MS = 18_000;

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);
const safe = (n: number | undefined) =>
  typeof n === "number" && Number.isFinite(n) ? Math.max(0, n) : 0;

export function buildTracker(p: HostGenProgress): Tracker {
  const target = Math.max(1, safe(p.target) || 20);
  const written = Math.min(target, safe(p.written));
  const certified = Math.min(target, safe(p.certified));
  const phase = p.phase;
  const checkTotal = safe(p.checkTotal);
  const hasPassInfo =
    (p.checkPass === 1 || p.checkPass === 2) && checkTotal > 0;

  // Refill round: some questions failed the check and are being replaced.
  const refill =
    certified > 0 &&
    certified < target &&
    (phase === "repairing" ||
      phase === "writing" ||
      (phase === "checking" && hasPassInfo && checkTotal < target));
  const refillNeed = refill ? target - certified : 0;

  // ── Writing ──
  const writeState: StageState =
    phase === "queued"
      ? "waiting"
      : phase === "writing"
        ? "active"
        : phase === "needs_attention"
          ? written >= target
            ? "done"
            : "waiting"
          : "done";
  const write: TrackerStage = {
    key: "write",
    label: "Writing questions",
    shortLabel: "Writing",
    count: written,
    total: target,
    fraction: clamp01(written / target),
    state: writeState,
    detail: refill && phase === "writing" ? `${refillNeed} more` : null,
    weight: STAGE_WEIGHTS.write,
  };

  // ── Fact-checking ──
  let check: TrackerStage;
  const checkBase = {
    key: "check" as const,
    label: "Fact-checking answers",
    shortLabel: "Checking",
    weight: STAGE_WEIGHTS.check,
  };
  if (phase === "checking" && hasPassInfo) {
    const pass = p.checkPass as 1 | 2;
    const checked = Math.min(checkTotal, safe(p.checked));
    check = {
      ...checkBase,
      count: checked,
      total: checkTotal,
      fraction: clamp01((pass - 1 + checked / checkTotal) / 2),
      state: "active",
      detail: `pass ${pass} of 2`,
    };
  } else if (phase === "checking" || refill) {
    check = {
      ...checkBase,
      count: certified,
      total: target,
      fraction: clamp01(certified / target),
      state: "active",
      detail: refill ? `${refillNeed} to replace` : null,
    };
  } else {
    const finished = phase === "images" || phase === "ready" || certified >= target;
    check = {
      ...checkBase,
      count: certified,
      total: target,
      fraction: clamp01(certified / target),
      state: finished ? "done" : "waiting",
      detail: null,
    };
  }

  // ── Photos ── (only certified questions get a photo)
  const photoTotal = certified > 0 ? certified : target;
  const photos = Math.min(photoTotal, safe(p.photos));
  const photosState: StageState =
    phase === "images" ? "active" : phase === "ready" ? "done" : "waiting";
  const photo: TrackerStage = {
    key: "photos",
    label: "Finding photos",
    shortLabel: "Photos",
    count: photos,
    total: photoTotal,
    fraction: clamp01(photos / photoTotal),
    state: photosState,
    detail: null,
    weight: STAGE_WEIGHTS.photos,
  };

  const stages: [TrackerStage, TrackerStage, TrackerStage] = [write, check, photo];
  const overall = clamp01(
    stages.reduce(
      (sum, s) =>
        sum +
        s.weight * (s.state === "done" ? 1 : s.state === "active" ? s.fraction : 0),
      0,
    ),
  );

  let headline: string;
  switch (phase) {
    case "queued":
      headline = "Getting started";
      break;
    case "writing":
      headline = refill
        ? `Replacing ${refillNeed} that failed the check`
        : "Writing questions";
      break;
    case "checking":
      headline = refill
        ? `Checking ${refillNeed === 1 ? "the replacement" : "the replacements"}${hasPassInfo ? `, pass ${p.checkPass} of 2` : ""}`
        : `Fact-checking answers${hasPassInfo ? `, pass ${p.checkPass} of 2` : ""}`;
      break;
    case "repairing":
      headline = `Replacing ${refillNeed || target - certified} that failed the check`;
      break;
    case "images":
      headline = "Finding photos";
      break;
    case "ready":
      headline = "Questions ready";
      break;
    default:
      headline = "Build paused";
  }

  return { stages, overall, headline, refillNeed };
}

export interface Liveness {
  live: boolean;
  text: string;
}

function formatAge(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

/** Whether the build is visibly alive right now, in plain words. */
export function livenessAt(
  now: number,
  p: Pick<HostGenProgress, "lastSignalAt" | "startedAt" | "phase">,
): Liveness {
  if (p.phase === "needs_attention") {
    return { live: false, text: "Stopped" };
  }
  if (p.lastSignalAt === null) {
    return now - p.startedAt < LIVE_WINDOW_MS
      ? { live: false, text: "Connecting" }
      : { live: false, text: "Waiting on the server. No update yet." };
  }
  const age = now - p.lastSignalAt;
  if (age < LIVE_WINDOW_MS) return { live: true, text: "Live" };
  return {
    live: false,
    text: `Waiting on the server. Last update ${formatAge(age)} ago.`,
  };
}
