// TV-sized timer arc. Larger version of TimerRing — bigger numeral, thicker
// stroke. Used on the venue TV question screen.

"use client";

import { useTheme } from "./ThemeProvider";
import { questionDurationFor } from "@/lib/theme/lockInCeremony";
import type { ThemeKey } from "@/lib/theme/tokens";

export interface TVTimerArcProps {
  seconds: number;
  max?: number;
  size?: number;
  accent?: string;
  themeKey?: ThemeKey;
}

export function TVTimerArc({ seconds, max, size = 160, accent, themeKey }: TVTimerArcProps) {
  const { t, themeKey: ctxThemeKey } = useTheme();
  // Prop wins (tests / standalone), else the active theme. Never a silent default.
  const resolvedMax = max ?? questionDurationFor(themeKey ?? ctxThemeKey);
  const stroke = 10;
  const r = (size - stroke) / 2;
  const C = 2 * Math.PI * r;
  const frac = Math.max(0, Math.min(1, seconds / resolvedMax));
  const danger = seconds <= 5;
  const color = danger ? t.wrong : accent ?? t.accent;

  return (
    <div
      style={{ position: "relative", width: size, height: size }}
      role="timer"
      aria-label={`${seconds} seconds remaining`}
    >
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={t.line} strokeWidth={stroke} />
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
          fontSize: 56,
          fontWeight: 700,
          fontVariantNumeric: "tabular-nums",
          letterSpacing: "-0.04em",
          color: danger ? t.wrong : t.ink,
        }}
      >
        {seconds}
      </div>
    </div>
  );
}
