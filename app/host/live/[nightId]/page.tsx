// /host/live/[nightId] — mid-game console.
//
// Server Component: pulls the night so we can pass the room code into the
// client wrapper. All live state (game, current question, players, locks)
// comes from useRoom() in the client.

import { notFound, redirect } from "next/navigation";
import { requireOwnedNight } from "@/lib/api/auth";
import { resolveTheme } from "@/lib/theme/resolveTheme";
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
  // Pin to the dynamic viewport and forbid overflow scroll. The mid-game
  // console is a single fixed presentation surface — the host laptop is
  // HDMI-mirrored to the venue TV, so any browser scroll on the host side
  // would scroll the TV too. The shared HostLayout uses `minHeight: 100dvh`
  // (so dashboard / setup screens can scroll), but the live console has to
  // override that and clip instead.
  //
  // HostLayout reserves a top strip for the AccountChip (--host-chip-reserve).
  // The chip itself is hidden on this mirrored surface (see AccountChip), and
  // this negative margin cancels the leftover reserve padding so the console
  // stays exactly full-viewport — no audience-visible band, no scroll.
  return (
    <div
      style={{
        height: "100dvh",
        marginTop: "calc(-1 * var(--host-chip-reserve, 0px))",
        width: "100%",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <HostLiveConsoleClient
        nightId={owned.night.id}
        roomCode={owned.night.room_code}
        venueName={owned.night.venue_name}
        hostName={owned.host.display_name}
        themeKey={resolveTheme(owned.night, owned.host)}
      />
    </div>
  );
}
