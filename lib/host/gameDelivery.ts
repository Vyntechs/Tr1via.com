export interface LiveRevision {
  runId: string | null;
  roomRevision: number;
  controlRevision: number;
  playId: string | null;
}

export interface SurfaceObservation extends LiveRevision {
  surfaceKind: "tv" | "player";
  /** Server-derived opaque key. It is never included in a host response. */
  subjectKey: string;
  observedAt: Date | string;
}

export interface DeliveryReceipt {
  tv: "current" | "recovering";
  currentPhones: number;
  recoveringPhones: number;
}

const CURRENT_WINDOW_MS = 45_000;

function isCurrent(
  observation: SurfaceObservation,
  canonical: LiveRevision,
  nowMs: number,
): boolean {
  if (!canonical.runId || observation.runId !== canonical.runId) return false;
  if (observation.roomRevision !== canonical.roomRevision) return false;
  if (observation.controlRevision !== canonical.controlRevision) return false;
  if (observation.playId !== canonical.playId) return false;

  const observedAtMs = new Date(observation.observedAt).getTime();
  if (!Number.isFinite(observedAtMs)) return false;
  const ageMs = nowMs - observedAtMs;
  return ageMs >= 0 && ageMs <= CURRENT_WINDOW_MS;
}

/**
 * Classifies private delivery observations against canonical game state.
 *
 * `activePlayerSubjectKeys` must contain only active, non-removed players.
 * Observations confirm delivery only when their opaque subject matches that
 * authoritative set, so removed or fabricated subjects cannot hide recovery.
 */
export function deriveDeliveryReceipt(
  observations: readonly SurfaceObservation[],
  canonical: LiveRevision,
  activePlayerSubjectKeys: ReadonlySet<string>,
  now: Date,
): DeliveryReceipt {
  const nowMs = now.getTime();
  const currentPlayerSubjects = new Set<string>();
  let tvCurrent = false;

  for (const observation of observations) {
    if (!isCurrent(observation, canonical, nowMs)) continue;
    if (observation.surfaceKind === "tv") {
      tvCurrent = true;
    } else if (activePlayerSubjectKeys.has(observation.subjectKey)) {
      currentPlayerSubjects.add(observation.subjectKey);
    }
  }

  const currentPhones = currentPlayerSubjects.size;
  return {
    tv: tvCurrent ? "current" : "recovering",
    currentPhones,
    recoveringPhones: activePlayerSubjectKeys.size - currentPhones,
  };
}
