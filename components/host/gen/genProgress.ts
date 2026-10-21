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
  /** Questions the server holds as clean so far (from the broadcast). On a
   *  first build this equals `certified`; on an "Another 20" reroll the old
   *  cards stay until the final swap, so `certified` reads 0 while this
   *  climbs. Drives refill maths and "Replacing N". Omitted = unknown (only
   *  the polled job row seen), and `certified` stands in. */
  clean?: number;
  /** Questions that have a photo. */
  photos: number;
  /** Checks finished so far, both passes added together (the two passes run
   *  at the same time, so a per-pass figure would jump back and forth). */
  checked?: number;
  /** Checks this round needs: batch size x 2 (40 on the first round). */
  checkTotal?: number;
  /** Local time (ms) this screen started watching the build. */
  startedAt: number;
  /** True when the screen was opened after the build was already under way,
   *  so the elapsed clock can't claim to be the whole build time. */
  joinedMidway?: boolean;
  /** Local time (ms) of the last real sign of life (broadcast or a fresh
   *  heartbeat in the job row). null = none seen yet. */
  lastSignalAt: number | null;
  /** Set when this attempt picked a paused build back up: how many checked
   *  questions the server had saved at the pause (0 = it starts over from
   *  nothing). Lets the headline say why the numbers went down. */
  resumedWith?: number;
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
  /** Extra plain-words detail, e.g. "2 checks per question". */
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

/** How long without a real signal before we stop saying "Live".
 *  The worker heartbeats every 12s (GENERATION_HEARTBEAT_MS in the generate
 *  route, kept running through the photo stage too) and the job row is polled
 *  every 5s. If realtime broadcasts aren't arriving, the gap between two
 *  signals seen here is up to 12s + 5s poll + a slow DB round trip + the 1s
 *  screen tick, about 18-20s. 30s covers that with room for one late
 *  heartbeat write, while a truly stuck build still shows within half a
 *  minute. */
export const LIVE_WINDOW_MS = 30_000;

/** Check passes per question (they run at the same time). */
const CHECK_PASSES = 2;

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);
const safe = (n: number | undefined) =>
  typeof n === "number" && Number.isFinite(n) ? Math.max(0, n) : 0;

export function buildTracker(p: HostGenProgress): Tracker {
  const target = Math.max(1, safe(p.target) || 20);
  const written = Math.min(target, safe(p.written));
  const certified = Math.min(target, safe(p.certified));
  // The server's own clean count wins when it sent one: the cards can be
  // the OLD batch (reroll) or include stored questions the re-check just
  // deleted (resume), and either would give a false "Replacing N".
  const clean =
    typeof p.clean === "number" && Number.isFinite(p.clean)
      ? Math.min(target, Math.max(0, p.clean))
      : certified;
  const phase = p.phase;
  const checkTotal = safe(p.checkTotal);
  const hasCheckInfo = checkTotal > 0;

  // Refill round: some questions failed the check and are being replaced.
  // While writing or checking, 0 < clean < target only happens on a
  // refill: round 1 (and the resume re-check) hold nothing clean until the
  // round ends.
  const refill =
    clean > 0 &&
    clean < target &&
    (phase === "repairing" || phase === "writing" || phase === "checking");
  const refillNeed = refill ? target - clean : 0;

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
  if (phase === "checking" && hasCheckInfo) {
    // Both passes run at once; the server sends their checks added together,
    // so this count only climbs. The bar counts what is already clean plus
    // this round's share of the target: a refill checking 4 replacements for
    // 3 open slots starts at 17/20, not at 0/8 (that drop was ~19 points).
    const checked = Math.min(checkTotal, safe(p.checked));
    const batch = checkTotal / CHECK_PASSES;
    const share = Math.min(target - clean, batch);
    const fraction = clamp01((clean + share * (checked / checkTotal)) / target);
    check = refill
      ? {
          ...checkBase,
          count: clean,
          total: target,
          fraction,
          state: "active",
          detail: `${checked}/${checkTotal} checks`,
        }
      : {
          ...checkBase,
          count: checked,
          total: checkTotal,
          fraction,
          state: "active",
          detail:
            share < target
              ? `2 checks each on ${share} questions`
              : "2 checks per question",
        };
  } else if (phase === "checking" || phase === "repairing" || refill) {
    check = {
      ...checkBase,
      count: clean,
      total: target,
      fraction: clamp01(clean / target),
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
  // Each stage counts for exactly what its bar shows, whatever its state, so
  // the percent always matches the bars. (A "done" stage used to count as
  // full even at 15/20, and a "waiting" one as empty while its bar showed
  // 15/20.) Ready is 100%: not every card finds a photo.
  const overall =
    phase === "ready"
      ? 1
      : clamp01(stages.reduce((sum, s) => sum + s.weight * s.fraction, 0));

  // ── Headline ── Says what is happening, and why whenever the numbers just
  // went down: a pause that lost its work, or questions that failed a check.
  const resumedWith =
    typeof p.resumedWith === "number" && Number.isFinite(p.resumedWith)
      ? Math.max(0, p.resumedWith)
      : null;
  // Round one of an attempt that picked a paused build back up.
  const firstRoundAfterPause =
    resumedWith !== null &&
    clean === 0 &&
    !refill &&
    (phase === "queued" || phase === "writing" || phase === "checking");
  // A resume re-checks the saved questions first, then writes the rest.
  // While nothing new has passed yet, the gap is the ones that failed the
  // re-check plus the ones never written.
  const resumeRefill = refill && resumedWith !== null && resumedWith > 0 && clean <= resumedWith;
  const reCheckFailed = resumeRefill ? Math.max(0, (resumedWith ?? 0) - clean) : 0;
  const failedLead = resumeRefill
    ? reCheckFailed > 0
      ? `${reCheckFailed} failed the re-check.`
      : "Picking up after a pause."
    : `${refillNeed} failed the check.`;
  const replacing = resumeRefill
    ? `Writing ${refillNeed} more`
    : refillNeed === 1
      ? "Writing a replacement"
      : "Writing replacements";
  const checkingNew = `Checking ${refillNeed === 1 ? "the replacement" : "the replacements"}`;

  let headline: string;
  if (firstRoundAfterPause && resumedWith === 0) {
    headline =
      phase === "queued"
        ? "Starting over after a pause"
        : phase === "writing"
          ? "Starting over after a pause. Writing questions"
          : "Starting over after a pause. Fact-checking answers";
  } else if (firstRoundAfterPause) {
    // The saved questions get checked again before anything new is written.
    headline =
      phase === "queued"
        ? "Picking up after a pause"
        : phase === "writing"
          ? "Picking up after a pause. Writing questions"
          : written <= (resumedWith ?? 0)
            ? `Picking up after a pause. Re-checking the ${resumedWith} saved`
            : "Picking up after a pause. Fact-checking answers";
  } else {
    switch (phase) {
      case "queued":
        headline = "Getting started";
        break;
      case "writing":
        headline = refill ? `${failedLead} ${replacing}` : "Writing questions";
        break;
      case "checking":
        headline = refill ? `${failedLead} ${checkingNew}` : "Fact-checking answers";
        break;
      case "repairing":
        // No number unless the server told us the clean count: a guess from
        // the cards said "Replacing 20" on a reroll where 3 had failed.
        headline = refill
          ? `${failedLead} ${replacing}`
          : clean >= target
            ? "Saving the new questions"
            : "Some failed the check. Writing replacements";
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
