// API-side identity helpers.
//
// Two distinct identity tracks in TR1VIA:
//   1. Hosts authenticate via Supabase Auth (magic link). Their auth user
//      is bound to one `hosts` row on first sign-in. Host-only routes
//      verify both (a) a signed-in user exists, and (b) the user owns the
//      `nights` row referenced in the URL. This is belt-and-braces vs RLS:
//      RLS would deny the write anyway, but we want clean 401/403 codes
//      and the chance to act *before* an RLS violation bubbles up.
//   2. Players don't authenticate. They have a device cookie
//      (`tr1via_device`, set on first visit by /api/session/init) which
//      the server reads and forwards as the `x-tr1via-device` header so
//      Postgres `current_device_id()` can resolve them via RLS.
//
// All helpers return discriminated unions so call sites must handle the
// failure branch explicitly — no silent nulls.

import { getSupabaseServer } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { cookies } from "next/headers";
import { verifyDeviceCookie } from "@/lib/auth/device-cookie";
import type {
  CategoryRow,
  HostRow,
  NightRow,
  PlayerRow,
  QuestionRow,
} from "@/lib/supabase/types";

const DEVICE_COOKIE = "tr1via_device";

export type HostAuthResult =
  | { ok: true; host: HostRow }
  | { ok: false; status: 401 | 403; error: string };

/**
 * Resolve the authenticated host for this request. Returns the `hosts` row,
 * or a failure indicating whether to send 401 (no auth user) or 403 (auth
 * user exists but no corresponding hosts row yet — they need to complete
 * onboarding first).
 */
export async function getAuthedHost(): Promise<HostAuthResult> {
  const supa = await getSupabaseServer();
  const {
    data: { user },
    error: userError,
  } = await supa.auth.getUser();
  if (userError || !user) {
    return { ok: false, status: 401, error: "not signed in" };
  }
  const { data: host } = await supa
    .from("hosts")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!host) {
    return { ok: false, status: 403, error: "host profile not found" };
  }
  return { ok: true, host: host as HostRow };
}

export type NightOwnershipResult =
  | { ok: true; host: HostRow; night: NightRow }
  | { ok: false; status: 401 | 403 | 404; error: string };

/**
 * Verify the authed host owns this night. Used by every host-only mutation
 * keyed on a nightId in the URL. Returns the night row for use by the route.
 *
 * Uses the admin client to look up the night so a 404 (vs 403) is reported
 * even when RLS would normally hide the row from the calling user.
 */
export async function requireOwnedNight(
  nightId: string,
): Promise<NightOwnershipResult> {
  const auth = await getAuthedHost();
  if (!auth.ok) return auth;
  const admin = getSupabaseAdmin();
  const { data: night } = await admin
    .from("nights")
    .select("*")
    .eq("id", nightId)
    .maybeSingle();
  if (!night) return { ok: false, status: 404, error: "night not found" };
  if (night.host_id !== auth.host.id) {
    return { ok: false, status: 403, error: "not your night" };
  }
  return { ok: true, host: auth.host, night: night as NightRow };
}

/**
 * Verify the authed host owns the game (via its parent night). Returns
 * { host, night, gameId } so the route doesn't have to re-query.
 */
export async function requireOwnedGame(gameId: string): Promise<
  | { ok: true; host: HostRow; night: NightRow; gameId: string }
  | { ok: false; status: 401 | 403 | 404; error: string }
> {
  const auth = await getAuthedHost();
  if (!auth.ok) return auth;
  const admin = getSupabaseAdmin();
  const { data: game } = await admin
    .from("games")
    .select("id, night_id")
    .eq("id", gameId)
    .maybeSingle();
  if (!game) return { ok: false, status: 404, error: "game not found" };
  const night = await requireOwnedNight(game.night_id);
  if (!night.ok) return night;
  return { ok: true, host: night.host, night: night.night, gameId };
}

export type CategoryOwnershipResult =
  | { ok: true; host: HostRow; night: NightRow; category: CategoryRow }
  | { ok: false; status: 401 | 403 | 404; error: string };

/**
 * Verify the authed host owns the category (via game → night). Used by
 * every Phase 7 host route keyed on a categoryId.
 */
export async function requireOwnedCategory(
  categoryId: string,
): Promise<CategoryOwnershipResult> {
  const auth = await getAuthedHost();
  if (!auth.ok) return auth;
  const admin = getSupabaseAdmin();
  const { data: category } = await admin
    .from("categories")
    .select("*")
    .eq("id", categoryId)
    .maybeSingle();
  if (!category) return { ok: false, status: 404, error: "category not found" };
  const game = await requireOwnedGame(category.game_id);
  if (!game.ok) return game;
  return {
    ok: true,
    host: game.host,
    night: game.night,
    category: category as CategoryRow,
  };
}

export type QuestionOwnershipResult =
  | {
      ok: true;
      host: HostRow;
      night: NightRow;
      category: CategoryRow;
      question: QuestionRow;
    }
  | { ok: false; status: 401 | 403 | 404; error: string };

/**
 * Verify the authed host owns the question (via category → game → night).
 * Used by PATCH /api/questions/[id] and the image swap/upload routes.
 */
export async function requireOwnedQuestion(
  questionId: string,
): Promise<QuestionOwnershipResult> {
  const auth = await getAuthedHost();
  if (!auth.ok) return auth;
  const admin = getSupabaseAdmin();
  const { data: question } = await admin
    .from("questions")
    .select("*")
    .eq("id", questionId)
    .maybeSingle();
  if (!question) return { ok: false, status: 404, error: "question not found" };
  const category = await requireOwnedCategory(question.category_id);
  if (!category.ok) return category;
  return {
    ok: true,
    host: category.host,
    night: category.night,
    category: category.category,
    question: question as QuestionRow,
  };
}

/**
 * Read the player's device UUID from the request cookie. The cookie value
 * is `${uuid}.${hmac}` (set by /api/session/init using SESSION_SECRET); we
 * verify the signature here and return the raw UUID, or null if the cookie
 * is missing/tampered/wrong-secret. Routes should respond 401 on null.
 */
export async function getDeviceId(): Promise<string | null> {
  const jar = await cookies();
  const raw = jar.get(DEVICE_COOKIE)?.value;
  if (!raw) return null;
  const secret = process.env.SESSION_SECRET;
  if (!secret) return null;
  return verifyDeviceCookie(raw, secret);
}

export type PlayerLookupResult =
  | { ok: true; player: PlayerRow }
  | { ok: false; status: 401 | 404; error: string };

/**
 * Resolve the player row for the given playerId, ensuring the cookie's
 * device_id matches the row's device_id. This is the player-side
 * analogue of requireOwnedNight: prevents one player tampering with
 * another via a guessed ID.
 *
 * Uses the admin client because the call sometimes happens before any
 * `players` row exists for the device under RLS (e.g. just-after-insert).
 */
export async function requireOwnedPlayer(
  playerId: string,
): Promise<PlayerLookupResult> {
  const deviceId = await getDeviceId();
  if (!deviceId) {
    return { ok: false, status: 401, error: "no device session" };
  }
  const admin = getSupabaseAdmin();
  const { data: player } = await admin
    .from("players")
    .select("*")
    .eq("id", playerId)
    .maybeSingle();
  if (!player) return { ok: false, status: 404, error: "player not found" };
  if (player.device_id !== deviceId) {
    return { ok: false, status: 401, error: "device mismatch" };
  }
  return { ok: true, player: player as PlayerRow };
}

/**
 * Founder-only gate. Wraps getAuthedHost and additionally requires the
 * authed host's role to be 'founder'. Returns the host row on success so
 * call sites can record audit fields (comped_by = founder.id).
 *
 * Used by every /api/admin/* route. The DB has a unique partial index
 * making 'founder' a singleton — so this resolves to one specific user
 * (Brandon) in production.
 */
export async function requireFounder(): Promise<HostAuthResult> {
  const auth = await getAuthedHost();
  if (!auth.ok) return auth;
  if (auth.host.role !== "founder") {
    return { ok: false, status: 403, error: "founder only" };
  }
  return auth;
}
