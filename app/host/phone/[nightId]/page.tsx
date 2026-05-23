// /host/phone/[nightId] — the host's private phone view.
//
// Lives OUTSIDE the (host) route group on purpose. Linda opens this URL on
// her phone while her laptop drives the TV. Auth is the same Supabase magic
// link — middleware.ts protects every /host/* path including this one.
//
// The phone shows one of two screens:
//   • Upcoming — she sees the question text + correct answer privately and
//     taps "Reveal to the room" to fire the question.
//   • Live — while a question is live, she sees the lock-in count, the
//     still-thinking list, end-early, and undo.

import { notFound, redirect } from "next/navigation";
import { requireOwnedNight } from "@/lib/api/auth";
import { HostPhoneClient } from "./HostPhoneClient";

export const dynamic = "force-dynamic";

export default async function HostPhonePage({
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
    <HostPhoneClient
      nightId={owned.night.id}
      roomCode={owned.night.room_code}
      hostName={owned.host.display_name}
    />
  );
}
