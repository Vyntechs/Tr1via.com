// /host/live/[nightId] — mid-game console.
//
// Server Component: pulls the night so we can pass the room code into the
// client wrapper. All live state (game, current question, players, locks)
// comes from useRoom() in the client.

import { notFound, redirect } from "next/navigation";
import { requireOwnedNight } from "@/lib/api/auth";
import { HostLiveConsoleClient } from "./HostLiveConsoleClient";

export const dynamic = "force-dynamic";

export default async function HostLivePage({
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
  return (
    <HostLiveConsoleClient
      nightId={owned.night.id}
      roomCode={owned.night.room_code}
      venueName={owned.night.venue_name}
      themeKey={owned.night.theme_key ?? "house"}
    />
  );
}
