// Player phone — REVEAL · CORRECT.
// Full-bleed correct-color takeover. The dopamine moment — restrained
// dopamine. Huge mono "+110" number with the speed-bonus chip, then a dark
// rank strip at the bottom showing the climb. Caption preview of the host's
// next action keeps the flow alive.

"use client";

import {
  useTheme,
  Display,
  Eyebrow,
  Numeric,
} from "@/components/system";
import type { ThemeKey } from "@/lib/theme/tokens";

export interface PlayerRevealCorrectProps {
  themeKey?: ThemeKey;
}

export function PlayerRevealCorrect({ themeKey: _themeKey }: PlayerRevealCorrectProps = {}) {
  const { t } = useTheme();
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: t.correct,
        color: "#0E0805",
        fontFamily: "var(--font-sans)",
        display: "flex",
        flexDirection: "column",
        padding: "14px 22px 26px",
        boxSizing: "border-box",
        overflow: "hidden",
        animation: "tr1via-correct-flash .6s cubic-bezier(.2,.7,.3,1) both",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          paddingTop: 4,
          paddingBottom: 14,
        }}
      >
        <Eyebrow color="rgba(14,8,5,.55)" size={10}>GEOGRAPHY · 100 PTS</Eyebrow>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            padding: "3px 8px",
            borderRadius: 99,
            background: "#0E0805",
            color: t.correct,
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.06em",
          }}
        >
          × 3 STREAK
        </span>
      </div>

      <Display size={72} color="#0E0805" weight={700}>
        Correct.
      </Display>

      <div style={{ marginTop: 8, display: "flex", alignItems: "baseline", gap: 12 }}>
        <Eyebrow color="rgba(14,8,5,.55)" size={11}>YOU EARNED</Eyebrow>
        <Numeric size={11} color="rgba(14,8,5,.55)">in 2.3s</Numeric>
      </div>

      <div
        style={{
          marginTop: 4,
          fontFamily: "var(--font-mono)",
          fontWeight: 700,
          fontSize: 168,
          letterSpacing: "-0.06em",
          lineHeight: 1,
          color: "#0E0805",
          fontVariantNumeric: "tabular-nums",
          animation: "tr1via-score-pop .55s cubic-bezier(.2,.7,.3,1) .1s both",
        }}
      >
        +110
      </div>

      <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 10 }}>
        <span
          style={{
            padding: "4px 10px",
            borderRadius: 99,
            background: "#0E0805",
            color: t.correct,
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.06em",
          }}
        >
          +10 SPEED
        </span>
        <span style={{ fontSize: 13, color: "rgba(14,8,5,.7)" }}>under 5s nails the bonus.</span>
      </div>

      <div
        style={{
          marginTop: "auto",
          padding: "18px 20px",
          borderRadius: 14,
          background: "#0E0805",
          color: t.correct,
          display: "flex",
          alignItems: "center",
          gap: 14,
        }}
      >
        <Eyebrow color="rgba(200,226,94,.7)" size={10}>NOW AT</Eyebrow>
        <Numeric size={36} weight={700} color={t.correct}>#7</Numeric>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: t.correct, fontWeight: 600 }}>&uarr; 4</span>
        <span style={{ flex: 1 }} />
        <Numeric size={22} weight={600} color="rgba(244,230,196,.95)">2,340</Numeric>
      </div>

      <div style={{ marginTop: 10, color: "rgba(14,8,5,.7)", fontSize: 12, textAlign: "center" }}>
        Linda is picking the next category&hellip;
      </div>
    </div>
  );
}
