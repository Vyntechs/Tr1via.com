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

const DISPLAY_MS = 2000;
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
  { accent: string; glow: string; launch: string }
> = {
  applause: {
    accent: "#F2C94C",
    glow: "rgba(242,201,76,.28)",
    launch: "fountain",
  },
  nice_one: {
    accent: "#FFD93D",
    glow: "rgba(255,217,61,.30)",
    launch: "comet",
  },
  wow: {
    accent: "#F9F3E7",
    glow: "rgba(249,243,231,.34)",
    launch: "rocket",
  },
  brutal: {
    accent: "#FFB3B3",
    glow: "rgba(255,179,179,.27)",
    launch: "loop",
  },
};

const JULY_REACTION_GLYPHS: Record<
  RoomMagicReactionKind,
  {
    primary: string;
    secondary: string;
    plume: string;
    spark: Array<{ cx: number; cy: number; r: number }>;
  }
> = {
  applause: {
    primary: "M70 82 C82 56 96 52 108 77 C118 52 136 50 148 82",
    secondary: "M84 84 C96 96 122 96 135 84",
    plume: "M38 118 C56 98 72 91 92 83",
    spark: [
      { cx: 82, cy: 50, r: 3 },
      { cx: 110, cy: 42, r: 4 },
      { cx: 139, cy: 49, r: 3 },
      { cx: 154, cy: 74, r: 2.5 },
    ],
  },
  nice_one: {
    primary: "M62 84 C79 104 97 106 122 74 C134 58 148 47 166 42",
    secondary: "M74 93 C98 83 123 67 156 58",
    plume: "M42 122 C60 101 78 92 101 83",
    spark: [
      { cx: 75, cy: 88, r: 2.5 },
      { cx: 105, cy: 88, r: 3 },
      { cx: 139, cy: 57, r: 2.5 },
      { cx: 166, cy: 42, r: 3.5 },
    ],
  },
  wow: {
    primary: "M70 82 C78 52 98 48 109 76 C119 49 143 53 150 82",
    secondary: "M66 76 C86 96 133 96 154 75",
    plume: "M36 121 C55 101 74 91 98 82",
    spark: [
      { cx: 78, cy: 54, r: 3 },
      { cx: 110, cy: 41, r: 4.5 },
      { cx: 144, cy: 55, r: 3 },
      { cx: 159, cy: 83, r: 2.5 },
    ],
  },
  brutal: {
    primary: "M68 70 C94 40 142 52 143 82 C143 106 104 104 102 84 C100 66 132 66 160 76",
    secondary: "M76 96 C102 115 142 109 162 89",
    plume: "M39 121 C58 104 78 92 102 78",
    spark: [
      { cx: 77, cy: 68, r: 2.5 },
      { cx: 116, cy: 53, r: 3.5 },
      { cx: 145, cy: 83, r: 3 },
      { cx: 103, cy: 96, r: 2.5 },
    ],
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
  const skin = themeKey === "july" ? "july-reaction-glyph" : "default";

  return (
    <div
      aria-hidden="true"
      data-testid="tv-room-magic-overlay"
      data-reaction-skin={skin}
      style={
        skin === "july-reaction-glyph"
          ? {
              position: "absolute",
              inset: 0,
              zIndex: 18,
              pointerEvents: "none",
              overflow: "hidden",
            }
          : {
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
            }
      }
    >
      {aggregates.map((item, index) =>
        skin === "july-reaction-glyph" ? (
          <JulyReactionGlyph
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

function JulyReactionGlyph({
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
  const glyph = JULY_REACTION_GLYPHS[kind];
  const xOffset = index % 2 === 0 ? -50 : -38;
  const yOffset = 8 + (index % 3) * 6;
  const sparkRepeats = Math.min(Math.max(count - 1, 0), 3);
  return (
    <div
      data-testid={`tv-room-magic-july-effect-${kind}`}
      data-reaction-count={count}
      data-reaction-launch={tone.launch}
      data-reduced-motion={reducedMotion ? "true" : undefined}
      style={{
        position: "absolute",
        top: `${yOffset}%`,
        left: `calc(50% + ${xOffset}px)`,
        width: "clamp(150px, 14vw, 250px)",
        height: "clamp(96px, 9vw, 152px)",
        transform: "translateX(-50%)",
        color: tone.accent,
        filter: `drop-shadow(0 18px 38px ${tone.glow})`,
        opacity: reducedMotion ? 0.82 : undefined,
        animation: reducedMotion ? undefined : "tr1via-july-reaction-hold 2000ms ease-out both",
        boxSizing: "border-box",
      }}
    >
      <span
        className="tr1via-july-launch-core"
        style={{
          position: "absolute",
          left: "10%",
          bottom: "10%",
          width: 7,
          height: 7,
          borderRadius: 999,
          background: tone.accent,
          boxShadow: `0 0 18px ${tone.accent}, 0 0 34px ${tone.glow}`,
        }}
      />
      {sparkRepeats > 0 && (
        <span
          className="tr1via-july-room-pulse"
          style={{
            position: "absolute",
            left: `${14 + sparkRepeats * 3}%`,
            bottom: `${18 + sparkRepeats * 5}%`,
            width: `${10 + sparkRepeats * 5}px`,
            height: `${10 + sparkRepeats * 5}px`,
            borderRadius: 999,
            border: `1px solid ${tone.accent}`,
            boxShadow: `0 0 22px ${tone.glow}`,
          }}
        />
      )}
      <svg
        aria-hidden="true"
        className="tr1via-july-reaction-svg"
        viewBox="0 0 200 140"
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          overflow: "visible",
        }}
      >
        <path
          className="tr1via-july-plume"
          d={glyph.plume}
          fill="none"
          stroke={tone.accent}
          strokeLinecap="round"
          strokeWidth="2"
          opacity=".55"
        />
        <path
          className="tr1via-july-glyph-secondary"
          d={glyph.secondary}
          fill="none"
          stroke={tone.accent}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="3"
          opacity=".42"
        />
        <path
          className="tr1via-july-glyph-primary"
          d={glyph.primary}
          fill="none"
          stroke={tone.accent}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="4"
        />
        {glyph.spark.map((spark, sparkIndex) => (
          <circle
            key={`${kind}-${spark.cx}-${spark.cy}`}
            className="tr1via-july-spark"
            cx={spark.cx}
            cy={spark.cy}
            r={spark.r + (sparkIndex < sparkRepeats ? 1.2 : 0)}
            fill={tone.accent}
            opacity={sparkIndex < sparkRepeats ? ".95" : ".78"}
          />
        ))}
      </svg>
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
      .tr1via-july-reaction-svg {
        overflow: visible;
      }
      .tr1via-july-glyph-primary,
      .tr1via-july-glyph-secondary,
      .tr1via-july-plume {
        stroke-dasharray: 240;
        stroke-dashoffset: 240;
        filter: drop-shadow(0 0 10px currentColor);
      }
      .tr1via-july-plume {
        animation: tr1via-july-draw 620ms cubic-bezier(.2,.72,.24,1) 120ms both,
          tr1via-july-smoke-fade 2000ms ease-out both;
      }
      .tr1via-july-glyph-primary {
        animation: tr1via-july-draw 760ms cubic-bezier(.16,.82,.22,1) 420ms both,
          tr1via-july-smoke-fade 2000ms ease-out both;
      }
      .tr1via-july-glyph-secondary {
        animation: tr1via-july-draw 720ms cubic-bezier(.16,.82,.22,1) 540ms both,
          tr1via-july-smoke-fade 2000ms ease-out both;
      }
      .tr1via-july-spark {
        transform-origin: center;
        animation: tr1via-july-spark 2000ms ease-out both;
      }
      .tr1via-july-launch-core {
        animation: tr1via-july-launch 720ms cubic-bezier(.2,.82,.22,1) both;
      }
      .tr1via-july-room-pulse {
        animation: tr1via-july-room-pulse 2000ms ease-out both;
      }
      @keyframes tr1via-july-reaction-hold {
        0% { opacity: 0; transform: translateX(-50%) translateY(12px) scale(.9); filter: blur(1px); }
        10% { opacity: .92; }
        62% { opacity: .9; transform: translateX(-50%) translateY(0) scale(1); filter: blur(0); }
        100% { opacity: 0; transform: translateX(-50%) translateY(-8px) scale(1.04); filter: blur(3px); }
      }
      @keyframes tr1via-july-launch {
        0% { opacity: 0; transform: translate(0, 0) scale(.58); }
        14% { opacity: 1; }
        100% { opacity: .88; transform: translate(74px, -56px) scale(1); }
      }
      @keyframes tr1via-july-draw {
        0% { stroke-dashoffset: 240; opacity: 0; }
        18% { opacity: .95; }
        100% { stroke-dashoffset: 0; }
      }
      @keyframes tr1via-july-smoke-fade {
        0%, 58% { filter: blur(0) drop-shadow(0 0 10px currentColor); }
        100% { opacity: 0; filter: blur(7px) drop-shadow(0 0 20px currentColor); }
      }
      @keyframes tr1via-july-spark {
        0%, 30% { opacity: 0; transform: scale(.4); }
        48% { opacity: .98; transform: scale(1.1); }
        100% { opacity: 0; transform: translateY(-5px) scale(.65); }
      }
      @keyframes tr1via-july-room-pulse {
        0%, 24% { opacity: 0; transform: scale(.3); }
        46% { opacity: .9; transform: scale(1); }
        100% { opacity: 0; transform: scale(1.8); }
      }
      @media (prefers-reduced-motion: reduce) {
        [data-reaction-skin="july-reaction-glyph"] *,
        [data-reduced-motion="true"] * {
          animation: none !important;
        }
        [data-reaction-skin="july-reaction-glyph"] path,
        [data-reduced-motion="true"] path {
          stroke-dashoffset: 0 !important;
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
