// Phone-sized timer ring. Shows seconds remaining numerically in the center
// and an arc that depletes around the perimeter. The first 5 seconds of the
// 20-second timer carry a brighter outer arc segment (the speed-bonus
// window); when seconds <= 5 the whole ring flips to the "wrong" color to
// signal urgency.

"use client";

import { useTheme } from "./ThemeProvider";

export interface TimerRingProps {
  seconds: number;
  max?: number;
  size?: number;
  accent?: string;
}

export function TimerRing({ seconds, max = 20, size = 48, accent }: TimerRingProps) {
  const { t } = useTheme();
  const a = accent ?? t.accent;
  const stroke = 3.5;
  const r = (size - stroke) / 2;
  const C = 2 * Math.PI * r;
  const frac = Math.max(0, Math.min(1, seconds / max));
  const danger = seconds <= 5;
  const color = danger ? t.wrong : a;

  // The first 5 seconds of the 20s are the speed-bonus window — drawn as a
  // brighter outer arc segment so the boundary is visible. Hides once we
  // pass that threshold.
  const bonusFrac = 5 / max;
  const arcStart = 1 - bonusFrac; // last 25% of the circle = first 5s

  return (
    <div
      style={{ position: "relative", width: size, height: size }}
      role="timer"
      aria-label={`${seconds} seconds remaining`}
    >
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={t.line} strokeWidth={stroke} />
        {!danger && seconds > 15 && (
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
