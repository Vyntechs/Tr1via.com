// /host/setup/[nightId]/pick/[categoryId]
//
// The flagship setup screen. While the category is generating we render
// HostGenLoading and subscribe to `category:{id}` broadcasts. When the
// category transitions to 'review' (20 questions loaded) we swap to
// HostGenPick. The host picks 7, locks the category, and lands back on
// the overview.
//
// Server Component: pull the category + its current questions + the night
// for the breadcrumb. Hand off to the client wrapper for live state +
// handlers.

import { notFound, redirect } from "next/navigation";
import { requireOwnedCategory } from "@/lib/api/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { QuestionRow } from "@/lib/supabase/types";
import { HostSetupPickClient } from "./HostSetupPickClient";

export const dynamic = "force-dynamic";

export default async function SetupPickPage({
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
  // Confirm the category is on the night the URL claims it is.
  if (owned.night.id !== nightId) {
    redirect(`/host/setup/${owned.night.id}/pick/${categoryId}`);
  }

  const admin = getSupabaseAdmin();
  const { data: questionRows } = await admin
    .from("questions")
    .select("*")
    .eq("category_id", categoryId);
  const questions = (questionRows ?? []) as QuestionRow[];

  return (
    <HostSetupPickClient
      nightId={nightId}
      categoryId={categoryId}
      categoryName={owned.category.name}
      categoryTopic={owned.category.topic}
      initialState={owned.category.state}
      initialQuestions={questions}
    />
  );
}
