"use client";

import { useEffect, useMemo, useReducer } from "react";
import { useOptionalTheme } from "@/components/system/ThemeProvider";
import { usePrefersReducedMotion } from "@/lib/hooks/usePrefersReducedMotion";
import {
  ROOM_MAGIC_REACTION_LABELS,
  isRoomMagicReactionKind,
  type RoomMagicReactionEvent,
  type RoomMagicReactionKind,
} from "@/lib/room-magic/reactions";

const DISPLAY_MS = 2600;
const STALE_EVENT_MS = 10_000;

interface ActiveReaction {
  id: string;
  kind: RoomMagicReactionKind;
  expiresAt: number;
  receivedAt: number;
}

type ReactionAction =
  | { type: "add"; reaction: ActiveReaction }
  | { type: "clear" }
  | { type: "prune"; now: number };

export interface TVRoomMagicOverlayProps {
  enabled: boolean;
  event: RoomMagicReactionEvent | null;
}

const REACTION_TONES: Record<
  RoomMagicReactionKind,
  { accent: string; glow: string }
> = {
  applause: { accent: "#F2C94C", glow: "rgba(242,201,76,.28)" },
  nice_one: { accent: "#7DD3FC", glow: "rgba(125,211,252,.26)" },
  wow: { accent: "#F472B6", glow: "rgba(244,114,182,.28)" },
  brutal: { accent: "#C084FC", glow: "rgba(192,132,252,.27)" },
};

export function TVRoomMagicOverlay({
  enabled,
  event,
}: TVRoomMagicOverlayProps) {
  const theme = useOptionalTheme();
  const reducedMotion = usePrefersReducedMotion();
  const [reactions, dispatch] = useReducer(reactionReducer, []);

  useEffect(() => {
    if (!enabled) {
      dispatch({ type: "clear" });
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !isUsableReactionEvent(event)) return;
    const eventAt = Date.parse(event.serverNow);
    if (!Number.isFinite(eventAt)) return;
    const now = Date.now();
    if (now - eventAt > STALE_EVENT_MS) return;

    const id = `${event.questionId}:${event.playerId}:${event.serverNow}`;
    dispatch({
      type: "add",
      reaction: {
        id,
        kind: event.kind,
        expiresAt: now + DISPLAY_MS,
        receivedAt: now,
      },
    });
  }, [enabled, event]);

  useEffect(() => {
    if (reactions.length === 0) return;
    const now = Date.now();
    const nextExpiry = Math.min(...reactions.map((item) => item.expiresAt));
    const delay = Math.max(0, nextExpiry - now) + 20;
    const handle = window.setTimeout(() => {
      dispatch({ type: "prune", now: Date.now() });
    }, delay);
    return () => window.clearTimeout(handle);
  }, [reactions]);

  const aggregates = useMemo(() => {
    const counts = new Map<
      RoomMagicReactionKind,
      { kind: RoomMagicReactionKind; count: number; latest: number }
    >();
    for (const reaction of reactions) {
      const existing = counts.get(reaction.kind);
      if (existing) {
        existing.count += 1;
        existing.latest = Math.max(existing.latest, reaction.receivedAt);
      } else {
        counts.set(reaction.kind, {
          kind: reaction.kind,
          count: 1,
          latest: reaction.receivedAt,
        });
      }
    }
    return [...counts.values()].sort((a, b) => b.latest - a.latest);
  }, [reactions]);

  if (!enabled || aggregates.length === 0) return null;

  const ink = theme?.t.ink ?? "#F9F3E7";
  const paper = theme?.t.paper ?? "#0E0805";
  const line = theme?.t.line ?? "rgba(249,243,231,.28)";

  return (
    <div
      aria-hidden="true"
      data-testid="tv-room-magic-overlay"
      style={{
        position: "absolute",
        top: "7.5%",
        right: "3.2%",
        zIndex: 18,
        width: "min(32%, 380px)",
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-end",
        gap: "clamp(7px, .8vw, 12px)",
        pointerEvents: "none",
      }}
    >
      {aggregates.map((item, index) => {
        const tone = REACTION_TONES[item.kind];
        const label = ROOM_MAGIC_REACTION_LABELS[item.kind];
        return (
          <div
            key={item.kind}
            data-testid={`tv-room-magic-pill-${item.kind}`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "flex-end",
              gap: "clamp(7px, .8vw, 10px)",
              maxWidth: "100%",
              padding: "clamp(7px, .9vw, 10px) clamp(11px, 1.2vw, 16px)",
              borderRadius: 999,
              border: `1px solid ${line}`,
              background: `linear-gradient(135deg, color-mix(in srgb, ${paper} 86%, transparent), color-mix(in srgb, ${tone.accent} 18%, ${paper}))`,
              color: ink,
              boxShadow: `0 18px 42px ${tone.glow}`,
              transform: `translateX(${index % 2 === 0 ? 0 : -14}px)`,
              transition: reducedMotion
                ? undefined
                : "opacity 180ms ease, transform 180ms ease, filter 180ms ease",
              whiteSpace: "nowrap",
              fontFamily: "var(--font-sans)",
              fontSize: "clamp(14px, 1.3vw, 22px)",
              fontWeight: 800,
              letterSpacing: 0,
              lineHeight: 1,
            }}
          >
            <span
              style={{
                width: "clamp(8px, .8vw, 12px)",
                height: "clamp(8px, .8vw, 12px)",
                borderRadius: 999,
                background: tone.accent,
                boxShadow: `0 0 18px ${tone.accent}`,
                flex: "0 0 auto",
              }}
            />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
              {item.count > 1 ? `${label} x${item.count}` : label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function reactionReducer(
  reactions: ActiveReaction[],
  action: ReactionAction,
): ActiveReaction[] {
  if (action.type === "clear") return [];
  if (action.type === "prune") {
    return reactions.filter((item) => item.expiresAt > action.now);
  }
  if (reactions.some((item) => item.id === action.reaction.id)) {
    return reactions;
  }
  const fresh = reactions.filter(
    (item) => item.expiresAt > action.reaction.receivedAt,
  );
  return [...fresh, action.reaction];
}

function isUsableReactionEvent(
  event: RoomMagicReactionEvent | null,
): event is RoomMagicReactionEvent {
  return (
    !!event &&
    isRoomMagicReactionKind(event.kind) &&
    typeof event.questionId === "string" &&
    event.questionId.length > 0 &&
    typeof event.playerId === "string" &&
    event.playerId.length > 0 &&
    typeof event.serverNow === "string" &&
    event.serverNow.length > 0
  );
}
