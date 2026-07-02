"use client";

import { useEffect, useState } from "react";
import {
  isRoomMagicReactionKind,
  type RoomMagicReactionEvent,
} from "@/lib/room-magic/reactions";
import { parseRoomCode } from "@/lib/game/room-code";

const REPLAY_POLL_MS = 4_000;

export function useRoomMagicReactionReplay(
  roomCodeRaw: string | null | undefined,
  enabled: boolean,
): RoomMagicReactionEvent[] {
  const roomCode = roomCodeRaw ? parseRoomCode(roomCodeRaw) : "";
  const [events, setEvents] = useState<RoomMagicReactionEvent[]>([]);

  useEffect(() => {
    if (!enabled || !roomCode) return;

    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(
          `/api/room-magic/reactions/recent?code=${encodeURIComponent(roomCode)}`,
          { cache: "no-store" },
        );
        if (!res.ok) return;
        const body = (await res.json()) as { reactions?: unknown };
        if (cancelled || !Array.isArray(body.reactions)) return;
        setEvents(body.reactions.filter(isReplayableReactionEvent));
      } catch {
        // Cosmetic recovery only. The live broadcast path remains primary.
      }
    }

    void load();
    const handle = window.setInterval(() => void load(), REPLAY_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(handle);
    };
  }, [enabled, roomCode]);

  return enabled && roomCode ? events : [];
}

function isReplayableReactionEvent(value: unknown): value is RoomMagicReactionEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Record<string, unknown>;
  return (
    isRoomMagicReactionKind(event.kind) &&
    typeof event.questionId === "string" &&
    event.questionId.length > 0 &&
    typeof event.playerId === "string" &&
    event.playerId.length > 0 &&
    typeof event.serverNow === "string" &&
    event.serverNow.length > 0
  );
}
