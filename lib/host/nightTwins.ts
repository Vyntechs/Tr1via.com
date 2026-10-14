// Twin nights: two nights for one host made by ONE repeated tap of "Set up
// tonight's games" / "+ Plan a new night" (Heather, Oct 8 2026: two nights
// 1.07s apart, she built in the second, the first stayed empty).
//
// The dashboard hides the leftover so the host sees one night to continue.
// It must never hide a night the host made or touched on purpose, so a night
// is hidden only when ALL of these hold:
//   - it was made within NIGHT_TWIN_HIDE_WINDOW_MS (5 seconds) of another
//     night of the same host at the same venue. A host can't plan a second
//     night on purpose that fast: she'd have to get back to the home page and
//     tap again, and since the one-night-per-tap change the server hands her
//     first night back anyway. Real double taps land about 1 second apart;
//   - it is still exactly as the tap made it: never opened, closed, run or
//     locked, no theme, no date, room magic off, revisions 0. Any of those
//     set (or not known) means someone touched it, and it stays visible;
//   - we KNOW it has no categories and no players (unknown counts = keep);
//   - the night next to it stays visible: it has content or was touched, or
//     both are untouched and empty and it is the newer one. So one night of
//     every pair always shows.

/** POST /api/nights hands back a fresh empty night made this recently. */
export const NIGHT_REUSE_WINDOW_MS = 10 * 60 * 1000;

/** The dashboard hides an untouched empty night only this close to a twin. */
export const NIGHT_TWIN_HIDE_WINDOW_MS = 5 * 1000;

export interface TwinNight {
  id: string;
  created_at: string;
  opened_at: string | null;
  closed_at?: string | null;
  venue_name?: string;
  theme_key?: string | null;
  scheduled_at?: string | null;
  room_magic_enabled?: boolean;
  is_locked?: boolean;
  current_run_id?: string | null;
  answer_engine_latched_at?: string | null;
  room_revision?: number | string;
  control_revision?: number | string;
}

export interface NightContent {
  categories: number;
  players: number;
}

function createdMs(n: TwinNight): number {
  return Date.parse(n.created_at);
}

/**
 * True only when every setting is still what a tap on the home page button
 * stores. A missing field counts as touched, so the night stays visible.
 */
export function isUntouchedNight(n: TwinNight): boolean {
  return (
    n.opened_at === null &&
    (n.closed_at ?? null) === null &&
    typeof n.venue_name === "string" &&
    n.theme_key === null &&
    n.scheduled_at === null &&
    n.room_magic_enabled === false &&
    n.is_locked === false &&
    n.current_run_id === null &&
    n.answer_engine_latched_at === null &&
    n.room_revision !== undefined &&
    Number(n.room_revision) === 0 &&
    n.control_revision !== undefined &&
    Number(n.control_revision) === 0
  );
}

function nearTwins<T extends TwinNight>(n: T, nights: T[], windowMs: number): T[] {
  return nights.filter(
    (m) =>
      m.id !== n.id &&
      m.venue_name === n.venue_name &&
      Math.abs(createdMs(m) - createdMs(n)) <= windowMs,
  );
}

/**
 * Ids of untouched nights that sit within the window of another night at the
 * same venue. Only these need a content lookup; everything else is shown.
 */
export function twinCandidateIds<T extends TwinNight>(
  nights: T[],
  windowMs: number = NIGHT_TWIN_HIDE_WINDOW_MS,
): string[] {
  return nights
    .filter((n) => isUntouchedNight(n) && nearTwins(n, nights, windowMs).length > 0)
    .map((n) => n.id);
}

export function isKnownEmptyNight(n: TwinNight, content: NightContent | undefined): boolean {
  if (!content) return false;
  if (n.opened_at !== null || n.closed_at) return false;
  return content.categories === 0 && content.players === 0;
}

/** Ids of leftover twin nights the dashboard should not show. */
export function hiddenEmptyTwinIds<T extends TwinNight>(
  nights: T[],
  content: Record<string, NightContent>,
  windowMs: number = NIGHT_TWIN_HIDE_WINDOW_MS,
): Set<string> {
  const hideable = (n: T) => isUntouchedNight(n) && isKnownEmptyNight(n, content[n.id]);
  const hidden = new Set<string>();
  for (const n of nights) {
    if (!hideable(n)) continue;
    // Hide n only next to a twin that itself stays visible: one with content
    // or settings of its own, or the newer of two untouched empty nights.
    const keptTwin = nearTwins(n, nights, windowMs).some(
      (m) => !hideable(m) || createdMs(m) > createdMs(n),
    );
    if (keptTwin) hidden.add(n.id);
  }
  return hidden;
}
