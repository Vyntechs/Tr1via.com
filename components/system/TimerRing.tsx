// Phone-sized timer ring. Shows seconds remaining numerically in the center
// and an arc that depletes around the perimeter. The first 5 seconds of the
// timer carry a brighter outer arc segment (the speed-bonus window); when
// seconds <= 5 the whole ring flips to the "wrong" color to signal urgency.
// Timer length is theme-derived (20 default, 25 on may/june) — resolved from
// the active theme so the arc always matches the countdown, never lapping.

"use client";

import { useTheme } from "./ThemeProvider";
import { questionDurationFor } from "@/lib/theme/lockInCeremony";
import type { ThemeKey } from "@/lib/theme/tokens";

export interface TimerRingProps {
  seconds: number;
  max?: number;
  size?: number;
  accent?: string;
  themeKey?: ThemeKey;
}

export function TimerRing({ seconds, max, size = 48, accent, themeKey }: TimerRingProps) {
  const { t, themeKey: ctxThemeKey } = useTheme();
  // Prop wins (tests / standalone), else the active theme. Never silently 20.
  const resolvedMax = max ?? questionDurationFor(themeKey ?? ctxThemeKey);
  const a = accent ?? t.accent;
  const stroke = 3.5;
  const r = (size - stroke) / 2;
  const C = 2 * Math.PI * r;
  const frac = Math.max(0, Math.min(1, seconds / resolvedMax));
  const danger = seconds <= 5;
  const color = danger ? t.wrong : a;

  // The first 5 seconds of the timer are the speed-bonus window — drawn as a
  // brighter outer arc segment so the boundary is visible. Hides once we
  // pass that threshold.
  const bonusFrac = 5 / resolvedMax;
  const arcStart = 1 - bonusFrac; // last segment of the circle = first 5s

  return (
    <div
      style={{ position: "relative", width: size, height: size }}
      role="timer"
      aria-label={`${seconds} seconds remaining`}
    >
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={t.line} strokeWidth={stroke} />
        {!danger && seconds > resolvedMax - 5 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={t.correct}
            strokeWidth={stroke}
            strokeDasharray={`${C * bonusFrac} ${C}`}
            strokeDashoffset={-C * arcStart}
            strokeLinecap="round"
            opacity={0.55}
          />
        )}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeDasharray={C}
          strokeDashoffset={C * (1 - frac)}
          strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 1s linear, stroke .25s" }}
        />
      </svg>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "var(--font-mono)",
          fontSize: size > 40 ? 15 : 12,
          fontWeight: 600,
          fontVariantNumeric: "tabular-nums",
          color: danger ? t.wrong : t.ink,
        }}
      >
        {seconds}
      </div>
    </div>
  );
}
