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
  category?: string;
  /** Face point value (100..700). */
  value?: number;
  /** Total points awarded for this answer — includes speed bonus. */
  awardedPoints?: number;
  /** Time-to-lock in ms — drives the "in 2.3s" caption + speed-bonus chip. */
  msToLock?: number;
  /** Current streak count (correct in a row). 0 hides the chip. */
  streak?: number;
  /** Player's 1-based rank in the leaderboard right now. `null` when the
   *  rank isn't yet known (game_scores still loading, or no participation
   *  row for this player) — renders an unnumbered "in the mix" tag rather
   *  than "#0". */
  rank?: number | null;
  /** Total cumulative score. */
  totalScore?: number;
  /** Positions climbed since the previous question. Positive = up. */
  rankDelta?: number;
  /** Caption for the next-action strip. */
  nextHint?: string;
}

export function PlayerRevealCorrect({
  themeKey: _themeKey,
  category = "Geography",
  value = 100,
  awardedPoints = 110,
  msToLock = 2300,
  streak = 3,
  rank = 7,
  totalScore = 2340,
  rankDelta = 4,
  nextHint = "Linda is picking the next category…",
}: PlayerRevealCorrectProps = {}) {
  const { t } = useTheme();
  const speedBonus = msToLock < 5000;
  const speedBonusAmount = speedBonus
    ? Math.max(0, awardedPoints - value)
    : 0;
  const seconds = (msToLock / 1000).toFixed(1);
  return (
    <div
      data-testid="player-reveal-correct"
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
        <Eyebrow color="rgba(14,8,5,.55)" size={10}>{category.toUpperCase()} · {value} PTS</Eyebrow>
        {streak >= 2 && (
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
            × {streak} STREAK
          </span>
        )}
      </div>

      <div role="alert" aria-live="assertive">
        <Display size={72} color="#0E0805" weight={700}>
          Correct.
        </Display>
      </div>

      <div style={{ marginTop: 8, display: "flex", alignItems: "baseline", gap: 12 }}>
        <Eyebrow color="rgba(14,8,5,.55)" size={11}>YOU EARNED</Eyebrow>
        <Numeric size={11} color="rgba(14,8,5,.55)">in {seconds}s</Numeric>
      </div>

      <div
        data-testid="player-reveal-points"
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
        +{awardedPoints}
      </div>

      {speedBonus && (
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
            +{speedBonusAmount} SPEED
          </span>
          <span style={{ fontSize: 13, color: "rgba(14,8,5,.7)" }}>under 5s nails the bonus.</span>
        </div>
      )}

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
        {rank && rank > 0 ? (
          <>
            <Numeric size={36} weight={700} color={t.correct}>#{rank}</Numeric>
            {rankDelta !== 0 && (
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: t.correct, fontWeight: 600 }}>
                {rankDelta > 0 ? `↑ ${rankDelta}` : `↓ ${Math.abs(rankDelta)}`}
              </span>
            )}
          </>
        ) : (
          <Numeric size={22} weight={600} color={t.correct}>in the mix</Numeric>
        )}
        <span style={{ flex: 1 }} />
        <Numeric size={22} weight={600} color="rgba(244,230,196,.95)">{totalScore.toLocaleString()}</Numeric>
      </div>

      <div style={{ marginTop: 10, color: "rgba(14,8,5,.7)", fontSize: 12, textAlign: "center" }}>
        {nextHint}
      </div>
    </div>
  );
}
