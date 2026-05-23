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
import { HostSetupTopicClient } from "./HostSetupTopicClient";

export const dynamic = "force-dynamic";

interface SearchParams {
  game?: string;
  position?: string;
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

  // Verify the game belongs to this night (defensive; the API route also
  // checks). This catches a malicious query-string before we render the
  // form.
  const admin = getSupabaseAdmin();
  const { data: game } = await admin
    .from("games")
    .select("id, night_id, game_no")
    .eq("id", gameId)
    .maybeSingle();
  if (!game || game.night_id !== nightId) {
    redirect(`/host/setup/${nightId}`);
  }

  return (
    <HostSetupTopicClient
      nightId={nightId}
      gameId={gameId}
      gameNo={game.game_no}
      position={position}
    />
  );
}
