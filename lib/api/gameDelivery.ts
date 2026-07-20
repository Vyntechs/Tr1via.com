import "server-only";

import { getDeviceId, getAuthedHost } from "@/lib/api/auth";
import { presentationKey } from "@/lib/room/presentationKey";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { deriveDeliveryReceipt, type LiveRevision, type SurfaceObservation } from "@/lib/host/gameDelivery";

export interface ObservationContext {
  nightId: string;
  surfaceKind: "tv" | "player";
  subjectKey: string;
  canonical: LiveRevision;
}

type ContextResult =
  | { ok: true; context: ObservationContext }
  | { ok: false; status: 403 | 404 | 409 | 500 };

type DeliveryAdmin = {
  rpc(name: string, args?: Record<string, unknown>): Promise<{ data: unknown; error: { message?: string } | null }>;
  from(table: "surface_observations"): {
    select(columns: string): {
      eq(column: string, value: string): Promise<{ data: Array<Record<string, unknown>> | null; error: { message?: string } | null }>;
    };
  };
};

function deliveryAdmin(): DeliveryAdmin {
  return getSupabaseAdmin() as unknown as DeliveryAdmin;
}

function secret(): string | null {
  return process.env.SESSION_SECRET || null;
}

function canonicalMatches(left: LiveRevision, right: LiveRevision): boolean {
  return left.runId === right.runId &&
    left.roomRevision === right.roomRevision &&
    left.controlRevision === right.controlRevision &&
    left.playId === right.playId;
}

export function parseObservationRevision(value: unknown): LiveRevision | null {
  if (!value || typeof value !== "object") return null;
  const body = value as Record<string, unknown>;
  if (typeof body.runId !== "string" || body.runId.length === 0) return null;
  if (!Number.isInteger(body.roomRevision) || Number(body.roomRevision) < 0) return null;
  if (!Number.isInteger(body.controlRevision) || Number(body.controlRevision) < 0) return null;
  if (!(body.playId === null || typeof body.playId === "string")) return null;
  return {
    runId: body.runId,
    roomRevision: Number(body.roomRevision),
    controlRevision: Number(body.controlRevision),
    playId: body.playId as string | null,
  };
}

async function canonicalForNight(night: {
  id: string;
  current_run_id?: string | null;
  room_revision?: number | null;
  control_revision?: number | null;
}): Promise<LiveRevision | null> {
  if (!night.current_run_id) return null;
  const admin = getSupabaseAdmin();
  const { data: liveGame, error: gameError } = await admin
    .from("games")
    .select("id")
    .eq("night_id", night.id)
    .eq("state", "live")
    .maybeSingle();
  if (gameError) return null;
  let playId: string | null = null;
  if (liveGame) {
    const { data: plays, error } = await admin
      .from("question_plays")
      .select("id")
      .eq("night_id", night.id)
      .eq("run_id", night.current_run_id)
      .eq("game_id", liveGame.id)
      .neq("status", "undone")
      .order("opened_at", { ascending: false })
      .limit(1);
    if (error) return null;
    playId = plays?.[0]?.id ?? null;
  }
  return {
    runId: night.current_run_id,
    roomRevision: Number(night.room_revision ?? 0),
    controlRevision: Number(night.control_revision ?? 0),
    playId,
  };
}

async function nightByCode(code: string) {
  return getSupabaseAdmin()
    .from("nights")
    .select("id, host_id, answer_engine, current_run_id, room_revision, control_revision")
    .eq("room_code", code)
    .maybeSingle();
}

export async function resolvePlayerObservationContext(code: string): Promise<ContextResult> {
  const signingSecret = secret();
  const deviceId = await getDeviceId();
  if (!signingSecret || !deviceId) return { ok: false, status: 403 };
  const { data: night, error: nightError } = await nightByCode(code);
  if (nightError) return { ok: false, status: 500 };
  if (!night) return { ok: false, status: 404 };
  if (night.answer_engine !== "resilient_v1") return { ok: false, status: 409 };

  const { data: player, error: playerError } = await getSupabaseAdmin()
    .from("players")
    .select("id, can_answer")
    .eq("night_id", night.id)
    .eq("device_id", deviceId)
    .is("removed_at", null)
    .maybeSingle();
  if (playerError) return { ok: false, status: 500 };
  if (!player || player.can_answer === false) return { ok: false, status: 403 };

  const { data: nightGames, error: gamesError } = await getSupabaseAdmin()
    .from("games")
    .select("id")
    .eq("night_id", night.id);
  if (gamesError) return { ok: false, status: 500 };
  const gameIds = (nightGames ?? []).map((game) => game.id);
  if (gameIds.length === 0) return { ok: false, status: 409 };
  const { data: participation, error: participationError } = await getSupabaseAdmin()
    .from("game_participations")
    .select("game_id")
    .eq("player_id", player.id)
    .in("game_id", gameIds)
    .limit(1)
    .maybeSingle();
  if (participationError) return { ok: false, status: 500 };
  if (!participation) return { ok: false, status: 403 };

  const canonical = await canonicalForNight(night);
  if (!canonical) return { ok: false, status: 409 };
  return {
    ok: true,
    context: {
      nightId: night.id,
      surfaceKind: "player",
      subjectKey: presentationKey(signingSecret, "player", "player", night.id, player.id),
      canonical,
    },
  };
}

export async function resolveTVObservationContext(code: string): Promise<ContextResult> {
  const signingSecret = secret();
  if (!signingSecret) return { ok: false, status: 500 };
  // The display snapshot remains public, but a delivery receipt is a truth
  // claim to the host. Only the authenticated owner may make that claim;
  // an anonymous separate display simply remains "recovering".
  const auth = await getAuthedHost();
  if (!auth.ok) return { ok: false, status: 403 };
  const { data: night, error } = await nightByCode(code);
  if (error) return { ok: false, status: 500 };
  if (!night) return { ok: false, status: 404 };
  if (night.host_id !== auth.host.id) return { ok: false, status: 403 };
  if (night.answer_engine !== "resilient_v1") return { ok: false, status: 409 };
  const canonical = await canonicalForNight(night);
  if (!canonical) return { ok: false, status: 409 };
  return {
    ok: true,
    context: {
      nightId: night.id,
      surfaceKind: "tv",
      subjectKey: presentationKey(signingSecret, "tv", "night", night.id, night.id),
      canonical,
    },
  };
}

export async function persistSurfaceObservation(
  context: ObservationContext,
  observed: LiveRevision,
): Promise<"accepted" | "rate_limited" | "mismatch" | "stale" | "error"> {
  if (!canonicalMatches(context.canonical, observed)) return "mismatch";
  const { data, error } = await deliveryAdmin().rpc("observe_surface_delivery", {
    p_night_id: context.nightId,
    p_surface_kind: context.surfaceKind,
    p_subject_key: context.subjectKey,
    p_run_id: observed.runId,
    p_room_revision: observed.roomRevision,
    p_control_revision: observed.controlRevision,
    p_play_id: observed.playId,
  });
  if (error) return "error";
  return data === "accepted" || data === "rate_limited" || data === "mismatch" || data === "stale"
    ? data
    : "error";
}

export async function readOwnedDeliveryReceipt(code: string): Promise<
  | { ok: true; body: { tv: "current" | "recovering"; currentPhones: number; recoveringPhones: number; canonical: LiveRevision } }
  | { ok: false; status: 401 | 403 | 404 | 409 | 500 }
> {
  const auth = await getAuthedHost();
  if (!auth.ok) return { ok: false, status: auth.status };
  const signingSecret = secret();
  if (!signingSecret) return { ok: false, status: 500 };
  const { data: night, error } = await nightByCode(code);
  if (error) return { ok: false, status: 500 };
  if (!night) return { ok: false, status: 404 };
  if (night.host_id !== auth.host.id) return { ok: false, status: 403 };
  const canonical = await canonicalForNight(night);
  if (!canonical) return { ok: false, status: 409 };

  const activeSubjectKeys = new Set<string>();
  const { data: players, error: playersError } = await getSupabaseAdmin()
    .from("players")
    .select("id")
    .eq("night_id", night.id)
    .is("removed_at", null)
    .eq("can_answer", true);
  if (playersError) return { ok: false, status: 500 };
  for (const player of players ?? []) {
    activeSubjectKeys.add(presentationKey(signingSecret, "player", "player", night.id, player.id));
  }

  const privateAdmin = deliveryAdmin();
  const { error: cleanupError } = await privateAdmin.rpc("cleanup_expired_surface_observations");
  if (cleanupError) return { ok: false, status: 500 };
  const { data: rows, error: observationError } = await privateAdmin
    .from("surface_observations")
    .select("surface_kind, subject_key, run_id, room_revision, control_revision, play_id, observed_at")
    .eq("night_id", night.id);
  if (observationError) return { ok: false, status: 500 };
  const observations: SurfaceObservation[] = (rows ?? []).flatMap((row) => {
    if ((row.surface_kind !== "tv" && row.surface_kind !== "player") || typeof row.subject_key !== "string") return [];
    return [{
      surfaceKind: row.surface_kind,
      subjectKey: row.subject_key,
      runId: typeof row.run_id === "string" ? row.run_id : null,
      roomRevision: Number(row.room_revision),
      controlRevision: Number(row.control_revision),
      playId: typeof row.play_id === "string" ? row.play_id : null,
      observedAt: String(row.observed_at),
    }];
  });
  return {
    ok: true,
    body: { ...deriveDeliveryReceipt(observations, canonical, activeSubjectKeys, new Date()), canonical },
  };
}
