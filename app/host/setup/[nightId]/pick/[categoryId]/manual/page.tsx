// /host/setup/[nightId]/pick/[categoryId]/manual
//
// The fallback for Phase 10.3: when Claude generation isn't going to
// happen (failure, timeout, or the host's preference), she lands here
// and types her 7 questions herself.
//
// Server Component: validates ownership, pulls the category for the
// breadcrumb, then hands off to HostSetupManualClient (client) for the
// stateful form + submit.

import { notFound, redirect } from "next/navigation";
import { requireOwnedCategory } from "@/lib/api/auth";
import { resolveTheme } from "@/lib/theme/resolveTheme";
import { HostSetupManualClient } from "./HostSetupManualClient";

export const dynamic = "force-dynamic";

export default async function SetupManualPage({
  params,
}: {
  params: Promise<{ nightId: string; categoryId: string }>;
}) {
  const { nightId, categoryId } = await params;
  const owned = await requireOwnedCategory(categoryId);
  if (!owned.ok) {
    if (owned.status === 404) notFound();
    redirect("/login");
  }
  // Defensive: keep the URL honest. If the category's parent night does
  // not match what the URL claimed, send the host to the correct one.
  if (owned.night.id !== nightId) {
    redirect(`/host/setup/${owned.night.id}/pick/${categoryId}/manual`);
  }
  // If the category is already locked there's nothing manual to do;
  // bounce back to the pick screen (which surfaces the locked board).
  if (owned.category.state === "ready") {
    redirect(`/host/setup/${nightId}/pick/${categoryId}`);
  }

  return (
    <HostSetupManualClient
      nightId={nightId}
      categoryId={categoryId}
      categoryName={owned.category.name}
      categoryTopic={owned.category.topic}
      themeKey={resolveTheme(owned.night, owned.host)}
    />
  );
}
