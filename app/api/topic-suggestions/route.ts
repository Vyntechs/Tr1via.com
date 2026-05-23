// POST /api/topic-suggestions — player submits a topic for next week.
//
// 100-char limit (Zod). Basic sanitization: trim, strip control characters
// (the only category we strip — leave punctuation, emoji, etc. intact so
// "Bond movies (Daniel Craig)" comes through cleanly). The host's setup
// screen aggregates these as a tally ("17 people suggested X this week").
//
// One submission per request; the player can submit multiple over the
// night. We don't dedupe in-DB on (player, text) — fuzzy duplicates ("80s
// movies" vs "80's movies") are the host's call to merge.

import type { NextRequest } from "next/server";
import { TopicSuggestionSchema } from "@/lib/api/schemas";
import { badRequest, ok, forbidden, unauthorized, serverError, notFound } from "@/lib/api/responses";
import { getDeviceId } from "@/lib/api/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

// Strips ASCII control chars (0x00-0x1F and 0x7F) but keeps all printable
// + Unicode. Collapses any remaining whitespace runs to a single space,
// then trims. Defends against a phone pasting in tabs/newlines from
// auto-complete; the rest is Zod's job (length cap).
function sanitizeText(raw: string): string {
  return raw
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1F\x7F]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function POST(req: NextRequest) {
  const deviceId = await getDeviceId();
  if (!deviceId) return unauthorized("no device session");

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("invalid JSON");
  }
  const parsed = TopicSuggestionSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error);

  const cleaned = sanitizeText(parsed.data.text);
  if (cleaned.length === 0) return badRequest("empty after sanitization");
  if (cleaned.length > 100) return badRequest("over 100 characters after sanitization");

  // The suggestion must be from an active player in some night. We can't
  // get nightId from the body (the player might not know), so we resolve
  // the most-recent un-removed player row for this device — that's the
  // night they're "in." If they're not in any night, deny.
  const admin = getSupabaseAdmin();
  const { data: player } = await admin
    .from("players")
    .select("id, night_id")
    .eq("device_id", deviceId)
    .is("removed_at", null)
    .order("joined_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!player) return forbidden("not in any active night");

  const { data, error } = await admin
    .from("topic_suggestions")
    .insert({ player_id: player.id, text: cleaned })
    .select("id, text, created_at")
    .single();
  if (error || !data) return serverError(error?.message ?? "could not save suggestion");
  // 404 here would only occur if the player row vanished mid-insert (cascade
  // delete on night close); surface it cleanly rather than spinning.
  if (!data.id) return notFound("suggestion did not persist");

  return ok({ suggestionId: data.id, text: data.text, createdAt: data.created_at }, 201);
}
