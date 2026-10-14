// Server-side helper — given a night id, returns the "what would be
// wiped vs kept" preview used by ResetGameConfirmModal. Called from the
// dashboard server page only when nights.opened_at is set (otherwise
// the modal will never open and we skip the work).
//
// Scope mirrors the RPC: wipes count only what's in games in live/done;
// keeps count counts everything (categories + picked questions across
// all games, players in the room).

import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  countPickedByCategory,
  oneCategoryPerSlot,
} from "@/lib/host/oneCategoryPerSlot";

export interface ResetPreview {
  revealsToWipe: number;
  adjustmentsToWipe: number;
  answersToWipe: number;
  finishedQuestionsToWipe: number;
  categoriesKept: number;
  pickedQuestionsKept: number;
  playersInRoom: number;
  /** First 2 category names — used by the modal body. */
  categoryNamesSample: string[];
}

export async function fetchResetPreview(nightId: string): Promise<ResetPreview> {
  const admin = getSupabaseAdmin();

  const { data: gameRows } = await admin
    .from("games")
    .select("id, state")
    .eq("night_id", nightId);
  const games = (gameRows ?? []) as Array<{ id: string; state: string }>;
  const liveOrDoneGameIds = games
    .filter((g) => g.state === "live" || g.state === "done")
    .map((g) => g.id);
  const allGameIds = games.map((g) => g.id);

  const { data: catRows } = allGameIds.length
    ? await admin
        .from("categories")
        .select("id, name, game_id, position, state, created_at")
        .in("game_id", allGameIds)
        .order("position")
    : { data: [] };
  const categories = (catRows ?? []) as Array<{
    id: string;
    name: string;
    game_id: string;
    position: number;
    state: string;
    created_at: string | null;
  }>;
  const liveOrDoneCategoryIds = categories
    .filter((c) => liveOrDoneGameIds.includes(c.game_id))
    .map((c) => c.id);

  const revealsToWipe = liveOrDoneGameIds.length
    ? (
        await admin
          .from("reveals")
          .select("id", { count: "exact", head: true })
          .in("game_id", liveOrDoneGameIds)
      ).count ?? 0
    : 0;

  const adjustmentsToWipe = liveOrDoneGameIds.length
    ? (
        await admin
          .from("adjustments")
          .select("id", { count: "exact", head: true })
          .in("game_id", liveOrDoneGameIds)
      ).count ?? 0
    : 0;

  const finishedQuestionsToWipe = liveOrDoneCategoryIds.length
    ? (
        await admin
          .from("questions")
          .select("id", { count: "exact", head: true })
          .in("category_id", liveOrDoneCategoryIds)
          .not("finished_at", "is", null)
      ).count ?? 0
    : 0;

  let answersToWipe = 0;
  if (liveOrDoneCategoryIds.length) {
    const { data: qRows } = await admin
      .from("questions")
      .select("id")
      .in("category_id", liveOrDoneCategoryIds);
    const qIds = (qRows ?? []).map((q) => (q as { id: string }).id);
    if (qIds.length) {
      const { count } = await admin
        .from("answers")
        .select("id", { count: "exact", head: true })
        .in("question_id", qIds);
      answersToWipe = count ?? 0;
    }
  }

  // "Kept" counts match the board: a slot doubled before the one-per-slot fix
  // counts once, as the row the setup screen and TV show. (The wipe counts
  // above stay on every row: the reset really does clear the hidden one too.)
  const allCategoryIds = categories.map((c) => c.id);
  const { data: pickedRows } = allCategoryIds.length
    ? await admin
        .from("questions")
        .select("category_id")
        .in("category_id", allCategoryIds)
        .eq("is_picked", true)
    : { data: [] };
  const pickedByCategory = countPickedByCategory(
    (pickedRows ?? []) as Array<{ category_id: string }>,
  );
  const boardCategories = oneCategoryPerSlot(categories, pickedByCategory);
  const pickedQuestionsKept = boardCategories.reduce(
    (sum, c) => sum + (pickedByCategory.get(c.id) ?? 0),
    0,
  );

  const playersInRoom =
    (
      await admin
        .from("players")
        .select("id", { count: "exact", head: true })
        .eq("night_id", nightId)
        .is("removed_at", null)
    ).count ?? 0;

  return {
    revealsToWipe,
    adjustmentsToWipe,
    answersToWipe,
    finishedQuestionsToWipe,
    categoriesKept: boardCategories.length,
    pickedQuestionsKept,
    playersInRoom,
    categoryNamesSample: boardCategories.slice(0, 2).map((c) => c.name),
  };
}
