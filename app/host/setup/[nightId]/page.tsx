// /host/setup/[nightId] — the setup overview. Both games + their 12
// category slots at a glance. From here the host:
//   • taps an empty slot → topic entry → POST /api/categories
//   • taps a slot mid-generation → /pick/[categoryId]
//   • taps a locked / review slot → /pick/[categoryId] (to keep editing)
//   • taps "Open the room" → POST /api/nights/[id]/open → /host/live/[id]
//
// Server Component: pulls the night + games + categories so the first
// paint already has the full shape. Hands off to HostSetupOverviewClient
// for navigation handlers.

import { notFound, redirect } from "next/navigation";
import { requireOwnedNight } from "@/lib/api/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { CategoryRow, GameRow } from "@/lib/supabase/types";
import { HostSetupOverviewClient } from "./HostSetupOverviewClient";

export const dynamic = "force-dynamic";

export default async function SetupOverviewPage({
  params,
}: {
  params: Promise<{ nightId: string }>;
}) {
  const { nightId } = await params;
  const owned = await requireOwnedNight(nightId);
  if (!owned.ok) {
    if (owned.status === 404) notFound();
    redirect("/login");
  }
  const { night, host } = owned;

  const admin = getSupabaseAdmin();
  const [{ data: gameRows }, { data: catRows }] = await Promise.all([
    admin
      .from("games")
      .select("*")
      .eq("night_id", night.id)
      .order("game_no", { ascending: true }),
    // Categories live under games (not directly under night). We pull both
    // games' categories in one shot via game_id IN (...).
    (async () => {
      const { data: g } = await admin
        .from("games")
        .select("id")
        .eq("night_id", night.id);
      const gameIds = ((g ?? []) as Array<{ id: string }>).map((r) => r.id);
      if (gameIds.length === 0) return { data: [] };
      return admin
        .from("categories")
        .select("*")
        .in("game_id", gameIds)
        .order("position", { ascending: true });
    })(),
  ]);
  const games = (gameRows ?? []) as GameRow[];
  const categories = (catRows ?? []) as CategoryRow[];

  return (
    <HostSetupOverviewClient
      nightId={night.id}
      venueName={night.venue_name}
      games={games}
      categories={categories}
      isOpen={night.opened_at !== null}
      initialThemeKey={night.theme_key}
      hostDefaultThemeKey={host.default_theme_key}
    />
  );
}
