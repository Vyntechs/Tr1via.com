// /host — the host's home base.
//
// Server Component. We:
//   1. Resolve the signed-in user's `hosts` row (middleware has already
//      enforced auth).
//   2. If `is_first_night_complete` is false → render the onboarding
//      "first dashboard" with a single "Set up Wednesday" CTA.
//   3. Otherwise → render the normal HostDashboard with the host's past
//      nights + an optional "tonight" headliner (the most-recent non-done
//      night, if any).
//
// Both branches need to POST /api/nights when the host taps the CTA; that
// happens client-side via the HostHomeClient wrapper below.

import { redirect } from "next/navigation";
import { getSupabaseServer } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type {
  HostRow,
  NightRow,
  GameRow,
  CategoryRow,
} from "@/lib/supabase/types";
import { HostHomeClient } from "./HostHomeClient";
import { fetchResetPreview } from "@/lib/api/resetNightCounts";

export const dynamic = "force-dynamic";

export default async function HostHomePage() {
  const supa = await getSupabaseServer();
  const {
    data: { user },
  } = await supa.auth.getUser();
  if (!user) {
    // Middleware should have already redirected; defensive fallback.
    redirect("/login");
  }

  const admin = getSupabaseAdmin();

  // The host row (created via /(host)/auth/onboarding-complete on first
  // sign-in). We use the admin client so a brand-new auth user with no row
  // yet doesn't 500 — we just route them to the onboarding form below.
  const { data: hostRow } = await admin
    .from("hosts")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!hostRow) {
    // No hosts row → send to onboarding. The /onboarding page (or login
    // sequence) creates it via the existing route handler.
    redirect("/host/onboarding");
  }
  const host = hostRow as HostRow;

  // Pull all nights for this host so we can derive: past nights + tonight.
  const { data: nightRows } = await admin
    .from("nights")
    .select("*")
    .eq("host_id", host.id)
    .order("created_at", { ascending: false });
  const nights = (nightRows ?? []) as NightRow[];

  // Find a "tonight" headliner — the most-recent night that isn't closed.
  const tonightRow = nights.find((n) => !n.closed_at) ?? null;

  // For the past-nights list we count distinct players + grab category
  // names. Both come from the games + categories + players join. We bound
  // the lookups to the most recent 8 nights so the dashboard query stays
  // cheap.
  const recentNights = nights
    .filter((n) => !!n.closed_at || n.id === tonightRow?.id)
    .filter((n) => n.id !== tonightRow?.id)
    .slice(0, 8);
  const recentNightIds = recentNights.map((n) => n.id);
  const categoriesByNight = await fetchCategoriesByNight(recentNightIds);
  const playersByNight = await fetchPlayerCountByNight(recentNightIds);

  const weeks = recentNights.map((n) => ({
    date: formatNightDate(n),
    venue: n.venue_name,
    cats: categoriesByNight[n.id] ?? [],
    players: playersByNight[n.id] ?? 0,
    ran: !!n.closed_at,
  }));

  // Lifetime totals for the eyebrow on the right of the past-nights list.
  const lifetime = await fetchLifetimeTotals(host.id);

  const resetPreview =
    tonightRow && tonightRow.opened_at
      ? await fetchResetPreview(tonightRow.id)
      : null;

  const tonight = tonightRow
    ? {
        nightId: tonightRow.id,
        venue: tonightRow.venue_name,
        date: formatNightDate(tonightRow),
        dateLong: formatNightDateLong(tonightRow),
        roomCode: tonightRow.room_code,
        themeKey: (tonightRow.theme_key as unknown) as
          | "house"
          | "daylight"
          | "january"
          | "february"
          | "march"
          | "april"
          | "may"
          | "june"
          | "july"
          | "august"
          | "september"
          | "october"
          | "november"
          | "december",
        status: tonightRow.opened_at
          ? ("live" as const)
          : ("setup" as const),
        resetPreview,
      }
    : null;

  return (
    <HostHomeClient
      hostName={host.display_name}
      hostSubtitle={host.default_venue ?? "Independent"}
      defaultVenue={host.default_venue ?? "Soul Fire Pizza"}
      isFirstNightComplete={host.is_first_night_complete}
      isFounder={host.role === "founder"}
      weeks={weeks}
      lifetime={lifetime}
      tonight={tonight}
    />
  );
}

function formatNightDate(n: NightRow): string {
  const iso = n.scheduled_at ?? n.created_at;
  const d = new Date(iso);
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${days[d.getDay()]} ${months[d.getMonth()]} ${d.getDate()}`;
}

/** "Wednesday night" — long-form, plain-English day name suffixed with
 *  "night" because trivia is an evening event. Drives the prominent
 *  date subtitle the first host asked for after PR I removed the placeholder
 *  time. */
function formatNightDateLong(n: NightRow): string {
  const iso = n.scheduled_at ?? n.created_at;
  const d = new Date(iso);
  const days = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];
  return `${days[d.getDay()]} night`;
}

async function fetchCategoriesByNight(
  nightIds: string[],
): Promise<Record<string, string[]>> {
  if (nightIds.length === 0) return {};
  const admin = getSupabaseAdmin();
  const { data: games } = await admin
    .from("games")
    .select("id, night_id")
    .in("night_id", nightIds);
  const gameRows = (games ?? []) as Pick<GameRow, "id" | "night_id">[];
  const gameIds = gameRows.map((g) => g.id);
  if (gameIds.length === 0) return {};
  const { data: cats } = await admin
    .from("categories")
    .select("id, name, game_id, position")
    .in("game_id", gameIds)
    .order("position", { ascending: true });
  const catRows = (cats ?? []) as Pick<CategoryRow, "id" | "name" | "game_id" | "position">[];

  const gameIdToNightId = new Map(gameRows.map((g) => [g.id, g.night_id]));
  const result: Record<string, string[]> = {};
  for (const c of catRows) {
    const nightId = gameIdToNightId.get(c.game_id);
    if (!nightId) continue;
    if (!result[nightId]) result[nightId] = [];
    if (result[nightId].length < 6) result[nightId].push(c.name);
  }
  return result;
}

async function fetchPlayerCountByNight(
  nightIds: string[],
): Promise<Record<string, number>> {
  if (nightIds.length === 0) return {};
  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from("players")
    .select("id, night_id")
    .in("night_id", nightIds)
    .is("removed_at", null);
  const rows = (data ?? []) as Array<{ id: string; night_id: string }>;
  const result: Record<string, number> = {};
  for (const r of rows) {
    result[r.night_id] = (result[r.night_id] ?? 0) + 1;
  }
  return result;
}

async function fetchLifetimeTotals(
  hostId: string,
): Promise<{ nights: number; questions: number }> {
  const admin = getSupabaseAdmin();
  const { count: nightCount } = await admin
    .from("nights")
    .select("id", { count: "exact", head: true })
    .eq("host_id", hostId)
    .not("closed_at", "is", null);
  // Questions: rough estimate — pull all categories for this host's games
  // and use category_count + 7 ≈ questions per game. For now we count
  // actual questions in categories tied to games owned by the host.
  const { data: hostGames } = await admin
    .from("games")
    .select("id, nights!inner(host_id)")
    .eq("nights.host_id", hostId);
  type HostGameRow = { id: string; nights?: unknown };
  const gameRows = (hostGames as HostGameRow[] | null) ?? [];
  const gameIds = gameRows.map((g) => g.id);
  let questionCount = 0;
  if (gameIds.length > 0) {
    const { data: cats } = await admin
      .from("categories")
      .select("id")
      .in("game_id", gameIds);
    const catIds = ((cats ?? []) as Array<{ id: string }>).map((c) => c.id);
    if (catIds.length > 0) {
      const { count } = await admin
        .from("questions")
        .select("id", { count: "exact", head: true })
        .in("category_id", catIds)
        .eq("is_picked", true);
      questionCount = count ?? 0;
    }
  }
  return { nights: nightCount ?? 0, questions: questionCount };
}
