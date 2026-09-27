// "Is this host running a show right now?" — asked before anything that
// would end her other sessions (saving a password signs out every other
// device: see app/api/auth/set-password/route.ts).
//
// Errs toward "running": a wrong "yes" only postpones a password prompt; a
// wrong "no" could sign the show's laptop or phone out. A night counts as
// RUNNING when, for the host who owns it, it isn't closed
// (nights.closed_at is empty) AND something happened on it in the last
// SHOW_WINDOW_MS:
//   - it was created (setup at the venue, before the room is opened), or
//   - it was opened (nights.opened_at), or
//   - one of its games started (live now, or done and on the break before
//     the next game), or
//   - one of its categories was being built (question_generation_jobs
//     .updated_at — setup activity on a night made days earlier).
// The time window matters: closed_at is empty on every past production
// night (the finale "Done" button is the only thing that sets it), so
// "not closed" alone would call every night Heather ever ran "live" and
// she would never be asked for a password.
//
// Cost: the hosts lookup, one nights query (nights_host_idx), then — only
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

function isRecent(iso: string | null | undefined, since: number): boolean {
  return !!iso && new Date(iso).getTime() >= since;
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

    const { data: nights, error: nightsErr } = await admin
      .from("nights")
      .select("id, created_at, opened_at")
      .eq("host_id", host.id)
      .is("closed_at", null);
    if (nightsErr) throw nightsErr;
    const notClosed = nights ?? [];
    if (notClosed.length === 0) return false;

    const since = now.getTime() - SHOW_WINDOW_MS;
    // Created (setup) or opened (room up) in the window.
    if (notClosed.some((n) => isRecent(n.created_at, since) || isRecent(n.opened_at, since))) {
      return true;
    }

    // An older night with game or setup activity in the window.
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
