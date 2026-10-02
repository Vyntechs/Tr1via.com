// The host's own recent topics, for the "YOUR LAST TOPICS" chips on the
// topic-entry screen.
//
// That row used to show a hard-coded demo list (Pixar Movies, Local Madison,
// Beatles…) to every host. It now shows the category names she actually ran
// on her earlier nights, newest first. No rows → no chips (the screen hides
// the row rather than inventing any).

import { SHOW_TIME_ZONE } from "@/lib/auth/live-show";
import type { RecentTopic } from "@/components/host/gen/HostGenTopicEntry";

/** How many chips the design shows. */
export const RECENT_TOPIC_LIMIT = 9;

/** Longest category name the create route accepts (schemas.ts). The chip
 *  fills the box with her typed topic, and that text is sent as both name
 *  and topic, so anything longer couldn't have been typed there. */
const MAX_FILL_LENGTH = 80;

export interface RecentTopicSourceRow {
  /** Category name — the short label on her board. */
  name: string;
  /** What she typed when she created it (the generation topic). */
  topic?: string | null;
  /** When the category was created. */
  created_at: string;
  /** When its night was opened to the room, if it ever was. */
  night_opened_at: string | null;
}

function clean(text: string | null | undefined): string {
  return (text ?? "").trim().replace(/\s+/g, " ");
}

/** "Sep 25" in the venues' time zone. */
export function formatTopicDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: SHOW_TIME_ZONE,
    month: "short",
    day: "numeric",
  }).format(new Date(iso));
}

/** The date a chip shows: the day the night was played, or the day the
 *  category was added if that night never opened. */
function shownAt(row: RecentTopicSourceRow): string {
  return row.night_opened_at ?? row.created_at;
}

/**
 * Distinct category names, newest first by the date each chip shows, capped
 * at `limit`. Each chip fills the box with what she originally typed, or the
 * board name when that isn't stored.
 */
export function buildRecentTopics(
  rows: RecentTopicSourceRow[],
  limit = RECENT_TOPIC_LIMIT,
): RecentTopic[] {
  const newestFirst = [...rows].sort(
    (a, b) =>
      Date.parse(shownAt(b)) - Date.parse(shownAt(a)) ||
      Date.parse(b.created_at) - Date.parse(a.created_at),
  );
  const seen = new Set<string>();
  const out: RecentTopic[] = [];
  for (const row of newestFirst) {
    const name = clean(row.name);
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const typed = clean(row.topic);
    const chip: RecentTopic = { name, date: formatTopicDate(shownAt(row)) };
    if (typed && typed.length <= MAX_FILL_LENGTH) chip.topic = typed;
    out.push(chip);
    if (out.length >= limit) break;
  }
  return out;
}
