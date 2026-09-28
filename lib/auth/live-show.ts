// "Is this host running a show right now?" — asked before anything that
// would end her other sessions (saving a password signs out every other
// device: see app/api/auth/set-password/route.ts).
//
// Errs toward "running": a wrong "yes" only postpones a password prompt; a
// wrong "no" could sign the show's laptop or phone out. A night counts as
// RUNNING when, for the host who owns it, it isn't closed
// (nights.closed_at is empty) AND something happened on it in the last
// SHOW_WINDOW_MS, or it's scheduled for today:
//   - it is scheduled (nights.scheduled_at) for today in the venue's time
//     zone (SHOW_TIME_ZONE), or within SHOW_WINDOW_MS either side of now
//     (a show running past midnight), or
//   - it was created (setup at the venue, before the room is opened), or
//   - it was opened (nights.opened_at), or
//   - one of its games started (live now, or done and on the break before
//     the next game), or
//   - one of its categories was being built (question_generation_jobs
//     .updated_at — setup activity on a night made days earlier), or
//   - today is her SHOW DAY: a weekday (venue time) she opened a room on
//     in the last SHOW_DAY_HISTORY_MS. The app never sets scheduled_at
//     (the dashboard's "Set up Wednesday" makes a night with no date, and
//     a scheduled_at would change the date the dashboard and TV show), and
//     hosts set up days ahead: Heather makes Wednesday's night on the
//     Thursday–Saturday before and opens the room Wednesday evening. So on
//     Wednesday afternoon nothing above is recent yet. Her history says
//     Wednesday is show day, so any not-closed night from the last two weeks
//     counts as running all day. A brand-new host has no history and is
//     covered only by the rules above.
// The time window matters: closed_at is empty on every past production
// night (the finale "Done" button is the only thing that sets it), so
// "not closed" alone would call every night Heather ever ran "live" and
// she would never be asked for a password.
//
// Only nights created, opened or scheduled in the last RECENT_NIGHT_MS (or
// scheduled later) are looked at at all, so the list of never-closed
// nights sent to the games/jobs checks stays small as past nights pile up.
//
// Cost: the hosts lookup, two nights queries in parallel (nights_host_idx;
// the second reads the last 5 weeks' opened_at for show day), then — only
// if no night is recent by itself — the games (games_night_idx) and jobs
// (question_generation_jobs_host_updated_idx) checks in parallel.
//
// Answers true / false, or null when the database couldn't be asked.
// Callers decide what null means: the sign-in doors skip the password step
// (never risk a show), the set-password route refuses to save.

import "server-only";
import type { getSupabaseAdmin } from "@/lib/supabase/admin";

type AdminClient = Pick<ReturnType<typeof getSupabaseAdmin>, "from">;

/** A trivia night is a few hours; 12 covers a long night with setup. */
export const SHOW_WINDOW_MS = 12 * 60 * 60 * 1000;
/**
 * Nights older than this (created, opened and scheduled) are never "running".
 * Two weeks, not one: on show day, last week's night must still count even
 * after the clock passes last week's opening time (e.g. she made tonight's
 * night the morning of last week's show — then no night is under a week old
 * between last week's opening time and tonight's).
 */
export const RECENT_NIGHT_MS = 14 * 24 * 60 * 60 * 1000;
/** The venues' local time, for "scheduled for today" and show day. */
export const SHOW_TIME_ZONE = "America/Chicago";
/** How far back her opened rooms are read to learn her show day(s). */
export const SHOW_DAY_HISTORY_MS = 35 * 24 * 60 * 60 * 1000;

function isRecent(iso: string | null | undefined, since: number): boolean {
  return !!iso && new Date(iso).getTime() >= since;
}

/** YYYY-MM-DD of an instant in SHOW_TIME_ZONE. */
function localDay(at: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: SHOW_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

/** Weekday (Sun, Mon, …) of an instant in SHOW_TIME_ZONE. */
function localWeekday(at: Date): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: SHOW_TIME_ZONE, weekday: "short" }).format(at);
}

/** Scheduled for today (venue time), or within SHOW_WINDOW_MS of now. */
function isScheduledNow(iso: string | null | undefined, now: Date): boolean {
  if (!iso) return false;
  const at = new Date(iso);
  const t = at.getTime();
  if (Number.isNaN(t)) return false;
  if (Math.abs(t - now.getTime()) <= SHOW_WINDOW_MS) return true;
  return localDay(at) === localDay(now);
}

export async function hostHasRunningShow(
  admin: AdminClient,
  userId: string,
  now: Date = new Date(),
): Promise<boolean | null> {
  try {
    const { data: host, error: hostErr } = await admin
      .from("hosts")
      .select("id")
      .eq("user_id", userId)
      .maybeSingle();
    if (hostErr) throw hostErr;
    if (!host) return false; // no host row yet (still onboarding): no nights

    // Only the last two weeks' nights (created, opened or scheduled since then —
    // a night scheduled later counts too): past nights are never closed, so
    // without this bound the list would grow every week, forever.
    const recentIso = new Date(now.getTime() - RECENT_NIGHT_MS).toISOString();
    const historyIso = new Date(now.getTime() - SHOW_DAY_HISTORY_MS).toISOString();
    const [{ data: nights, error: nightsErr }, { data: opened, error: openedErr }] = await Promise.all([
      admin
        .from("nights")
        .select("id, created_at, opened_at, scheduled_at")
        .eq("host_id", host.id)
        .is("closed_at", null)
        .or(`created_at.gte.${recentIso},opened_at.gte.${recentIso},scheduled_at.gte.${recentIso}`),
      // Her show day(s): every room she opened in the last 5 weeks, closed or not.
      admin.from("nights").select("opened_at").eq("host_id", host.id).gte("opened_at", historyIso),
    ]);
    if (nightsErr) throw nightsErr;
    if (openedErr) throw openedErr;
    const notClosed = nights ?? [];
    if (notClosed.length === 0) return false;

    // Show day (header): any not-closed night from the last two weeks counts.
    const today = localWeekday(now);
    if ((opened ?? []).some((n) => !!n.opened_at && localWeekday(new Date(n.opened_at)) === today)) {
      return true;
    }

    const since = now.getTime() - SHOW_WINDOW_MS;
    // Scheduled for today, or created (setup) or opened (room up) in the window.
    if (
      notClosed.some(
        (n) =>
          isScheduledNow(n.scheduled_at, now) || isRecent(n.created_at, since) || isRecent(n.opened_at, since),
      )
    ) {
      return true;
    }

    // An older night (from the last two weeks) with game or setup activity in the
    // window.
    const ids = notClosed.map((n) => n.id);
    const sinceIso = new Date(since).toISOString();
    const [games, jobs] = await Promise.all([
      admin.from("games").select("id").in("night_id", ids).gte("started_at", sinceIso).limit(1),
      admin
        .from("question_generation_jobs")
        .select("id")
        .eq("host_id", host.id)
        .gte("updated_at", sinceIso)
        .in("night_id", ids)
        .limit(1),
    ]);
    if (games.error) throw games.error;
    if (jobs.error) throw jobs.error;
    return (games.data ?? []).length > 0 || (jobs.data ?? []).length > 0;
  } catch (err) {
    console.error("[live-show] could not check for a running show", {
      message: (err as { message?: string } | null)?.message,
    });
    return null;
  }
}
