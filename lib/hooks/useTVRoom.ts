// useTVRoom — TV-surface analog of useRoom.
//
// The venue TV is anonymous (no auth, no device cookie), so the direct
// Supabase reads `useRoom` performs would be denied by RLS. Instead we go
// through a small server endpoint that uses the admin client to return a
// curated snapshot. The TV then subscribes only to the `room:{code}`
// broadcast channel — which is auth-free and serves as the wake-up signal
// for "something changed, re-fetch your snapshot."
//
// In practice the TV refreshes the snapshot on these triggers:
//   1. The initial mount (bootstrap).
//   2. Any broadcast on `room:{code}` (`reveal`, `undo`, `resolve`,
//      `end-early`) — these are the host's high-signal moments.
//   3. A 4-second safety re-fetch so any missed broadcast self-heals.
//
// The hook also exposes the most recent broadcast tag so the TV can derive
// the timer (revealedAt + serverNow) without waiting for the next snapshot.

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import { parseRoomCode } from "@/lib/game/room-code";
import { withTimeout, BOOTSTRAP_TIMEOUT_MS } from "@/lib/realtime/readTimeout";
import type { FireworksBeat } from "@/components/system/PyrotechnicsBeatConductor";
import {
  isRoomMagicReactionKind,
  type RoomMagicReactionEvent,
} from "@/lib/room-magic/reactions";

const SAFETY_REFETCH_MS = 4000;

export interface TVNight {
  /** Audience-scoped presentation key, never the database night id. */
  id: string;
  venueName: string;
  /** Per-night theme override. Null when the host hasn't picked a special
   *  theme for this night — falls through to `hostDefaultThemeKey`. */
  themeKey: string | null;
  /** Host's default theme. Used when `themeKey` is null. May be null when
   *  the snapshot was fetched before migration 0006 was applied — the
   *  client falls through to SYSTEM_DEFAULT in that case. */
  hostDefaultThemeKey: string | null;
  roomCode: string;
  openedAt: string | null;
  closedAt: string | null;
  scheduledAt: string | null;
  isLocked: boolean;
  roomMagicEnabled: boolean;
}

export interface TVGame {
  id: string;
  gameNo: 1 | 2;
  state: "draft" | "ready" | "live" | "done";
  startedAt: string | null;
  endedAt: string | null;
  categoryCount: number;
  questionCount: number;
}

export interface TVCategory {
  id: string;
  gameId: string;
  name: string;
  topic: string;
  position: number;
  color: string | null;
  state: "draft" | "generating" | "review" | "ready";
}

export interface TVQuestion {
  id: string;
  categoryId: string;
  pointValue: 100 | 200 | 300 | 400 | 500 | 600 | 700 | null;
  prompt: string;
  options: [string, string, string, string];
  /**
   * The correct answer. `null` until the question is RESOLVED (`finishedAt`
   * set) — the public TV feed withholds it from unrevealed questions so a
   * player can't read upcoming answers off the snapshot (security, see
   * `serializeBoardQuestion`). Only the reveal screen reads it, by which
   * point the question is finished.
   */
  correctIndex: 0 | 1 | 2 | 3 | null;
  imageUrl: string | null;
  factBlurb: string | null;
  playedAt: string | null;
  finishedAt: string | null;
  isPicked: boolean;
}

export interface TVPlayer {
  /** Audience-scoped presentation key, never the database player id. */
  id: string;
  displayName: string;
  joinedAt: string;
  lastSeenAt: string;
}

export interface TVScore {
  player_key: string;
  display_name: string;
  score: number;
  correct_count: number;
  answered_count: number;
  fastest_correct_ms: number | null;
}

export interface TVAnswer {
  question_id: string;
  player_key: string;
  player_name: string;
  ms_to_lock: number;
  /** Withheld (null) until the question is RESOLVED — the public TV feed
   *  never ships correctness for a live question (anti-cheat). */
  is_correct: boolean | null;
  /** The player's pick. Withheld (null) until the question is RESOLVED so a
   *  player can't read opponents' answers mid-question off this public feed
   *  (pentest 2026-06-13). The venue TV's live "locked in" display only needs
   *  player_name + ms_to_lock; only the host-side mirror ever reads the pick. */
  chosen_index: 0 | 1 | 2 | 3 | null;
}

export interface TVReveal {
  id: string;
  gameId: string;
  questionId: string;
  event: "reveal" | "undo" | "end-early" | "resolve";
  occurredAt: string;
  metadata: Record<string, unknown> | null;
}

export interface TVSnapshot {
  night: TVNight;
  games: TVGame[];
  currentGameId: string | null;
  categories: TVCategory[];
  questions: TVQuestion[];
  liveQuestionId: string | null;
  targetQuestionId: string | null;
  players: TVPlayer[];
  scores: TVScore[];
  liveAnswers: TVAnswer[];
  reveals: TVReveal[];
  roomMagicReactions?: RoomMagicReactionEvent[];
}

export interface TVBroadcast {
  event: "reveal" | "undo" | "resolve" | "end-early" | "player-joined";
  /** Question id for reveal/undo/resolve/end-early; empty string for
   *  player-joined. */
  questionId: string;
  serverNow: string;
  revealedAt?: string;
  correctIndex?: number;
  /** player-joined-specific. */
  playerId?: string;
  displayName?: string;
  colorKey?: number;
  joinedAt?: string;
}

export type TVRoomStatus = "loading" | "ready" | "not-found" | "error";

export interface TVRoomState {
  status: TVRoomStatus;
  snapshot: TVSnapshot | null;
  lastBroadcast: TVBroadcast | null;
  /** Most recent synchronized firework beat (July). Carried separately from
   *  lastBroadcast (cosmetic — must not trigger a snapshot refetch). The
   *  PyrotechnicsBeatConductor reads this and schedules the burst for `fireAt`. */
  lastFireworksBeat: FireworksBeat | null;
  /** Most recent Room Magic reaction. Cosmetic-only: never mutates
   *  lastBroadcast or triggers a snapshot refetch. */
  lastRoomMagicReaction: RoomMagicReactionEvent | null;
  /** Force a manual refetch (e.g. after the host triggers an event). */
  refresh: () => void;
}

export function useTVRoom(roomCodeRaw: string | null): TVRoomState {
  const [status, setStatus] = useState<TVRoomStatus>("loading");
  const [snapshot, setSnapshot] = useState<TVSnapshot | null>(null);
  const [lastBroadcast, setLastBroadcast] = useState<TVBroadcast | null>(null);
  const [lastFireworksBeat, setLastFireworksBeat] = useState<FireworksBeat | null>(null);
  const [lastRoomMagicReaction, setLastRoomMagicReaction] =
    useState<RoomMagicReactionEvent | null>(null);
  const safetyHandle = useRef<ReturnType<typeof setInterval> | null>(null);

  const code = roomCodeRaw ? parseRoomCode(roomCodeRaw) : null;

  // Stable fetcher — `code` is captured per-effect-run via the closure.
  const fetchSnapshot = useCallback(async () => {
    if (!code) return;
    try {
      // Bound the fetch so a hung request fast-fails to "error" (and the 4s
      // safety poll auto-recovers) rather than spinning the TV forever. The TV
      // reads server-side via Vercel, so it's immune to the venue WiFi that
      // blocks the host/player's direct Supabase reads — this just guards the
      // rarer hung-Vercel/DNS case.
      const res = await withTimeout(
        fetch(`/api/tv/${code}/snapshot`, { cache: "no-store" }),
        BOOTSTRAP_TIMEOUT_MS,
        "tv/snapshot",
      );
      if (res.status === 404) {
        setStatus("not-found");
        setSnapshot(null);
        return;
      }
      if (!res.ok) {
        setStatus("error");
        return;
      }
      const data = (await res.json()) as TVSnapshot;
      setSnapshot(data);
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, [code]);

  useEffect(() => {
    if (!code) {
      return;
    }
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setStatus("loading");
      setLastRoomMagicReaction(null);
      void fetchSnapshot();
    });

    // Subscribe to the broadcast channel for low-latency wake-ups. Broadcast
    // is auth-free; anonymous TVs receive these.
    const supa = getSupabaseBrowser();
    const channel = supa
      .channel(`room:${code}`)
      .on("broadcast", { event: "reveal" }, (msg) => {
        const p = msg.payload as Record<string, unknown>;
        setLastBroadcast({
          event: "reveal",
          questionId: String(p.questionId),
          serverNow: String(p.serverNow),
          revealedAt: typeof p.revealedAt === "string" ? p.revealedAt : undefined,
        });
        void fetchSnapshot();
      })
      .on("broadcast", { event: "undo" }, (msg) => {
        const p = msg.payload as Record<string, unknown>;
        setLastBroadcast({
          event: "undo",
          questionId: String(p.questionId),
          serverNow: String(p.serverNow),
        });
        void fetchSnapshot();
      })
      .on("broadcast", { event: "resolve" }, (msg) => {
        const p = msg.payload as Record<string, unknown>;
        setLastBroadcast({
          event: "resolve",
          questionId: String(p.questionId),
          serverNow: String(p.serverNow),
          correctIndex:
            typeof p.correctIndex === "number" ? p.correctIndex : undefined,
        });
        void fetchSnapshot();
      })
      .on("broadcast", { event: "end-early" }, (msg) => {
        const p = msg.payload as Record<string, unknown>;
        setLastBroadcast({
          event: "end-early",
          questionId: String(p.questionId),
          serverNow: String(p.serverNow),
        });
        void fetchSnapshot();
      })
      .on("broadcast", { event: "game-ended" }, () => {
        // No questionId — this is a game-level state flip. Refresh the
        // snapshot so the TV moves to intermission (game 1) or finale
        // (game 2) immediately instead of waiting on the 4s safety poll.
        void fetchSnapshot();
      })
      .on("broadcast", { event: "player-joined" }, (msg) => {
        // Magic-Welcome wake-up for the TV — fires within ~300ms of the
        // join (4s ahead of the safety poll). We refresh the snapshot
        // immediately so the JUST-JOINED roster includes the new
        // player by the time the welcome tile lands.
        const p = msg.payload as Record<string, unknown>;
        setLastBroadcast({
          event: "player-joined",
          questionId: "",
          serverNow: String(p.serverNow ?? ""),
          playerId: typeof p.playerId === "string" ? p.playerId : undefined,
          displayName:
            typeof p.displayName === "string" ? p.displayName : undefined,
          colorKey: typeof p.colorKey === "number" ? p.colorKey : undefined,
          joinedAt: typeof p.joinedAt === "string" ? p.joinedAt : undefined,
        });
        void fetchSnapshot();
      })
      .on("broadcast", { event: "fireworks" }, (msg) => {
        // Cosmetic synchronized firework beat (July). Surface it for the
        // PyrotechnicsBeatConductor — NO fetchSnapshot (nothing changed) and
        // separate from lastBroadcast. Stamp receivedAtMs locally so the
        // conductor's staleness check is immune to clock skew.
        const p = msg.payload as Record<string, unknown>;
        if (typeof p.fireAt !== "string" || typeof p.serverNow !== "string") return;
        const kind = p.kind === "finale" ? "finale" : "salvo";
        setLastFireworksBeat({
          kind,
          fireAt: p.fireAt,
          serverNow: p.serverNow,
          receivedAtMs: Date.now(),
        });
      })
      .on("broadcast", { event: "room-magic-reaction" }, (msg) => {
        // Cosmetic room reaction. Surface it separately from lastBroadcast so
        // TV wake-up/refetch behavior stays reserved for game-state events.
        const p = msg.payload as Record<string, unknown>;
        const id = p.id;
        const kind = p.kind;
        const serverNow = p.serverNow;
        if (
          typeof id !== "string" ||
          !isRoomMagicReactionKind(kind) ||
          typeof serverNow !== "string"
        ) {
          return;
        }
        setLastRoomMagicReaction({
          id,
          kind,
          serverNow,
        });
      })
      .subscribe();

    // Safety polling for missed broadcasts + slow-moving state (players
    // joining the lobby, scores updating). Cheap: the snapshot route is
    // single-region, single-trip.
    safetyHandle.current = setInterval(() => {
      void fetchSnapshot();
    }, SAFETY_REFETCH_MS);

    return () => {
      cancelled = true;
      void supa.removeChannel(channel);
      if (safetyHandle.current) clearInterval(safetyHandle.current);
    };
  }, [code, fetchSnapshot]);

  return {
    status: code ? status : "loading",
    snapshot: code ? snapshot : null,
    lastBroadcast: code ? lastBroadcast : null,
    lastFireworksBeat: code ? lastFireworksBeat : null,
    lastRoomMagicReaction: code ? lastRoomMagicReaction : null,
    refresh: () => {
      if (code) void fetchSnapshot();
    },
  };
}
