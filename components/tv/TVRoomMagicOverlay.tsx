"use client";

import { useEffect, useMemo, useReducer } from "react";
import { useOptionalTheme } from "@/components/system/ThemeProvider";
import { usePrefersReducedMotion } from "@/lib/hooks/usePrefersReducedMotion";
import type { ThemeKey } from "@/lib/theme/tokens";
import {
  ROOM_MAGIC_REACTION_GESTURES,
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
    launch: "spark-arc",
  },
  nice_one: {
    accent: "#FFD27A",
    glow: "rgba(255,210,122,.28)",
    launch: "comet-underline",
  },
  wow: {
    accent: "#F9F3E7",
    glow: "rgba(249,243,231,.34)",
    launch: "launch-stroke",
  },
  brutal: {
    accent: "#FFB7A0",
    glow: "rgba(255,183,160,.24)",
    launch: "ember-dip",
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
    primary: "M54 84 C76 62 86 58 99 79 C111 58 123 62 145 84",
    secondary: "M60 92 C83 106 116 106 139 92",
    plume: "M26 110 C52 94 74 88 94 82",
    spark: [
      { cx: 68, cy: 59, r: 2.5 },
      { cx: 99, cy: 49, r: 4 },
      { cx: 129, cy: 58, r: 2.5 },
      { cx: 148, cy: 79, r: 2.5 },
    ],
  },
  nice_one: {
    primary: "M56 94 C76 108 103 108 126 82 C138 69 150 60 168 56",
    secondary: "M62 102 C92 93 122 77 158 71",
    plume: "M24 116 C48 98 72 90 104 85",
    spark: [
      { cx: 71, cy: 96, r: 2.5 },
      { cx: 104, cy: 91, r: 3 },
      { cx: 142, cy: 68, r: 2.5 },
      { cx: 168, cy: 56, r: 3.5 },
    ],
  },
  wow: {
    primary: "M95 34 L103 59 L128 60 L108 74 L116 97 L95 82 L74 97 L82 74 L62 60 L87 59 Z",
    secondary: "M57 83 C74 63 84 58 95 60 C107 58 117 63 133 83",
    plume: "M38 118 C56 100 72 88 92 74",
    spark: [
      { cx: 68, cy: 50, r: 2.5 },
      { cx: 95, cy: 30, r: 4.5 },
      { cx: 122, cy: 50, r: 2.5 },
      { cx: 140, cy: 77, r: 2.5 },
    ],
  },
  brutal: {
    primary: "M64 71 C82 52 112 54 126 69 C136 80 135 95 123 103 C109 112 88 108 83 93 C78 77 92 68 113 70",
    secondary: "M71 102 C92 114 123 111 141 94",
    plume: "M30 116 C50 102 72 89 92 80",
    spark: [
      { cx: 74, cy: 67, r: 2.5 },
      { cx: 110, cy: 55, r: 3.5 },
      { cx: 132, cy: 81, r: 3 },
      { cx: 94, cy: 99, r: 2.5 },
    ],
  },
};

const REACTION_LAYOUTS: Record<
  RoomMagicReactionKind,
  {
    top?: string;
    bottom?: string;
    left?: string;
    right?: string;
    width: string;
    height: string;
    themeWidth: string;
    themeHeight: string;
  }
> = {
  applause: {
    top: "7%",
    left: "3.4%",
    width: "clamp(148px, 13vw, 228px)",
    height: "clamp(88px, 8vw, 136px)",
    themeWidth: "clamp(112px, 9vw, 148px)",
    themeHeight: "clamp(68px, 5.6vw, 92px)",
  },
  wow: {
    top: "5.5%",
    right: "3.8%",
    width: "clamp(156px, 14vw, 236px)",
    height: "clamp(92px, 8.4vw, 142px)",
    themeWidth: "clamp(118px, 9.2vw, 156px)",
    themeHeight: "clamp(72px, 5.8vw, 96px)",
  },
  nice_one: {
    bottom: "19%",
    right: "14%",
    width: "clamp(168px, 15vw, 252px)",
    height: "clamp(92px, 8.2vw, 140px)",
    themeWidth: "clamp(126px, 10vw, 164px)",
    themeHeight: "clamp(72px, 5.8vw, 98px)",
  },
  brutal: {
    bottom: "17%",
    left: "10%",
    width: "clamp(146px, 13vw, 220px)",
    height: "clamp(90px, 8vw, 136px)",
    themeWidth: "clamp(112px, 8.8vw, 148px)",
    themeHeight: "clamp(70px, 5.6vw, 94px)",
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

  const themeKey = themeKeyProp ?? theme?.themeKey ?? "house";
  const skin = themeKey === "july" ? "july-reaction-glyph" : "theme-reaction-glyph";

  return (
    <div
      aria-hidden="true"
      data-testid="tv-room-magic-overlay"
      data-reaction-skin={skin}
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 18,
        pointerEvents: "none",
        overflow: "hidden",
      }}
    >
      {aggregates.map((item, index) =>
        skin === "july-reaction-glyph" ? (
          <JulyReactionGlyph
            key={item.kind}
            kind={item.kind}
            count={item.count}
            reducedMotion={reducedMotion}
          />
        ) : (
          <DefaultReaction
            key={item.kind}
            kind={item.kind}
            count={item.count}
            index={index}
            themeKey={themeKey}
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
  reducedMotion,
}: {
  kind: RoomMagicReactionKind;
  count: number;
  reducedMotion: boolean;
}) {
  const tone = REACTION_TONES[kind];
  const glyph = JULY_REACTION_GLYPHS[kind];
  const layout = REACTION_LAYOUTS[kind];
  const sparkRepeats = Math.min(Math.max(count - 1, 0), 3);
  return (
    <div
      data-testid={`tv-room-magic-july-effect-${kind}`}
      data-reaction-count={count}
      data-reaction-gesture={ROOM_MAGIC_REACTION_GESTURES[kind]}
      data-reaction-launch={tone.launch}
      data-reduced-motion={reducedMotion ? "true" : undefined}
      style={{
        position: "absolute",
        top: layout.top,
        right: layout.right,
        bottom: layout.bottom,
        left: layout.left,
        width: layout.width,
        height: layout.height,
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
          left: "8%",
          bottom: "12%",
          width: 8,
          height: 8,
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
          left: `${12 + sparkRepeats * 3}%`,
          bottom: `${18 + sparkRepeats * 4}%`,
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
  themeKey,
  reducedMotion,
}: {
  kind: RoomMagicReactionKind;
  count: number;
  index: number;
  themeKey: ThemeKey;
  reducedMotion: boolean;
}) {
  const tone = REACTION_TONES[kind];
  const glyph = JULY_REACTION_GLYPHS[kind];
  const layout = REACTION_LAYOUTS[kind];
  const ring = themeKey === "may" ? "rgba(225,242,255,.44)" : "rgba(249,243,231,.28)";
  const backdrop =
    themeKey === "june"
      ? "rgba(10, 26, 34, .22)"
      : themeKey === "august"
        ? "rgba(53, 27, 12, .18)"
        : "rgba(14, 8, 5, .16)";
  const sparkRepeats = Math.min(Math.max(count - 1, 0), 2);
  return (
    <div
      data-testid={`tv-room-magic-default-${kind}`}
      data-reaction-count={count}
      data-reaction-gesture={ROOM_MAGIC_REACTION_GESTURES[kind]}
      style={{
        position: "absolute",
        top: layout.top,
        right: layout.right,
        bottom: layout.bottom,
        left: layout.left,
        width: layout.themeWidth,
        height: layout.themeHeight,
        borderRadius: 999,
        border: `1px solid ${ring}`,
        background: `radial-gradient(circle at 30% 30%, color-mix(in srgb, ${tone.accent} 18%, transparent), transparent 62%), ${backdrop}`,
        color: tone.accent,
        boxShadow: `0 12px 30px ${tone.glow}`,
        opacity: reducedMotion ? 0.88 : undefined,
        transform: `translateY(${index % 2 === 0 ? 0 : 2}px)`,
        transition: reducedMotion ? undefined : "opacity 180ms ease, transform 180ms ease",
        animation: reducedMotion ? undefined : "tr1via-theme-reaction-fade 2000ms ease-out both",
        boxSizing: "border-box",
      }}
    >
      <span
        className="tr1via-theme-launch-core"
        style={{
          position: "absolute",
          left: "11%",
          bottom: "18%",
          width: 6,
          height: 6,
          borderRadius: 999,
          background: tone.accent,
          boxShadow: `0 0 14px ${tone.accent}, 0 0 24px ${tone.glow}`,
        }}
      />
      {sparkRepeats > 0 && (
        <span
          className="tr1via-theme-room-pulse"
          style={{
            position: "absolute",
            left: `${17 + sparkRepeats * 6}%`,
            bottom: `${25 + sparkRepeats * 4}%`,
            width: `${8 + sparkRepeats * 4}px`,
            height: `${8 + sparkRepeats * 4}px`,
            borderRadius: 999,
            border: `1px solid ${tone.accent}`,
            opacity: 0.82,
          }}
        />
      )}
      <svg
        aria-hidden="true"
        className="tr1via-theme-reaction-svg"
        viewBox="0 0 200 140"
        style={{
          position: "absolute",
          inset: "7% 8%",
          width: "84%",
          height: "86%",
          overflow: "visible",
        }}
      >
        <path
          className="tr1via-theme-plume"
          d={glyph.plume}
          fill="none"
          stroke={tone.accent}
          strokeLinecap="round"
          strokeWidth="2"
          opacity=".42"
        />
        <path
          className="tr1via-theme-glyph-secondary"
          d={glyph.secondary}
          fill="none"
          stroke={tone.accent}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="3"
          opacity=".38"
        />
        <path
          className="tr1via-theme-glyph-primary"
          d={glyph.primary}
          fill="none"
          stroke={tone.accent}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="4"
        />
        {glyph.spark.map((spark, sparkIndex) => (
          <circle
            key={`${kind}-theme-${spark.cx}-${spark.cy}`}
            className="tr1via-theme-spark"
            cx={spark.cx}
            cy={spark.cy}
            r={spark.r + (sparkIndex < sparkRepeats ? 0.8 : 0)}
            fill={tone.accent}
            opacity={sparkIndex < sparkRepeats ? ".92" : ".68"}
          />
        ))}
      </svg>
    </div>
  );
}

function TVRoomMagicOverlayStyles() {
  return (
    <style>{`
      .tr1via-july-reaction-svg {
        overflow: visible;
      }
      .tr1via-theme-reaction-svg {
        overflow: visible;
      }
      .tr1via-july-glyph-primary,
      .tr1via-july-glyph-secondary,
      .tr1via-july-plume,
      .tr1via-theme-glyph-primary,
      .tr1via-theme-glyph-secondary,
      .tr1via-theme-plume {
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
      .tr1via-theme-plume {
        animation: tr1via-theme-draw 520ms cubic-bezier(.22,.76,.24,1) 90ms both,
          tr1via-theme-fade-stroke 2000ms ease-out both;
      }
      .tr1via-theme-glyph-primary {
        animation: tr1via-theme-draw 620ms cubic-bezier(.18,.8,.22,1) 220ms both,
          tr1via-theme-fade-stroke 2000ms ease-out both;
      }
      .tr1via-theme-glyph-secondary {
        animation: tr1via-theme-draw 600ms cubic-bezier(.18,.8,.22,1) 290ms both,
          tr1via-theme-fade-stroke 2000ms ease-out both;
      }
      .tr1via-july-spark {
        transform-origin: center;
        animation: tr1via-july-spark 2000ms ease-out both;
      }
      .tr1via-theme-spark {
        transform-origin: center;
        animation: tr1via-theme-spark 2000ms ease-out both;
      }
      .tr1via-july-launch-core {
        animation: tr1via-july-launch 720ms cubic-bezier(.2,.82,.22,1) both;
      }
      .tr1via-theme-launch-core {
        animation: tr1via-theme-launch 560ms cubic-bezier(.2,.82,.24,1) both;
      }
      .tr1via-july-room-pulse {
        animation: tr1via-july-room-pulse 2000ms ease-out both;
      }
      .tr1via-theme-room-pulse {
        animation: tr1via-theme-room-pulse 2000ms ease-out both;
      }
      @keyframes tr1via-july-reaction-hold {
        0% { opacity: 0; transform: translateY(12px) scale(.9); filter: blur(1px); }
        10% { opacity: .92; }
        62% { opacity: .9; transform: translateY(0) scale(1); filter: blur(0); }
        100% { opacity: 0; transform: translateY(-8px) scale(1.04); filter: blur(3px); }
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
      @keyframes tr1via-theme-reaction-fade {
        0% { opacity: 0; transform: translateY(8px) scale(.95); }
        12% { opacity: .9; }
        62% { opacity: .88; transform: translateY(0) scale(1); }
        100% { opacity: 0; transform: translateY(-5px) scale(1.03); }
      }
      @keyframes tr1via-theme-launch {
        0% { opacity: 0; transform: translate(0, 0) scale(.58); }
        100% { opacity: .82; transform: translate(54px, -32px) scale(1); }
      }
      @keyframes tr1via-theme-draw {
        0% { stroke-dashoffset: 240; opacity: 0; }
        18% { opacity: .9; }
        100% { stroke-dashoffset: 0; }
      }
      @keyframes tr1via-theme-fade-stroke {
        0%, 64% { filter: blur(0) drop-shadow(0 0 8px currentColor); }
        100% { opacity: 0; filter: blur(5px) drop-shadow(0 0 12px currentColor); }
      }
      @keyframes tr1via-theme-spark {
        0%, 34% { opacity: 0; transform: scale(.5); }
        50% { opacity: .92; transform: scale(1.06); }
        100% { opacity: 0; transform: translateY(-4px) scale(.72); }
      }
      @keyframes tr1via-theme-room-pulse {
        0%, 26% { opacity: 0; transform: scale(.35); }
        48% { opacity: .78; transform: scale(1); }
        100% { opacity: 0; transform: scale(1.55); }
      }
      @media (prefers-reduced-motion: reduce) {
        [data-reaction-skin="july-reaction-glyph"] *,
        [data-reaction-skin="theme-reaction-glyph"] *,
        [data-reduced-motion="true"] * {
          animation: none !important;
        }
        [data-reaction-skin="july-reaction-glyph"] path,
        [data-reaction-skin="theme-reaction-glyph"] path,
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
