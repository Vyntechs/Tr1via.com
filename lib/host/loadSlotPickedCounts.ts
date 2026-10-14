// Picked-question counts for the rows in doubled board slots, for server code
// that has not loaded questions itself (create route, topic page, setup
// screen, host home). See lib/host/oneCategoryPerSlot.ts for why the count
// decides which row owns a slot.
//
// A clean board (one row per slot, every night tonight) makes NO query. If the
// lookup fails, the counts come back empty and the rule falls back to state,
// then newest: the page still loads, and a slot is still never doubled.

import type { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  countPickedByCategory,
  doubledSlotCategoryIds,
  type PickedCounts,
  type SlotCategoryLike,
} from "@/lib/host/oneCategoryPerSlot";

type Admin = ReturnType<typeof getSupabaseAdmin>;

export async function loadPickedCountsForDoubledSlots(
  admin: Admin,
  rows: readonly SlotCategoryLike[],
): Promise<PickedCounts> {
  const ids = doubledSlotCategoryIds(rows);
  if (ids.length === 0) return new Map();
  try {
    const { data, error } = await admin
      .from("questions")
      .select("category_id")
      .in("category_id", ids)
      .eq("is_picked", true);
    if (error) throw new Error(error.message);
    return countPickedByCategory((data ?? []) as Array<{ category_id: string }>);
  } catch (err) {
    console.error("[oneCategoryPerSlot] could not count picked questions", err);
    return new Map();
  }
}
