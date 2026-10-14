// POST /api/nights — host creates a new night (get-or-create).
//
// A repeated tap, a retried request or a second tab used to make a second
// night (Heather, Oct 8 2026: two nights 1.07s apart, one left empty). Now a
// call returns the host's fresh empty night if one already exists (200,
// reused: true) and only creates a new one (201) otherwise. See
// lib/host/createNightOnce.ts for the exact rule and the two layers.
//
// One night = one persistent room with two games (game 1 + game 2) that
// share a room code. Both games are inserted in 'draft' state; the host
// will populate categories + questions before opening the room.
//
// Room code collisions are statistically rare (~10^9 keyspace) but we
// retry up to 6 times against the unique partial index on (room_code)
// WHERE closed_at IS NULL. If we still collide after that, something is
// wrong (CSPRNG broken?) — return 500.

import type { NextRequest } from "next/server";
import { CreateNightSchema } from "@/lib/api/schemas";
import { badRequest, ok, serverError, unauthorized, forbidden } from "@/lib/api/responses";
import { getAuthedHost } from "@/lib/api/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { newRoomCode } from "@/lib/game/room-code";
import {
  createNightLocked,
  findReusableEmptyNight,
  type CreateNightRequest,
} from "@/lib/host/createNightOnce";

const MAX_CODE_RETRIES = 6;

export async function POST(req: NextRequest) {
  const auth = await getAuthedHost();
  if (!auth.ok) {
    return auth.status === 401 ? unauthorized(auth.error) : forbidden(auth.error);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("invalid JSON");
  }
  const parsed = CreateNightSchema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error);

  const admin = getSupabaseAdmin();
  const request: CreateNightRequest = {
    hostId: auth.host.id,
    venueName: parsed.data.venueName,
    themeKey: parsed.data.themeKey ?? null,
    scheduledAt: parsed.data.scheduledAt ?? null,
  };

  // 1. Locked get-or-create in the database, once the proposed migration
  //    (supabase/proposed/20261014_create_night_once.sql) is applied.
  const roomCodes = Array.from({ length: MAX_CODE_RETRIES }, () => newRoomCode());
  const locked = await createNightLocked(admin, request, roomCodes);
  if (locked.kind === "error") return serverError(locked.message);
  if (locked.kind === "ok") {
    return ok(locked.night, locked.night.reused ? 200 : 201);
  }

  // 2. Same rule in app code while the function is not there yet.
  const reusable = await findReusableEmptyNight(admin, request);
  if (reusable.error) return serverError(reusable.error);
  if (reusable.night) return ok(reusable.night, 200);

  // Mint a fresh room code, retrying on collision against the active
  // unique partial index.
  let inserted: { id: string; room_code: string } | null = null;
  for (let attempt = 0; attempt < MAX_CODE_RETRIES; attempt++) {
    const code = newRoomCode();
    const { data, error } = await admin
      .from("nights")
      .insert({
        host_id: auth.host.id,
        venue_name: parsed.data.venueName,
        room_code: code,
        // Leave theme_key null unless the caller explicitly sets one (e.g.
        // an "Override theme for this night" flow). Null means "use host
        // preference," which is now stored in hosts.default_theme_key.
        theme_key: parsed.data.themeKey ?? null,
        scheduled_at: parsed.data.scheduledAt ?? null,
      })
      .select("id, room_code")
      .single();
    if (!error && data) {
      inserted = data as { id: string; room_code: string };
      break;
    }
    // Postgres unique_violation = 23505. Retry only on that; bail
    // immediately for anything else (schema issue, permissions, etc).
    if (error?.code !== "23505") {
      return serverError(error?.message ?? "could not create night");
    }
  }
  if (!inserted) {
    return serverError("could not mint a unique room code");
  }

  // Seed the two empty game shells. Inserting both at once keeps it
  // single-round-trip; either both succeed or we roll back by deleting
  // the night (the FK cascade will catch any partial game inserts).
  const { error: gamesError } = await admin
    .from("games")
    .insert([
      { night_id: inserted.id, game_no: 1 },
      { night_id: inserted.id, game_no: 2 },
    ]);
  if (gamesError) {
    await admin.from("nights").delete().eq("id", inserted.id);
    return serverError(gamesError.message ?? "could not create games");
  }

  return ok(
    { nightId: inserted.id, roomCode: inserted.room_code, reused: false },
    201,
  );
}
