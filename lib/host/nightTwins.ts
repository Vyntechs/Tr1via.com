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
//   - it is still exactly as the tap made it: EVERY column of the night and
//     of its two games still holds what a brand-new night has (see
//     FRESH_NIGHT and FRESH_GAME below; venue = the host's default venue).
//     Any column changed, missing, or not known to this file means someone
//     touched it (or the schema grew), and it stays visible;
//   - we KNOW it has no categories and no players (unknown counts = keep);
//   - the night next to it stays visible: it has content or was touched, or
//     both are untouched and empty and it is the newer one. So one night of
//     every pair always shows.

// This is the same rule as the one-time cleanup
// supabase/proposed/20261014_remove_empty_twin_nights.sql. The cleanup adds
// two guards on top (older than 1 hour; no row in ANY table points at it).
// tests/integration/remove-empty-twins-full-schema.test.ts runs both on the
// same nights and checks they pick the same ones, and that both name the same
// columns as the real schema.

/** POST /api/nights hands back a fresh empty night made this recently. */
export const NIGHT_REUSE_WINDOW_MS = 10 * 60 * 1000;

/** Two nights this close together are one repeated tap (cleanup: `<= 5`). */
export const NIGHT_TWIN_WINDOW_SECONDS = 5;
export const NIGHT_TWIN_HIDE_WINDOW_MS = NIGHT_TWIN_WINDOW_SECONDS * 1000;

/** The venue the home page buttons send when the host has no default venue. */
export const DEFAULT_VENUE_FALLBACK = "Soul Fire Pizza";

/**
 * What a brand-new night holds in every column a host or the app can change.
 * venue_name is checked separately (it must be the host's default venue).
 */
export const FRESH_NIGHT = {
  theme_key: null,
  scheduled_at: null,
  is_locked: false,
  room_magic_enabled: false,
  opened_at: null,
  closed_at: null,
  answer_engine: "legacy",
  answer_engine_latched_at: null,
  current_run_id: null,
  room_revision: 0,
  control_revision: 0,
} as const;

/** Columns set once when the night is made; never edited. */
export const NIGHT_SET_AT_CREATE = ["id", "host_id", "room_code", "created_at", "venue_name"] as const;

/** Every column of nights this rule knows. Any other column = keep the night. */
export const NIGHT_COLUMNS: readonly string[] = [...NIGHT_SET_AT_CREATE, ...Object.keys(FRESH_NIGHT)];

/** What each of a brand-new night's two game shells holds. */
export const FRESH_GAME = {
  category_count: 6,
  question_count: 7,
  state: "draft",
  started_at: null,
  ended_at: null,
} as const;

export const GAME_SET_AT_CREATE = ["id", "night_id", "game_no"] as const;

export const GAME_COLUMNS: readonly string[] = [...GAME_SET_AT_CREATE, ...Object.keys(FRESH_GAME)];

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
  answer_engine?: string;
  answer_engine_latched_at?: string | null;
  room_revision?: number | string;
  control_revision?: number | string;
}

export type TwinGame = Record<string, unknown>;

export interface NightContent {
  categories: number;
  players: number;
  /** The night's game rows, every column. Missing = not known = keep. */
  games?: TwinGame[];
}

export interface TwinRule {
  /** What the home page buttons send as the venue: host.default_venue ?? DEFAULT_VENUE_FALLBACK. */
  defaultVenue: string;
  windowMs?: number;
}

function createdMs(n: TwinNight): number {
  return Date.parse(n.created_at);
}

function sameValue(actual: unknown, fresh: unknown): boolean {
  if (fresh === null) return actual === null;
  if (typeof fresh === "number") {
    return (typeof actual === "number" || typeof actual === "string" || typeof actual === "bigint") &&
      Number(actual) === fresh;
  }
  return actual === fresh;
}

function holdsFresh(row: Record<string, unknown>, fresh: Record<string, unknown>, known: readonly string[]): boolean {
  for (const key of Object.keys(row)) if (!known.includes(key)) return false;
  for (const [key, value] of Object.entries(fresh)) {
    if (!(key in row) || !sameValue(row[key], value)) return false;
  }
  return true;
}

/**
 * True only when every column of the night is still what a tap on the home
 * page button stores. A missing or unknown column counts as touched.
 */
export function isUntouchedNight(n: TwinNight, rule: TwinRule): boolean {
  return n.venue_name === rule.defaultVenue && holdsFresh(n as unknown as Record<string, unknown>, FRESH_NIGHT, NIGHT_COLUMNS);
}

/** Exactly games 1 and 2, each still exactly as the tap made it. */
export function areFreshGames(games: TwinGame[] | undefined): boolean {
  if (!games || games.length !== 2) return false;
  const numbers = games.map((g) => Number(g.game_no)).sort();
  if (numbers[0] !== 1 || numbers[1] !== 2) return false;
  return games.every((g) => holdsFresh(g, FRESH_GAME, GAME_COLUMNS));
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
export function twinCandidateIds<T extends TwinNight>(nights: T[], rule: TwinRule): string[] {
  const windowMs = rule.windowMs ?? NIGHT_TWIN_HIDE_WINDOW_MS;
  return nights
    .filter((n) => isUntouchedNight(n, rule) && nearTwins(n, nights, windowMs).length > 0)
    .map((n) => n.id);
}

export function isKnownEmptyNight(n: TwinNight, content: NightContent | undefined): boolean {
  if (!content) return false;
  if (n.opened_at !== null || n.closed_at) return false;
  return content.categories === 0 && content.players === 0 && areFreshGames(content.games);
}

/** Ids of leftover twin nights the dashboard should not show. */
export function hiddenEmptyTwinIds<T extends TwinNight>(
  nights: T[],
  content: Record<string, NightContent>,
  rule: TwinRule,
): Set<string> {
  const windowMs = rule.windowMs ?? NIGHT_TWIN_HIDE_WINDOW_MS;
  const hideable = (n: T) => isUntouchedNight(n, rule) && isKnownEmptyNight(n, content[n.id]);
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
