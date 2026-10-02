// /host/setup/[nightId]/topic?game=<gameId>&position=<n>
//
// The host types a topic for a new category slot. We POST /api/categories
// to create the row, then navigate to the pick page where generation
// kicks off.
//
// We accept query params so we can wire this from HostGenOverview without
// adding a nested dynamic param for game/position. Both game and position
// must belong to the host's night (ownership is re-checked by the API
// route).

import { notFound, redirect } from "next/navigation";
import { requireOwnedNight } from "@/lib/api/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { resolveTheme } from "@/lib/theme/resolveTheme";
import { buildRecentTopics, type RecentTopicSourceRow } from "@/lib/host/recentTopics";
import type { RecentTopic } from "@/components/host/gen";
import { HostSetupTopicClient } from "./HostSetupTopicClient";

export const dynamic = "force-dynamic";

interface SearchParams {
  game?: string;
  position?: string;
  topic?: string;
}

export default async function SetupTopicPage({
  params,
  searchParams,
}: {
  params: Promise<{ nightId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const [{ nightId }, qs] = await Promise.all([params, searchParams]);
  const owned = await requireOwnedNight(nightId);
  if (!owned.ok) {
    if (owned.status === 404) notFound();
    redirect("/login");
  }
  const gameId = typeof qs.game === "string" ? qs.game : null;
  const position = qs.position ? Number(qs.position) : NaN;
  if (!gameId || Number.isNaN(position) || position < 1 || position > 6) {
    redirect(`/host/setup/${nightId}`);
  }
  const initialTopic =
    typeof qs.topic === "string"
      ? qs.topic.trim().replace(/\s+/g, " ").slice(0, 100)
      : "";

  // Verify the game belongs to this night (defensive; the API route also
  // checks). This catches a malicious query-string before we render the
  // form.
  const admin = getSupabaseAdmin();
  // Her past topics load alongside the game check. They're a convenience:
  // if the lookup fails in any way, the chips are hidden and the page still
  // works.
  const recentLookup = loadRecentTopics(admin, owned.host.id, nightId).catch(
    (err: unknown): RecentTopic[] => {
      console.error("[host/setup/topic] could not load recent topics", err);
      return [];
    },
  );
  const [{ data: game }, recent] = await Promise.all([
    admin
      .from("games")
      .select("id, night_id, game_no")
      .eq("id", gameId)
      .maybeSingle(),
    recentLookup,
  ]);
  if (!game || game.night_id !== nightId) {
    redirect(`/host/setup/${nightId}`);
  }

  return (
    <HostSetupTopicClient
      nightId={nightId}
      gameId={gameId}
      gameNo={game.game_no}
      position={position}
      themeKey={resolveTheme(owned.night, owned.host)}
      initialTopic={initialTopic}
      recent={recent}
    />
  );
}

// The host's own topics from her earlier nights (this night's slots are
// already on the overview). Read-only; any failure just means no chips.
// Supabase reports failures in `error` rather than throwing, so each step
// checks it and throws, and the caller logs it and hides the chips.
async function loadRecentTopics(
  admin: ReturnType<typeof getSupabaseAdmin>,
  hostId: string,
  currentNightId: string,
): Promise<RecentTopic[]> {
  const { data: nightRows, error: nightsError } = await admin
    .from("nights")
    .select("id, opened_at")
    .eq("host_id", hostId)
    .neq("id", currentNightId)
    .order("created_at", { ascending: false })
    .limit(10);
  if (nightsError) throw new Error(`nights lookup failed: ${nightsError.message}`);
  const nights = (nightRows ?? []) as Array<{ id: string; opened_at: string | null }>;
  if (nights.length === 0) return [];
  const openedAtByNight = new Map(nights.map((n) => [n.id, n.opened_at]));

  const { data: gameRows, error: gamesError } = await admin
    .from("games")
    .select("id, night_id")
    .in("night_id", nights.map((n) => n.id));
  if (gamesError) throw new Error(`games lookup failed: ${gamesError.message}`);
  const games = (gameRows ?? []) as Array<{ id: string; night_id: string }>;
  if (games.length === 0) return [];
  const nightByGame = new Map(games.map((g) => [g.id, g.night_id]));

  const { data: catRows, error: categoriesError } = await admin
    .from("categories")
    .select("name, created_at, game_id")
    .in("game_id", games.map((g) => g.id))
    .order("created_at", { ascending: false })
    .limit(120);
  if (categoriesError) {
    throw new Error(`categories lookup failed: ${categoriesError.message}`);
  }
  const rows: RecentTopicSourceRow[] = (
    (catRows ?? []) as Array<{ name: string; created_at: string; game_id: string }>
  ).map((c) => ({
    name: c.name,
    created_at: c.created_at,
    night_opened_at: openedAtByNight.get(nightByGame.get(c.game_id) ?? "") ?? null,
  }));
  return buildRecentTopics(rows);
}
