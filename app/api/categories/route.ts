// POST /api/categories — host creates a category inside one of their games.
//
// One category = one column on the Jeopardy board. The host creates 6 of
// these per game during the setup flow. Position 1..6 maps left-to-right on
// the board. We default category.state to 'draft'; generation flips it
// through 'generating' → 'review' → 'ready' via the existing routes.
//
// Host-only. Verifies ownership of the parent game (which verifies
// ownership of the night). Returns the new category's id so the host UI
// can navigate straight into the topic / generate / pick flow.

import type { NextRequest } from "next/server";
import { CreateCategoryBodySchema } from "@/lib/api/schemas";
import {
  badRequest,
  conflict,
  forbidden,
  notFound,
  ok,
  serverError,
  unauthorized,
} from "@/lib/api/responses";
import { requireOwnedGame } from "@/lib/api/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { pickSlotWinner, sameTopicText } from "@/lib/host/oneCategoryPerSlot";
import { loadPickedCountsForDoubledSlots } from "@/lib/host/loadSlotPickedCounts";
import { retopicEmptyCategory } from "@/lib/host/retopicEmptyCategory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("invalid JSON");
  }
  const parsed = CreateCategoryBodySchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error);
  const { gameId, name, topic, position } = parsed.data;

  const owned = await requireOwnedGame(gameId);
  if (!owned.ok) {
    if (owned.status === 401) return unauthorized(owned.error);
    if (owned.status === 403) return forbidden(owned.error);
    return notFound(owned.error);
  }

  const admin = getSupabaseAdmin();

  // One category per slot. The lookup is keyed on the SLOT (game + position),
  // not on the topic text. Keying on the exact text let a second row in: on
  // 2026-10-03 the host typed "Legendary Ghost stories", came back to the same
  // slot's topic form 28 s later and typed "legendary ghost stories", and the
  // capitals-only difference created a second category in game 2 slot 2. It
  // then showed on her screen next to the real one on show night.
  //
  // The topic → generate flow also fires this over lossy networks (cellular /
  // venue WiFi) and the client retries a dropped request, so a filled slot
  // always answers with the row that is already there (200) and never inserts.
  // `reused` + `sameTopic` tell the client whether this was its own retry (same
  // words, any capitals) or a different topic aimed at a slot that is taken.
  const slot = await findSlotCategory(admin, gameId, position);
  // Fail closed: if the lookup itself errors, do NOT fall through to a plain
  // insert — that could double the slot, the exact thing this guards against.
  if (!slot.ok) {
    return serverError(slot.error);
  }
  if (slot.category) {
    // A different topic for a slot whose row is still EMPTY (no questions at
    // all, game in setup) is a typo fix after question-writing failed, not a
    // second category: the row takes the new topic in place, same id, and any
    // build still running for the old topic is fenced off first. Only a slot
    // with exactly one row qualifies; a doubled slot keeps the message.
    if (slot.rowCount === 1 && !sameTopicText(slot.category.topic, topic)) {
      const outcome = await retopicEmptyCategory(admin, slot.category, { topic, name });
      if (outcome.kind === "retopicked") {
        // `sameTopic: true` = the slot now holds the topic she typed, so even
        // an older copy of the topic screen carries on to question-writing.
        return ok(
          { category: outcome.category, reused: true, sameTopic: true, retopicked: true },
          200,
        );
      }
      if (outcome.kind === "busy") return conflict(outcome.message);
      if (outcome.kind === "error") return serverError(outcome.message);
    }
    return ok(reusedBody(slot.category, topic), 200);
  }

  const { data, error } = await admin
    .from("categories")
    .insert({
      game_id: gameId,
      name,
      topic,
      position,
    })
    .select("id, name, topic, position, state")
    .single();
  if (error && (error as { code?: string }).code === UNIQUE_VIOLATION) {
    // Two creates for the same empty slot landed at the same moment (two
    // devices, a double tap) and the database's one-per-slot rule stopped the
    // second. Answer with the row that won instead of an error.
    const raced = await findSlotCategory(admin, gameId, position);
    if (raced.ok && raced.category) {
      return ok(reusedBody(raced.category, topic), 200);
    }
    return serverError(raced.ok ? "could not create category" : raced.error);
  }
  if (error || !data) {
    return serverError(error?.message ?? "could not create category");
  }
  return ok({ category: data, reused: false, sameTopic: true }, 201);
}

// Postgres "unique_violation". Only seen once the one-per-slot index exists.
const UNIQUE_VIOLATION = "23505";

interface SlotCategory {
  id: string;
  name: string;
  topic: string;
  position: number;
  state: string;
  created_at?: string | null;
  game_id: string;
}

type SlotLookup =
  | { ok: true; category: SlotCategory | null; rowCount: number }
  | { ok: false; error: string };

async function findSlotCategory(
  admin: ReturnType<typeof getSupabaseAdmin>,
  gameId: string,
  position: number,
): Promise<SlotLookup> {
  const { data, error } = await admin
    .from("categories")
    .select("id, game_id, name, topic, position, state, created_at")
    .eq("game_id", gameId)
    .eq("position", position);
  if (error) {
    return {
      ok: false,
      error: error.message ?? "could not check for an existing category",
    };
  }
  // A slot doubled before this fix can hold two rows; answer with the one every
  // screen shows for that slot (most picked questions first). A single row
  // needs no count, so the normal path makes no extra query.
  const rows = (data ?? []) as SlotCategory[];
  const picked = await loadPickedCountsForDoubledSlots(admin, rows);
  return { ok: true, category: pickSlotWinner(rows, picked), rowCount: rows.length };
}

function reusedBody(category: SlotCategory, requestedTopic: string) {
  return {
    category: {
      id: category.id,
      name: category.name,
      topic: category.topic,
      position: category.position,
      state: category.state,
    },
    reused: true,
    sameTopic: sameTopicText(category.topic, requestedTopic),
  };
}
