// Compatibility route for older saved links. Ownership is checked before the
// host is returned to the canonical responsive live console.

import { notFound, redirect } from "next/navigation";
import { requireOwnedNight } from "@/lib/api/auth";

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
  redirect(`/host/live/${owned.night.id}`);
}
