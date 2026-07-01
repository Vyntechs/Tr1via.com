"use client";

import { useEffect, useMemo, useReducer } from "react";
import { useOptionalTheme } from "@/components/system/ThemeProvider";
import { usePrefersReducedMotion } from "@/lib/hooks/usePrefersReducedMotion";
import type { ThemeKey } from "@/lib/theme/tokens";
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
  themeKey?: ThemeKey;
}

const REACTION_TONES: Record<
  RoomMagicReactionKind,
  { accent: string; glow: string; skywrite: string; launch: string }
> = {
  applause: {
    accent: "#F2C94C",
    glow: "rgba(242,201,76,.28)",
    skywrite: "BRAVO",
    launch: "fountain",
  },
  nice_one: {
    accent: "#FFD93D",
    glow: "rgba(255,217,61,.30)",
    skywrite: "NICE",
    launch: "comet",
  },
  wow: {
    accent: "#F9F3E7",
    glow: "rgba(249,243,231,.34)",
    skywrite: "WOW",
    launch: "rocket",
  },
  brutal: {
    accent: "#FFB3B3",
    glow: "rgba(255,179,179,.27)",
    skywrite: "SO CLOSE",
    launch: "loop",
  },
};

export function TVRoomMagicOverlay({
  enabled,
  event,
  themeKey: themeKeyProp,
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
  const themeKey = themeKeyProp ?? theme?.themeKey ?? "house";
  const skin = themeKey === "july" ? "july-skywrite" : "default";

  return (
    <div
      aria-hidden="true"
      data-testid="tv-room-magic-overlay"
      data-reaction-skin={skin}
      style={{
        position: "absolute",
        top: skin === "july-skywrite" ? "44%" : "7.5%",
        right: "3.2%",
        zIndex: 18,
        width: skin === "july-skywrite" ? "min(44%, 560px)" : "min(32%, 380px)",
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-end",
        gap: skin === "july-skywrite" ? "clamp(10px, 1vw, 16px)" : "clamp(7px, .8vw, 12px)",
        pointerEvents: "none",
      }}
    >
      {aggregates.map((item, index) =>
        skin === "july-skywrite" ? (
          <JulySkywriteReaction
            key={item.kind}
            kind={item.kind}
            count={item.count}
            index={index}
            reducedMotion={reducedMotion}
          />
        ) : (
          <DefaultReaction
            key={item.kind}
            kind={item.kind}
            count={item.count}
            index={index}
            ink={ink}
            paper={paper}
            line={line}
            reducedMotion={reducedMotion}
          />
        ),
      )}
      <TVRoomMagicOverlayStyles />
    </div>
  );
}

function JulySkywriteReaction({
  kind,
  count,
  index,
  reducedMotion,
}: {
  kind: RoomMagicReactionKind;
  count: number;
  index: number;
  reducedMotion: boolean;
}) {
  const tone = REACTION_TONES[kind];
  const xOffset = index % 2 === 0 ? 0 : -22;
  return (
    <div
      data-testid={`tv-room-magic-skywrite-${kind}`}
      data-reaction-launch={tone.launch}
      style={{
        position: "relative",
        minWidth: "clamp(220px, 26vw, 420px)",
        minHeight: "clamp(78px, 8vw, 122px)",
        padding: "clamp(9px, 1vw, 14px) clamp(14px, 1.4vw, 20px)",
        borderRadius: "clamp(18px, 1.9vw, 28px)",
        color: "#F9F3E7",
        transform: `translateX(${xOffset}px)`,
        filter: `drop-shadow(0 16px 34px ${tone.glow})`,
        animation: reducedMotion ? undefined : "tr1via-skywrite-card 2600ms ease-out both",
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: "inherit",
          background:
            "radial-gradient(70% 90% at 78% 44%, rgba(255,255,255,.13), transparent 58%), linear-gradient(135deg, rgba(14,26,54,.18), rgba(14,26,54,.03))",
          border: "1px solid rgba(249,243,231,.12)",
          opacity: 0.92,
        }}
      />
      <span
        style={{
          position: "absolute",
          left: "7%",
          bottom: "15%",
          width: "78%",
          height: 2,
          borderRadius: 999,
          background: `linear-gradient(90deg, transparent, ${tone.accent}, transparent)`,
          transform: "rotate(-8deg)",
          transformOrigin: "left center",
          opacity: 0.88,
          animation: reducedMotion ? undefined : "tr1via-skywrite-trail 900ms ease-out both",
        }}
      />
      <span
        style={{
          position: "absolute",
          left: "11%",
          bottom: "13%",
          width: 7,
          height: 7,
          borderRadius: 999,
          background: tone.accent,
          boxShadow: `0 0 18px ${tone.accent}, 0 0 34px ${tone.glow}`,
          animation: reducedMotion ? undefined : "tr1via-skywrite-rocket 900ms ease-out both",
        }}
      />
      {count > 1 && (
        <span
          data-testid={`tv-room-magic-count-${kind}`}
          style={{
            position: "absolute",
            left: "4%",
            top: "12%",
            minWidth: 28,
            height: 28,
            borderRadius: 999,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(14,26,54,.62)",
            border: `1px solid ${tone.accent}`,
            color: "#F9F3E7",
            fontFamily: "var(--font-mono)",
            fontSize: "clamp(12px, 1vw, 16px)",
            fontWeight: 900,
            boxShadow: `0 0 20px ${tone.glow}`,
          }}
        >
          {count}
        </span>
      )}
      <span
        style={{
          position: "relative",
          zIndex: 1,
          display: "block",
          textAlign: "right",
          fontFamily: "var(--font-display)",
          fontSize: tone.skywrite.length > 6 ? "clamp(30px, 4vw, 68px)" : "clamp(42px, 5.4vw, 92px)",
          fontWeight: 800,
          lineHeight: 0.9,
          letterSpacing: tone.skywrite.length > 6 ? "0.05em" : "0.03em",
          color: "rgba(249,243,231,.92)",
          textShadow: `0 0 10px rgba(249,243,231,.40), 0 0 26px ${tone.glow}`,
          WebkitTextStroke: "1px rgba(255,255,255,.20)",
          animation: reducedMotion ? undefined : "tr1via-skywrite-word 2600ms ease-out both",
        }}
      >
        {tone.skywrite}
      </span>
    </div>
  );
}

function DefaultReaction({
  kind,
  count,
  index,
  ink,
  paper,
  line,
  reducedMotion,
}: {
  kind: RoomMagicReactionKind;
  count: number;
  index: number;
  ink: string;
  paper: string;
  line: string;
  reducedMotion: boolean;
}) {
  const tone = REACTION_TONES[kind];
  const label = ROOM_MAGIC_REACTION_LABELS[kind];
  return (
    <div
      data-testid={`tv-room-magic-default-${kind}`}
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
        {count > 1 ? `${label} x${count}` : label}
      </span>
    </div>
  );
}

function TVRoomMagicOverlayStyles() {
  return (
    <style>{`
      @keyframes tr1via-skywrite-card {
        0% { opacity: .22; transform: translateY(10px) scale(.97); }
        10% { opacity: 1; transform: translateY(0) scale(1); }
        78% { opacity: 1; filter: blur(0); }
        100% { opacity: 0; transform: translateY(-8px) scale(1.02); filter: blur(3px); }
      }
      @keyframes tr1via-skywrite-rocket {
        0% { transform: translate(0, 0) scale(.65); opacity: 0; }
        15% { opacity: 1; }
        100% { transform: translate(76px, -42px) scale(1); opacity: .92; }
      }
      @keyframes tr1via-skywrite-trail {
        0% { opacity: 0; clip-path: inset(0 100% 0 0); }
        30% { opacity: .95; }
        100% { opacity: .35; clip-path: inset(0 0 0 0); }
      }
      @keyframes tr1via-skywrite-word {
        0% { opacity: .34; filter: blur(7px); transform: translateY(8px) scale(.98); }
        12% { opacity: .96; filter: blur(0); transform: translateY(0) scale(1); }
        78% { opacity: .92; filter: blur(.4px); }
        100% { opacity: 0; filter: blur(8px); transform: translateY(-8px) scale(1.03); }
      }
      @media (prefers-reduced-motion: reduce) {
        [data-reaction-skin="july-skywrite"] * {
          animation: none !important;
        }
      }
    `}</style>
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
