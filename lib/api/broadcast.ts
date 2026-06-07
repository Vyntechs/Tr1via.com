// Server-side Supabase Realtime broadcast helpers.
//
// The "one press, three surfaces" architecture: when the host taps Reveal,
// we want every phone + the TV to display the question within ~250ms.
//
// We use the Supabase Realtime REST endpoint (POST /realtime/v1/api/broadcast)
// instead of the WebSocket channel.subscribe()+send() flow because the
// subscribe round-trip alone costs 1-1.5s against remote Supabase from a
// serverless function (verified empirically — see tests/e2e/reveal-sync.spec.ts).
// The REST endpoint is fire-and-forget: one HTTP POST authenticated with the
// service role key, no channel state.
//
// Clients subscribe normally via supabase.channel("room:K9PR4M") — they
// receive these REST-sent broadcasts identically to channel-sent ones.
//
// For durable state, we ALSO rely on Postgres Changes (the row-insert
// publication enabled in 0003_realtime.sql). A late-joining device that
// missed a broadcast picks up the last reveal row directly from the
// `reveals` table — it doesn't need to have seen the broadcast.
//
// IMPORTANT: this module is server-only. Service-role-keyed broadcast
// bypasses RLS (the server is the trusted publisher; RLS is for client
// reads).

import "server-only";

export type RoomEventName =
  | "reveal"
  | "undo"
  | "resolve"
  | "end-early"
  | "game-ended"
  | "player-joined";
export type CategoryEventName =
  | "progress"
  | "question_added"
  | "photo_attached"
  | "done"
  | "error";

export interface BroadcastPayload {
  questionId: string;
  // Server's idea of "now" at broadcast time. Clients compare to their
  // local clock to compute display offsets. Always ISO string.
  serverNow: string;
  // Event-specific extras (revealedAt, correctIndex, awards…).
  [extra: string]: unknown;
}

export interface CategoryBroadcastPayload {
  serverNow: string;
  [extra: string]: unknown;
}

/**
 * Phase of the background generation job, carried by `progress` heartbeats.
 * Single source of truth so the server send site and the host UI can't drift.
 */
export type GenerationPhase = "writing" | "checking";

/** Payload for the `progress` heartbeat event. */
export interface CategoryProgressPayload extends CategoryBroadcastPayload {
  phase: GenerationPhase;
}

interface BroadcastMessage {
  topic: string;
  event: string;
  payload: Record<string, unknown>;
  private?: boolean;
}

/**
 * Low-level: post one or more broadcast messages to the Realtime REST
 * endpoint. Resolves once Supabase returns 202 Accepted (~50-100ms from
 * us-east-1 to us-east-1). Throws on non-2xx — callers can choose to
 * swallow (best-effort fan-out, durable state still flows via Postgres
 * Changes) or rethrow.
 */
async function postBroadcasts(messages: BroadcastMessage[]): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("broadcastToRoom: missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  const res = await fetch(`${url}/realtime/v1/api/broadcast`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({ messages }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`broadcast HTTP ${res.status}: ${body}`);
  }
}

/**
 * Send a broadcast to the `room:{roomCode}` channel. Fire-and-forget at the
 * HTTP layer — resolves after Supabase 202s. Clients subscribed to that
 * channel receive it within ~50-100ms.
 */
export async function broadcastToRoom(
  roomCode: string,
  event: RoomEventName,
  payload: BroadcastPayload,
): Promise<void> {
  await postBroadcasts([
    {
      topic: `room:${roomCode}`,
      event,
      payload: payload as unknown as Record<string, unknown>,
    },
  ]);
}

/**
 * Broadcast that a new player just joined the night. Carries the new player's
 * id, display name, joined-at, and a stable color key so every surface
 * (TV, host live console, the joining player's own phone) lights up the
 * "magic welcome" moment within ~300ms — without waiting on the 4-second
 * snapshot poll that useTVRoom uses as a fallback.
 *
 * Best-effort. If the broadcast fails, the persistent state (the inserted
 * players row) will still propagate via postgres_changes / the safety poll.
 */
export async function broadcastPlayerJoined(
  roomCode: string,
  player: {
    id: string;
    displayName: string;
    joinedAt: string;
    colorKey: number;
  },
): Promise<void> {
  await postBroadcasts([
    {
      topic: `room:${roomCode}`,
      event: "player-joined",
      payload: {
        playerId: player.id,
        displayName: player.displayName,
        joinedAt: player.joinedAt,
        colorKey: player.colorKey,
        serverNow: new Date().toISOString(),
      },
    },
  ]);
}

/**
 * Broadcast that a game just ended. Carries the gameId (not a questionId —
 * end-of-game is a game-level event). Subscribers use this as a wake-up to
 * re-fetch their snapshot so phones flip to PlayerJoinGame2 / TV flips to
 * Intermission without waiting on postgres_changes for the games row.
 */
export async function broadcastGameEnded(
  roomCode: string,
  gameId: string,
): Promise<void> {
  await postBroadcasts([
    {
      topic: `room:${roomCode}`,
      event: "game-ended",
      payload: {
        gameId,
        serverNow: new Date().toISOString(),
      },
    },
  ]);
}

/**
 * Send a broadcast to `category:{categoryId}`. Used by the background
 * question-generation job to stream progressive updates to HostGenLoading /
 * HostGenPick:
 *   - `progress`       — heartbeat while writing/fact-checking, before any
 *                        question row exists; carries `phase` so the UI shows
 *                        live status and the client safety timer stays armed
 *                        off real activity instead of false-alarming
 *   - `question_added` — a candidate question row was just inserted
 *   - `photo_attached` — its Pexels photo finished attaching
 *   - `done`           — the batch is complete
 *   - `error`          — the job failed (UI surfaces a retry button)
 */
export async function broadcastToCategory(
  categoryId: string,
  event: CategoryEventName,
  payload: CategoryBroadcastPayload,
): Promise<void> {
  await postBroadcasts([
    {
      topic: `category:${categoryId}`,
      event,
      payload: payload as unknown as Record<string, unknown>,
    },
  ]);
}
