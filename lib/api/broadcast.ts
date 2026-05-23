// Server-side Supabase Realtime broadcast helpers.
//
// The "one press, three surfaces" architecture: when the host taps Reveal,
// we want every phone + the TV to display the question within ~150ms.
// Postgres Changes (the row-insert publication) is ~250-500ms; broadcast
// channels are ~50-100ms because they skip the WAL round-trip.
//
// We use BOTH for resilience:
//   - Broadcast on `room:{code}` for low-latency UI animation triggers
//     ("reveal", "undo", "resolve"). Each carries a server `serverNow`
//     timestamp so the receiver can compute timer remaining without trusting
//     its own clock.
//   - Postgres Changes on tables (players, answers, reveals, questions, …)
//     for durable state. A late-joining device reconnecting picks up the
//     last reveal row directly from the table; it doesn't need to have
//     seen the broadcast.
//
// IMPORTANT: this module is server-only. It uses the admin client because
// broadcasting requires bypassing RLS (the server is the trusted publisher
// for these events; RLS is for client-side reads).

import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export type RoomEventName = "reveal" | "undo" | "resolve" | "end-early";
export type CategoryEventName =
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
 * Send a single broadcast to the `room:{roomCode}` channel.
 *
 * We open a fresh channel per broadcast and tear it down immediately
 * afterwards. The Supabase Realtime client is connection-pooled, so this
 * is cheap and avoids holding server-side channels open across requests
 * (which would leak in serverless environments).
 */
export async function broadcastToRoom(
  roomCode: string,
  event: RoomEventName,
  payload: BroadcastPayload,
): Promise<void> {
  const admin = getSupabaseAdmin();
  const channel = admin.channel(`room:${roomCode}`, {
    config: { broadcast: { self: true, ack: true } },
  });
  try {
    // Subscribing is required before send() on a fresh channel.
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("broadcast subscribe timed out")),
        3_000,
      );
      channel.subscribe((status) => {
        if (status === "SUBSCRIBED") {
          clearTimeout(timeout);
          resolve();
        }
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          clearTimeout(timeout);
          reject(new Error(`broadcast subscribe failed: ${status}`));
        }
      });
    });
    await channel.send({
      type: "broadcast",
      event,
      payload,
    });
  } finally {
    await admin.removeChannel(channel);
  }
}

/**
 * Send a broadcast to the per-category channel `category:{categoryId}`.
 *
 * The host's question-generation UI subscribes to this channel during the
 * background generation job to receive progressive updates:
 *   - `question_added` — a candidate question row was just inserted
 *   - `photo_attached` — its Pexels photo finished attaching
 *   - `done`           — the batch is complete
 *   - `error`          — the job failed (UI surfaces a retry button)
 *
 * Same teardown discipline as broadcastToRoom: fresh channel per send.
 */
export async function broadcastToCategory(
  categoryId: string,
  event: CategoryEventName,
  payload: CategoryBroadcastPayload,
): Promise<void> {
  const admin = getSupabaseAdmin();
  const channel = admin.channel(`category:${categoryId}`, {
    config: { broadcast: { self: true, ack: true } },
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("category broadcast subscribe timed out")),
        3_000,
      );
      channel.subscribe((status) => {
        if (status === "SUBSCRIBED") {
          clearTimeout(timeout);
          resolve();
        }
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          clearTimeout(timeout);
          reject(new Error(`category broadcast subscribe failed: ${status}`));
        }
      });
    });
    await channel.send({
      type: "broadcast",
      event,
      payload,
    });
  } finally {
    await admin.removeChannel(channel);
  }
}
