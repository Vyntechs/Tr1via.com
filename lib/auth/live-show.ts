// "Is this host running a show right now?" — asked before anything that
// would end her other sessions (saving a password signs out every other
// device: see app/api/auth/set-password/route.ts).
//
// A night is RUNNING when, for the host who owns it:
//   - it was opened (nights.opened_at is set — the same "this night ran"
//     signal the /host dashboard uses for its "live" status), and
//   - it isn't closed (nights.closed_at is empty), and
//   - it's recent: opened in the last SHOW_WINDOW_MS, or one of its games
//     started in that window and is still live.
// The time window matters: closed_at is empty on every past production
// night (the finale "Done" button is the only thing that sets it), so
// "opened and not closed" alone would call every night Heather ever ran
// "live" and she would never be asked for a password.
//
// Answers true / false, or null when the database couldn't be asked.
// Callers decide what null means: the sign-in doors skip the password step
// (never risk a show), the set-password route refuses to save.

import "server-only";
import type { getSupabaseAdmin } from "@/lib/supabase/admin";

type AdminClient = Pick<ReturnType<typeof getSupabaseAdmin>, "from">;

/** A trivia night is a few hours; 12 covers a long night with setup. */
export const SHOW_WINDOW_MS = 12 * 60 * 60 * 1000;

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
      .select("id, opened_at")
      .eq("host_id", host.id)
      .is("closed_at", null)
      .not("opened_at", "is", null);
    if (nightsErr) throw nightsErr;
    const open = nights ?? [];
    if (open.length === 0) return false;

    const since = now.getTime() - SHOW_WINDOW_MS;
    if (open.some((n) => n.opened_at && new Date(n.opened_at).getTime() >= since)) return true;

    // Opened earlier (a room opened the day before) but a game is running now.
    const { data: games, error: gamesErr } = await admin
      .from("games")
      .select("id")
      .in(
        "night_id",
        open.map((n) => n.id),
      )
      .eq("state", "live")
      .gte("started_at", new Date(since).toISOString())
      .limit(1);
    if (gamesErr) throw gamesErr;
    return (games ?? []).length > 0;
  } catch (err) {
    console.error("[live-show] could not check for a running show", {
      message: (err as { message?: string } | null)?.message,
    });
    return null;
  }
}
