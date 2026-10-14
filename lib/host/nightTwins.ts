// Twin nights: two or more nights for one host created within a few minutes
// of each other, where only one was ever used. They come from a repeated
// "Set up tonight's games" / "+ Plan a new night" tap (Heather, Oct 8 2026:
// two nights 1.07s apart, she built in the second, the first stayed empty).
//
// The dashboard hides the empty ones so the host sees exactly one night to
// continue. Rules, chosen so nothing with content can ever disappear:
//   - a night is "empty" only if it was never opened or closed and we KNOW it
//     has no categories and no players (unknown counts = keep it);
//   - nights are grouped into a cluster when each is within the window of
//     its neighbour;
//   - in each cluster one night is kept: the one with the most categories
//     (ties go to the newest), or the newest if all are empty;
//   - only empty nights other than that keeper are hidden.

export const NIGHT_TWIN_WINDOW_MS = 10 * 60 * 1000;

export interface TwinNight {
  id: string;
  created_at: string;
  opened_at: string | null;
  closed_at?: string | null;
}

export interface NightContent {
  categories: number;
  players: number;
}

function createdMs(n: TwinNight): number {
  return Date.parse(n.created_at);
}

/** Groups newest-first nights into clusters of near-simultaneous creations. */
function clusters<T extends TwinNight>(nights: T[], windowMs: number): T[][] {
  const out: T[][] = [];
  let current: T[] = [];
  for (const night of nights) {
    const prev = current[current.length - 1];
    if (prev && Math.abs(createdMs(prev) - createdMs(night)) <= windowMs) {
      current.push(night);
    } else {
      if (current.length > 0) out.push(current);
      current = [night];
    }
  }
  if (current.length > 0) out.push(current);
  return out;
}

/**
 * Ids of never-opened nights that sit within the window of another night.
 * Only these need a content lookup; everything else is never hidden.
 */
export function twinCandidateIds<T extends TwinNight>(
  nights: T[],
  windowMs: number = NIGHT_TWIN_WINDOW_MS,
): string[] {
  return clusters(nights, windowMs)
    .filter((c) => c.length > 1)
    .flat()
    .filter((n) => n.opened_at === null && !n.closed_at)
    .map((n) => n.id);
}

export function isKnownEmptyNight(n: TwinNight, content: NightContent | undefined): boolean {
  if (!content) return false;
  if (n.opened_at !== null || n.closed_at) return false;
  return content.categories === 0 && content.players === 0;
}

/** Ids of empty twin nights the dashboard should not show. */
export function hiddenEmptyTwinIds<T extends TwinNight>(
  nights: T[],
  content: Record<string, NightContent>,
  windowMs: number = NIGHT_TWIN_WINDOW_MS,
): Set<string> {
  const hidden = new Set<string>();
  for (const cluster of clusters(nights, windowMs)) {
    if (cluster.length < 2) continue;
    let keeper = cluster[0];
    let keeperScore = -1;
    for (const n of cluster) {
      if (isKnownEmptyNight(n, content[n.id])) continue;
      // Opened nights or nights with unknown counts score as "has content".
      const score = content[n.id]?.categories ?? Number.MAX_SAFE_INTEGER;
      if (score > keeperScore) {
        keeper = n;
        keeperScore = score;
      }
    }
    for (const n of cluster) {
      if (n.id !== keeper.id && isKnownEmptyNight(n, content[n.id])) hidden.add(n.id);
    }
  }
  return hidden;
}
