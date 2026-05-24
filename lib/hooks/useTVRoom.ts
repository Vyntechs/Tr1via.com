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

const SAFETY_REFETCH_MS = 4000;

export interface TVNight {
  id: string;
  venueName: string;
  themeKey: string;
  roomCode: string;
  openedAt: string | null;
  closedAt: string | null;
  scheduledAt: string | null;
  isLocked: boolean;
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
  correctIndex: 0 | 1 | 2 | 3;
  imageUrl: string | null;
  factBlurb: string | null;
  playedAt: string | null;
  finishedAt: string | null;
  isPicked: boolean;
}

export interface TVPlayer {
  id: string;
  displayName: string;
  joinedAt: string;
  lastSeenAt: string;
}

export interface TVScore {
  player_id: string;
  display_name: string;
  score: number;
  correct_count: number;
  answered_count: number;
  fastest_correct_ms: number | null;
}

export interface TVAnswer {
  id: string;
  player_id: string;
  player_name: string;
  ms_to_lock: number;
  is_correct: boolean | null;
  chosen_index: 0 | 1 | 2 | 3;
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
}

export interface TVBroadcast {
  event: "reveal" | "undo" | "resolve" | "end-early";
  questionId: string;
  serverNow: string;
  revealedAt?: string;
  correctIndex?: number;
}

export type TVRoomStatus = "loading" | "ready" | "not-found" | "error";

export interface TVRoomState {
  status: TVRoomStatus;
  snapshot: TVSnapshot | null;
  lastBroadcast: TVBroadcast | null;
  /** Force a manual refetch (e.g. after the host triggers an event). */
  refresh: () => void;
}

export function useTVRoom(roomCodeRaw: string | null): TVRoomState {
  const [status, setStatus] = useState<TVRoomStatus>("loading");
  const [snapshot, setSnapshot] = useState<TVSnapshot | null>(null);
  const [lastBroadcast, setLastBroadcast] = useState<TVBroadcast | null>(null);
  const safetyHandle = useRef<ReturnType<typeof setInterval> | null>(null);

  const code = roomCodeRaw ? parseRoomCode(roomCodeRaw) : null;

  // Stable fetcher — `code` is captured per-effect-run via the closure.
  const fetchSnapshot = useCallback(async () => {
    if (!code) return;
    try {
      const res = await fetch(`/api/tv/${code}/snapshot`, {
        cache: "no-store",
      });
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
      setSnapshot(null);
      setStatus("loading");
      return;
    }
    setStatus("loading");
    void fetchSnapshot();

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
      .subscribe();

    // Safety polling for missed broadcasts + slow-moving state (players
    // joining the lobby, scores updating). Cheap: the snapshot route is
    // single-region, single-trip.
    safetyHandle.current = setInterval(() => {
      void fetchSnapshot();
    }, SAFETY_REFETCH_MS);

    return () => {
      void supa.removeChannel(channel);
      if (safetyHandle.current) clearInterval(safetyHandle.current);
    };
  }, [code, fetchSnapshot]);

  return {
    status,
    snapshot,
    lastBroadcast,
    refresh: () => {
      void fetchSnapshot();
    },
  };
}
