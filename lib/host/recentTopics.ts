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

export interface RecentTopicSourceRow {
  /** Category name — the short label on her board. */
  name: string;
  /** When the category was created. */
  created_at: string;
  /** When its night was opened to the room, if it ever was. */
  night_opened_at: string | null;
}

function displayName(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

/** "Sep 25" in the venues' time zone. */
export function formatTopicDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: SHOW_TIME_ZONE,
    month: "short",
    day: "numeric",
  }).format(new Date(iso));
}

/**
 * Distinct category names, newest first, capped at `limit`. The date is the
 * day the night was played (or the day the category was added, for a night
 * that never opened).
 */
export function buildRecentTopics(
  rows: RecentTopicSourceRow[],
  limit = RECENT_TOPIC_LIMIT,
): RecentTopic[] {
  const newestFirst = [...rows].sort(
    (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
  );
  const seen = new Set<string>();
  const out: RecentTopic[] = [];
  for (const row of newestFirst) {
    const name = displayName(row.name ?? "");
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, date: formatTopicDate(row.night_opened_at ?? row.created_at) });
    if (out.length >= limit) break;
  }
  return out;
}
